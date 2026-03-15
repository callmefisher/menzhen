package service

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrFollowUpNotFound = errors.New("follow-up not found")
)

// CreateFollowUpRequest is the input for creating a new follow-up.
type CreateFollowUpRequest struct {
	PatientID   uint64  `json:"patient_id" binding:"required"`
	RecordID    *uint64 `json:"record_id"`
	PlannedDate string  `json:"planned_date" binding:"required"` // "2006-01-02"
	Method      string  `json:"method" binding:"required"`
	Content     string  `json:"content"`
}

// NullableUint64 distinguishes between "not provided", "null" (clear), and a value.
// Use json.RawMessage to detect presence in JSON.
type NullableUint64 struct {
	Value   *uint64
	Present bool // true if field was present in JSON (even if null)
}

func (n *NullableUint64) UnmarshalJSON(data []byte) error {
	n.Present = true
	if string(data) == "null" {
		n.Value = nil
		return nil
	}
	var v uint64
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	n.Value = &v
	return nil
}

// UpdateFollowUpRequest uses pointer fields to distinguish "not provided" from "zero value".
// RecordID uses NullableUint64 to distinguish "not sent" vs "null" (clear association).
type UpdateFollowUpRequest struct {
	PatientID   *uint64        `json:"patient_id"`
	RecordID    NullableUint64 `json:"record_id"`
	PlannedDate *string        `json:"planned_date"`
	ActualDate  *string        `json:"actual_date"`
	Method      *string        `json:"method"`
	Content     *string        `json:"content"`
}

