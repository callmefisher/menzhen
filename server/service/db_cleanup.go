package service

import (
	"time"

	"gorm.io/gorm"
)

// DBCleanupResult holds the result of an orphan data scan/cleanup.
type DBCleanupResult struct {
	OrphanPrescriptions   int            `json:"orphan_prescriptions"`
	OrphanItems           int            `json:"orphan_items"`
	OrphanBillings        int            `json:"orphan_billings"`
	OrphanUserRoles       int            `json:"orphan_user_roles"`
	OrphanRolePermissions int            `json:"orphan_role_permissions"`
	SoftDeleted           map[string]int `json:"soft_deleted"`
	Cleaned               map[string]int `json:"cleaned,omitempty"`
}

// DBCleanupService handles orphan data detection and cleanup.
type DBCleanupService struct {
	DB *gorm.DB
}

// NewDBCleanupService creates a new DBCleanupService.
func NewDBCleanupService(db *gorm.DB) *DBCleanupService {
	return &DBCleanupService{DB: db}
}

// ScanOrphanData performs a read-only scan and returns orphan data statistics.
func (s *DBCleanupService) ScanOrphanData() (*DBCleanupResult, error) {
	result := &DBCleanupResult{
		SoftDeleted: make(map[string]int),
	}

	// 1. Orphan prescriptions: record_id points to deleted/missing medical_records
	var orphanPrescriptions int64
	if err := s.DB.Raw(`
		SELECT COUNT(*) FROM prescriptions p
		WHERE p.deleted_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM medical_records mr
		    WHERE mr.id = p.record_id AND mr.deleted_at IS NULL
		  )
	`).Scan(&orphanPrescriptions).Error; err != nil {
		return nil, err
	}
	result.OrphanPrescriptions = int(orphanPrescriptions)

	// 2. Orphan prescription_items: prescription hard-deleted (row missing entirely)
	// Note: items of soft-deleted prescriptions are preserved for potential recovery within 30 days.
	var orphanItems int64
	if err := s.DB.Raw(`
		SELECT COUNT(*) FROM prescription_items pi
		WHERE NOT EXISTS (
		  SELECT 1 FROM prescriptions p WHERE p.id = pi.prescription_id
		)
	`).Scan(&orphanItems).Error; err != nil {
		return nil, err
	}
	result.OrphanItems = int(orphanItems)

	// 3. Orphan billings: record_id or prescription_id points to deleted/missing records
	var orphanBillings int64
	if err := s.DB.Raw(`
		SELECT COUNT(*) FROM billings b
		WHERE b.deleted_at IS NULL
		  AND (
		    NOT EXISTS (
		      SELECT 1 FROM medical_records mr
		      WHERE mr.id = b.record_id AND mr.deleted_at IS NULL
		    )
		    OR (
		      b.prescription_id > 0
		      AND NOT EXISTS (
		        SELECT 1 FROM prescriptions p
		        WHERE p.id = b.prescription_id AND p.deleted_at IS NULL
		      )
		    )
		  )
	`).Scan(&orphanBillings).Error; err != nil {
		return nil, err
	}
	result.OrphanBillings = int(orphanBillings)

	// 4. Orphan user_roles: user_id points to non-existent users
	var orphanUserRoles int64
	if err := s.DB.Raw(`
		SELECT COUNT(*) FROM user_roles ur
		WHERE NOT EXISTS (
		  SELECT 1 FROM users u WHERE u.id = ur.user_id
		)
	`).Scan(&orphanUserRoles).Error; err != nil {
		return nil, err
	}
	result.OrphanUserRoles = int(orphanUserRoles)

	// 5. Orphan role_permissions: role_id or permission_id points to non-existent records
	var orphanRolePerms int64
	if err := s.DB.Raw(`
		SELECT COUNT(*) FROM role_permissions rp
		WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = rp.role_id)
		   OR NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = rp.permission_id)
	`).Scan(&orphanRolePerms).Error; err != nil {
		return nil, err
	}
	result.OrphanRolePermissions = int(orphanRolePerms)

	// 6. Soft-deleted record counts per table (only those older than 30 days, matching cleanup)
	cutoff := time.Now().AddDate(0, 0, -30)
	softDeleteTables := []struct {
		table string
		label string
	}{
		{"medical_records", "medical_records"},
		{"prescriptions", "prescriptions"},
		{"billings", "billings"},
		{"ai_analyses", "ai_analyses"},
		{"inventory_drugs", "inventory_drugs"},
	}
	for _, t := range softDeleteTables {
		var count int64
		if err := s.DB.Raw("SELECT COUNT(*) FROM "+t.table+" WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff).Scan(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			result.SoftDeleted[t.label] = int(count)
		}
	}

	return result, nil
}

