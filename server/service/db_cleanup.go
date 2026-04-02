package service

import (
	"log"
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
	// Expired* counts: detected by ScanOrphanData, cleaned by CleanupOrphanData.
	ExpiredOpLogs       int `json:"expired_op_logs"`
	ExpiredQueueEntries int `json:"expired_queue_entries"`
	ExpiredQueueSeqs    int `json:"expired_queue_seqs"`
	ExpiredAppointments int `json:"expired_appointments"`
	ExpiredAIAnalyses   int `json:"expired_ai_analyses"`
	Cleaned             map[string]int `json:"cleaned,omitempty"`
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

	// 7. Expired op_logs: records older than 90 days (no soft-delete, direct count)
	opLogCutoff := time.Now().AddDate(0, 0, -90)
	var expiredOpLogs int64
	if err := s.DB.Raw("SELECT COUNT(*) FROM op_logs WHERE created_at < ?", opLogCutoff).Scan(&expiredOpLogs).Error; err != nil {
		return nil, err
	}
	result.ExpiredOpLogs = int(expiredOpLogs)

	// 8. Expired queue_entries: older than 7 days
	// Note: CrossDayCleanup already removes previous-day entries hourly; this is a safety net.
	queueCutoff := time.Now().AddDate(0, 0, -7)
	var expiredQueueEntries int64
	if err := s.DB.Raw("SELECT COUNT(*) FROM queue_entries WHERE created_at < ?", queueCutoff).Scan(&expiredQueueEntries).Error; err != nil {
		return nil, err
	}
	result.ExpiredQueueEntries = int(expiredQueueEntries)

	// 9. Expired queue_seqs: queue_date older than 7 days
	queueDateCutoff := time.Now().AddDate(0, 0, -7).Format("2006-01-02")
	var expiredQueueSeqs int64
	if err := s.DB.Raw("SELECT COUNT(*) FROM queue_seqs WHERE queue_date < ?", queueDateCutoff).Scan(&expiredQueueSeqs).Error; err != nil {
		return nil, err
	}
	result.ExpiredQueueSeqs = int(expiredQueueSeqs)

	// 10. Expired appointments: cancelled/queued/no_show with appoint_date older than 30 days.
	// Uses appoint_date (the actual visit date) rather than created_at, so far-future appointments
	// that were cancelled early are not prematurely removed.
	// pending appointments are never deleted (they may still need action).
	// Note: 'queued' records whose actual visit is done but not yet marked no_show are also safe
	// to clean here — after 30 days past the visit date they have no business value.
	apptDateCutoff := time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	var expiredAppointments int64
	if err := s.DB.Raw(
		"SELECT COUNT(*) FROM appointments WHERE status IN ('cancelled','queued','no_show') AND appoint_date < ?",
		apptDateCutoff,
	).Scan(&expiredAppointments).Error; err != nil {
		return nil, err
	}
	result.ExpiredAppointments = int(expiredAppointments)

	// 11. Expired ai_analyses (TTL 180 days): records whose last_accessed_at (or created_at if null) is older than 180 days.
	aiCutoff := time.Now().AddDate(0, 0, -180)
	var expiredAIAnalyses int64
	if err := s.DB.Raw(`
		SELECT COUNT(*) FROM ai_analyses
		WHERE deleted_at IS NULL
		  AND (
		    (last_accessed_at IS NOT NULL AND last_accessed_at < ?)
		    OR (last_accessed_at IS NULL AND created_at < ?)
		  )
	`, aiCutoff, aiCutoff).Scan(&expiredAIAnalyses).Error; err != nil {
		return nil, err
	}
	result.ExpiredAIAnalyses = int(expiredAIAnalyses)

	return result, nil
}