// FollowUpListItem is the denormalized response for list queries.
type FollowUpListItem struct {
	ID              uint64    `json:"id"`
	TenantID        uint64    `json:"tenant_id"`
	PatientID       uint64    `json:"patient_id"`
	PatientName     string    `json:"patient_name"`
	RecordID        *uint64   `json:"record_id"`
	RecordDiagnosis string    `json:"record_diagnosis"`
	RecordVisitDate *string   `json:"record_visit_date"`
	PlannedDate     string    `json:"planned_date"`
	ActualDate      *string   `json:"actual_date"`
	Status          string    `json:"status"`
	Method          string    `json:"method"`
	Content         string    `json:"content"`
	CreatedBy       uint64    `json:"created_by"`
	CreatedByName   string    `json:"created_by_name"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// FollowUpStats holds the badge counts.
type FollowUpStats struct {
	PendingCount   int64 `json:"pending_count"`
	OverdueCount   int64 `json:"overdue_count"`
	TodayCount     int64 `json:"today_count"`
	CompletedCount int64 `json:"completed_count"`
}

// FollowUpService handles follow-up business logic.
type FollowUpService struct {
	DB *gorm.DB
}

// NewFollowUpService creates a new FollowUpService.
func NewFollowUpService(db *gorm.DB) *FollowUpService {
	return &FollowUpService{DB: db}
}

// List returns a paginated, filtered list of follow-ups with denormalized patient/record info.
func (s *FollowUpService) List(tenantID uint64, patientName, status string, plannedFrom, plannedTo string, page, size int) ([]FollowUpListItem, int64, error) {
	query := s.DB.Table("follow_ups AS f").
		Select(`f.id, f.tenant_id, f.patient_id,
			COALESCE(p.name, '已删除') AS patient_name,
			f.record_id,
			COALESCE(r.diagnosis, '') AS record_diagnosis,
			DATE_FORMAT(r.visit_date, '%Y-%m-%d') AS record_visit_date,
			DATE_FORMAT(f.planned_date, '%Y-%m-%d') AS planned_date,
			DATE_FORMAT(f.actual_date, '%Y-%m-%d') AS actual_date,
			f.status, f.method, f.content,
			f.created_by,
			COALESCE(u.real_name, u.username, '') AS created_by_name,
			f.created_at, f.updated_at`).
		Joins("LEFT JOIN patients p ON p.id = f.patient_id AND p.deleted_at IS NULL").
		Joins("LEFT JOIN medical_records r ON r.id = f.record_id AND r.deleted_at IS NULL").
		Joins("LEFT JOIN users u ON u.id = f.created_by").
		Where("f.tenant_id = ? AND f.deleted_at IS NULL", tenantID)

	// Filters
	if patientName != "" {
		query = query.Where("p.name LIKE ?", "%"+patientName+"%")
	}
	if status == "overdue" {
		query = query.Where("f.status = 'pending' AND f.planned_date < CURDATE()")
	} else if status == "pending" {
		query = query.Where("f.status = 'pending' AND f.planned_date >= CURDATE()")
	} else if status == "completed" {
		query = query.Where("f.status = 'completed'")
	}
	if plannedFrom != "" {
		query = query.Where("f.planned_date >= ?", plannedFrom)
	}
	if plannedTo != "" {
		query = query.Where("f.planned_date <= ?", plannedTo)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []FollowUpListItem
	if err := query.Order("f.planned_date ASC").
		Offset((page - 1) * size).Limit(size).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}

	// Compute overdue virtual status
	today := time.Now().Format("2006-01-02")
	for i := range items {
		if items[i].Status == "pending" && items[i].PlannedDate < today {
			items[i].Status = "overdue"
		}
	}

	return items, total, nil
}

// Create creates a new follow-up.
func (s *FollowUpService) Create(tenantID, createdBy uint64, req *CreateFollowUpRequest) (*model.FollowUp, error) {
	plannedDate, err := time.Parse("2006-01-02", req.PlannedDate)
	if err != nil {
		return nil, errors.New("invalid planned_date format, expected YYYY-MM-DD")
	}

	followUp := model.FollowUp{
		TenantID:    tenantID,
		PatientID:   req.PatientID,
		RecordID:    req.RecordID,
		PlannedDate: plannedDate,
		Status:      "pending",
		Method:      req.Method,
		Content:     req.Content,
		CreatedBy:   createdBy,
	}

	if err := s.DB.Create(&followUp).Error; err != nil {
		return nil, err
	}
	return &followUp, nil
}

// GetByID returns a single follow-up by ID with tenant check.
func (s *FollowUpService) GetByID(tenantID, id uint64) (*model.FollowUp, error) {
	var followUp model.FollowUp
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFollowUpNotFound
		}
		return nil, err
	}
	return &followUp, nil
}

// Update updates an existing follow-up. Returns old + new for oplog.
func (s *FollowUpService) Update(tenantID, id uint64, req *UpdateFollowUpRequest) (*model.FollowUp, *model.FollowUp, error) {
	var followUp model.FollowUp
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrFollowUpNotFound
		}
		return nil, nil, err
	}

	oldFollowUp := followUp

	updates := make(map[string]interface{})
	if req.PatientID != nil {
		updates["patient_id"] = *req.PatientID
	}
	if req.RecordID.Present {
		updates["record_id"] = req.RecordID.Value // nil clears, *uint64 sets
	}
	if req.PlannedDate != nil {
		pd, err := time.Parse("2006-01-02", *req.PlannedDate)
		if err != nil {
			return nil, nil, errors.New("invalid planned_date format")
		}
		updates["planned_date"] = pd
	}
	if req.ActualDate != nil {
		if *req.ActualDate == "" {
			// Clear actual_date → revert to pending
			updates["actual_date"] = nil
			updates["status"] = "pending"
		} else {
			ad, err := time.Parse("2006-01-02", *req.ActualDate)
			if err != nil {
				return nil, nil, errors.New("invalid actual_date format")
			}
			updates["actual_date"] = ad
			updates["status"] = "completed"
		}
	}
	if req.Method != nil {
		updates["method"] = *req.Method
	}
	if req.Content != nil {
		updates["content"] = *req.Content
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&followUp).Updates(updates).Error; err != nil {
			return nil, nil, err
		}
	}

	// Reload
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldFollowUp, &followUp, nil
}

// Delete soft-deletes a follow-up. Returns the deleted record for oplog.
func (s *FollowUpService) Delete(tenantID, id uint64) (*model.FollowUp, error) {
	var followUp model.FollowUp
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFollowUpNotFound
		}
		return nil, err
	}

	if err := s.DB.Delete(&followUp).Error; err != nil {
		return nil, err
	}
	return &followUp, nil
}

// Stats returns follow-up counts for the menu badge.
// Note: TodayCount overlaps with PendingCount by design (today's items are both "pending" and "today").
func (s *FollowUpService) Stats(tenantID uint64) (*FollowUpStats, error) {
	var stats FollowUpStats

	// IMPORTANT: Each count must use a fresh query to avoid GORM Where clause accumulation.
	base := func() *gorm.DB {
		return s.DB.Model(&model.FollowUp{}).Where("tenant_id = ?", tenantID)
	}

	if err := base().Where("status = 'pending' AND planned_date >= CURDATE()").Count(&stats.PendingCount).Error; err != nil {
		return nil, err
	}
	if err := base().Where("status = 'pending' AND planned_date < CURDATE()").Count(&stats.OverdueCount).Error; err != nil {
		return nil, err
	}
	if err := base().Where("status = 'pending' AND planned_date = CURDATE()").Count(&stats.TodayCount).Error; err != nil {
		return nil, err
	}
	if err := base().Where("status = 'completed'").Count(&stats.CompletedCount).Error; err != nil {
		return nil, err
	}

	return &stats, nil
}