// CleanupOrphanData deletes orphan data in a transaction and purges old soft-deleted records.
func (s *DBCleanupService) CleanupOrphanData() (*DBCleanupResult, error) {
	// First scan to get current counts
	scanResult, err := s.ScanOrphanData()
	if err != nil {
		return nil, err
	}

	cleaned := make(map[string]int)

	err = s.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Delete prescription_items where prescription row is completely gone (hard-deleted)
		res := tx.Exec(`
			DELETE FROM prescription_items
			WHERE NOT EXISTS (
			  SELECT 1 FROM prescriptions p WHERE p.id = prescription_items.prescription_id
			)
		`)
		if res.Error != nil {
			return res.Error
		}
		cleaned["orphan_items"] = int(res.RowsAffected)

		// 2. Delete orphan prescriptions (record soft-deleted or missing) — must delete their items first
		// 2a. Delete items of these orphan prescriptions (before removing the prescriptions themselves)
		res = tx.Exec(`
			DELETE pi FROM prescription_items pi
			INNER JOIN prescriptions p ON p.id = pi.prescription_id
			WHERE p.deleted_at IS NULL
			  AND NOT EXISTS (
			    SELECT 1 FROM medical_records mr
			    WHERE mr.id = p.record_id AND mr.deleted_at IS NULL
			  )
		`)
		if res.Error != nil {
			return res.Error
		}
		cleaned["orphan_items"] += int(res.RowsAffected)

		// 2b. Delete the orphan prescriptions themselves
		res = tx.Exec(`
			DELETE FROM prescriptions
			WHERE deleted_at IS NULL
			  AND NOT EXISTS (
			    SELECT 1 FROM medical_records mr
			    WHERE mr.id = prescriptions.record_id AND mr.deleted_at IS NULL
			  )
		`)
		if res.Error != nil {
			return res.Error
		}
		cleaned["orphan_prescriptions"] = int(res.RowsAffected)

		// 3. Delete orphan billings
		res = tx.Exec(`
			DELETE FROM billings
			WHERE deleted_at IS NULL
			  AND (
			    NOT EXISTS (
			      SELECT 1 FROM medical_records mr
			      WHERE mr.id = billings.record_id AND mr.deleted_at IS NULL
			    )
			    OR (
			      billings.prescription_id > 0
			      AND NOT EXISTS (
			        SELECT 1 FROM prescriptions p
			        WHERE p.id = billings.prescription_id AND p.deleted_at IS NULL
			      )
			    )
			  )
		`)
		if res.Error != nil {
			return res.Error
		}
		cleaned["orphan_billings"] = int(res.RowsAffected)

		// 4. Delete orphan user_roles
		res = tx.Exec(`
			DELETE FROM user_roles
			WHERE NOT EXISTS (
			  SELECT 1 FROM users u WHERE u.id = user_roles.user_id
			)
		`)
		if res.Error != nil {
			return res.Error
		}
		cleaned["orphan_user_roles"] = int(res.RowsAffected)

		// 5. Delete orphan role_permissions
		res = tx.Exec(`
			DELETE FROM role_permissions
			WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id)
			   OR NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = role_permissions.permission_id)
		`)
		if res.Error != nil {
			return res.Error
		}
		cleaned["orphan_role_permissions"] = int(res.RowsAffected)

		// 6. Hard delete soft-deleted records older than 30 days
		// Note: purging medical_records may create new orphan prescriptions/billings
		// that will be cleaned up on the next run. This is acceptable.
		cutoff := time.Now().AddDate(0, 0, -30)
		softDeleteTables := []string{
			"medical_records",
			"prescriptions",
			"billings",
			"ai_analyses",
			"inventory_drugs",
		}
		for _, table := range softDeleteTables {
			res = tx.Exec("DELETE FROM "+table+" WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected > 0 {
				cleaned["purged_"+table] = int(res.RowsAffected)
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	scanResult.Cleaned = cleaned
	return scanResult, nil
}
