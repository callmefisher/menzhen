package service

import (
	"github.com/callmefisher/menzhen/server/storage"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// CleanupResult holds the result of an orphan file scan/cleanup.
type CleanupResult struct {
	TotalFiles    int      `json:"total_files"`
	ReferencedCnt int      `json:"referenced_count"`
	OrphanCount   int      `json:"orphan_count"`
	OrphanFiles   []string `json:"orphan_files"`
	DeletedFiles  []string `json:"deleted_files,omitempty"`
	FailedFiles   []string `json:"failed_files,omitempty"`
}

// StorageCleanupService handles orphan file detection and cleanup.
type StorageCleanupService struct {
	DB          *gorm.DB
	MinIOClient *minio.Client
	MinIOBucket string
}

// NewStorageCleanupService creates a new StorageCleanupService.
func NewStorageCleanupService(db *gorm.DB, minioClient *minio.Client, bucket string) *StorageCleanupService {
	return &StorageCleanupService{DB: db, MinIOClient: minioClient, MinIOBucket: bucket}
}

// GetReferencedPaths returns all file paths referenced in the database.
func (s *StorageCleanupService) GetReferencedPaths() (map[string]bool, error) {
	referenced := make(map[string]bool)

	// Attachment file paths (no soft delete on record_attachments table).
	var attachmentPaths []string
	if err := s.DB.Table("record_attachments").Pluck("file_path", &attachmentPaths).Error; err != nil {
		return nil, err
	}
	for _, p := range attachmentPaths {
		referenced[p] = true
	}

	// Tongue images from medical_records (not soft-deleted).
	var tongueImages []string
	if err := s.DB.Table("medical_records").
		Where("tongue_image != '' AND deleted_at IS NULL").
		Pluck("tongue_image", &tongueImages).Error; err != nil {
		return nil, err
	}
	for _, p := range tongueImages {
		referenced[p] = true
	}

	return referenced, nil
}

// FindOrphanFiles returns keys from allKeys that are not in the referenced set.
func (s *StorageCleanupService) FindOrphanFiles(allKeys []string, referenced map[string]bool) []string {
	var orphans []string
	for _, key := range allKeys {
		if !referenced[key] {
			orphans = append(orphans, key)
		}
	}
	return orphans
}

// ScanOrphanFiles lists all MinIO objects and finds those not referenced in the database.
func (s *StorageCleanupService) ScanOrphanFiles() (*CleanupResult, error) {
	allKeys, err := storage.ListAllObjects(s.MinIOClient, s.MinIOBucket, "")
	if err != nil {
		return nil, err
	}

	referenced, err := s.GetReferencedPaths()
	if err != nil {
		return nil, err
	}

	orphans := s.FindOrphanFiles(allKeys, referenced)

	return &CleanupResult{
		TotalFiles:    len(allKeys),
		ReferencedCnt: len(referenced),
		OrphanCount:   len(orphans),
		OrphanFiles:   orphans,
	}, nil
}

// CleanupOrphanFiles scans and deletes orphan files from MinIO.
func (s *StorageCleanupService) CleanupOrphanFiles() (*CleanupResult, error) {
	result, err := s.ScanOrphanFiles()
	if err != nil {
		return nil, err
	}

	if len(result.OrphanFiles) == 0 {
		return result, nil
	}

	failed := storage.DeleteFiles(s.MinIOClient, s.MinIOBucket, result.OrphanFiles)
	failedSet := make(map[string]bool, len(failed))
	for _, f := range failed {
		failedSet[f] = true
	}

	var deleted []string
	for _, f := range result.OrphanFiles {
		if !failedSet[f] {
			deleted = append(deleted, f)
		}
	}

	result.DeletedFiles = deleted
	result.FailedFiles = failed
	return result, nil
}