// CleanupOrphanData deletes orphan and expired data.
//
// Design: orphan cleanup (steps 1-6) runs in a single short transaction to maintain referential
// consistency. Time-based expiry cleanups (steps 7-11) run as independent operations OUTSIDE the
// transaction — this prevents high-volume DELETEs (op_logs, queue) from holding locks that would
// block concurrent business writes. Each expiry step logs its own error and continues.
//
// Note: scanResult counts are a snapshot from before cleanup begins; Cleaned map reflects the
// actual rows affected during cleanup. Minor discrepancies are expected and harmless.
func (s *DBCleanupService) CleanupOrphanData() (*DBCleanupResult, error) {
	// Pre-scan to populate Expired* summary fields (best-effort snapshot).
	scanResult, err := s.ScanOrphanData()
	if err != nil {
		return nil, err
	}

	cleaned := make(map[string]int)

	// ── Phase 1: Orphan structural cleanup (single atomic transaction) ──────────
	// These steps are interdependent (items→prescriptions→billings ordering), so they must be atomic.
	if err := s.DB.Transaction(func(tx *gorm.DB) error {
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

		// 2a. Delete items of orphan prescriptions (record soft-deleted or missing)
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

		// 6. Hard-delete soft-deleted rows older than 30 days
		cutoff := time.Now().AddDate(0, 0, -30)
		for _, table := range []string{"medical_records", "prescriptions", "billings", "ai_analyses", "inventory_drugs"} {
			res = tx.Exec("DELETE FROM "+table+" WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected > 0 {
				cleaned["purged_"+table] = int(res.RowsAffected)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	// ── Phase 2: Time-based expiry cleanup (independent, outside transaction) ───
	// Each step runs independently to minimise lock duration on high-write tables.
	// Errors are logged but do not abort subsequent steps.

	// 7. op_logs: retain 90 days
	opLogCutoff := time.Now().AddDate(0, 0, -90)
	if res := s.DB.Exec("DELETE FROM op_logs WHERE created_at < ?", opLogCutoff); res.Error != nil {
		log.Printf("[db-cleanup] op_logs delete error: %v", res.Error)
	} else if res.RowsAffected > 0 {
		cleaned["expired_op_logs"] = int(res.RowsAffected)
	}

	// 8. queue_entries: retain 7 days (CrossDayCleanup removes previous-day entries hourly; this is a safety net)
	queueCutoff := time.Now().AddDate(0, 0, -7)
	if res := s.DB.Exec("DELETE FROM queue_entries WHERE created_at < ?", queueCutoff); res.Error != nil {
		log.Printf("[db-cleanup] queue_entries delete error: %v", res.Error)
	} else if res.RowsAffected > 0 {
		cleaned["expired_queue_entries"] = int(res.RowsAffected)
	}

	// 9. queue_seqs: retain 7 days
	queueDateCutoff := time.Now().AddDate(0, 0, -7).Format("2006-01-02")
	if res := s.DB.Exec("DELETE FROM queue_seqs WHERE queue_date < ?", queueDateCutoff); res.Error != nil {
		log.Printf("[db-cleanup] queue_seqs delete error: %v", res.Error)
	} else if res.RowsAffected > 0 {
		cleaned["expired_queue_seqs"] = int(res.RowsAffected)
	}

	// 10. appointments: delete cancelled/queued/no_show whose appoint_date is >30 days ago.
	// Uses appoint_date (actual visit date) not created_at, so far-future appointments cancelled
	// early are not removed prematurely. pending is never auto-deleted.
	apptDateCutoff := time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	if res := s.DB.Exec(
		"DELETE FROM appointments WHERE status IN ('cancelled','queued','no_show') AND appoint_date < ?",
		apptDateCutoff,
	); res.Error != nil {
		log.Printf("[db-cleanup] appointments delete error: %v", res.Error)
	} else if res.RowsAffected > 0 {
		cleaned["expired_appointments"] = int(res.RowsAffected)
	}

	// 11. ai_analyses TTL: delete unsoft-deleted records not accessed for 180 days.
	// Already-soft-deleted ai_analyses are handled by phase 1 step 6 (30-day purge).
	aiCutoff := time.Now().AddDate(0, 0, -180)
	if res := s.DB.Exec(`
		DELETE FROM ai_analyses
		WHERE deleted_at IS NULL
		  AND (
		    (last_accessed_at IS NOT NULL AND last_accessed_at < ?)
		    OR (last_accessed_at IS NULL AND created_at < ?)
		  )
	`, aiCutoff, aiCutoff); res.Error != nil {
		log.Printf("[db-cleanup] ai_analyses delete error: %v", res.Error)
	} else if res.RowsAffected > 0 {
		cleaned["expired_ai_analyses"] = int(res.RowsAffected)
	}

	scanResult.Cleaned = cleaned
	return scanResult, nil
}
