package service

import (
	"errors"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrFollowUpNotFound = errors.New("follow-up not found")
)

// CreateFollowUpRequest is the input for creating a new follow-up.
type CreateFollowUpRequest struct {
	PatientID   uint64 `json:"patient_id" binding:"required"`
	RecordID    uint64 `json:"record_id" binding:"required"`
	PlannedDate string `json:"planned_date" binding:"required"` // "2006-01-02"
	Method      string `json:"method" binding:"required"`
	Content     string `json:"content"`
	IsRecovered bool   `json:"is_recovered"`
}

// UpdateFollowUpRequest uses pointer fields to distinguish "not provided" from "zero value".
type UpdateFollowUpRequest struct {
	PatientID   *uint64 `json:"patient_id"`
	RecordID    *uint64 `json:"record_id"`
	PlannedDate *string `json:"planned_date"`
	ActualDate  *string `json:"actual_date"`
	Method      *string `json:"method"`
	Content     *string `json:"content"`
	IsRecovered *bool   `json:"is_recovered"`
}

// FollowUpListItem is the denormalized response for list queries.
type FollowUpListItem struct {
	ID              uint64    `json:"id"`
	TenantID        uint64    `json:"tenant_id"`
	PatientID       uint64    `json:"patient_id"`
	PatientName     string    `json:"patient_name"`
	PatientPhone    string    `json:"patient_phone"`
	RecordID        uint64    `json:"record_id"`
	RecordDiagnosis string    `json:"record_diagnosis"`
	RecordVisitDate *string   `json:"record_visit_date"`
	PlannedDate     string    `json:"planned_date"`
	ActualDate      *string   `json:"actual_date"`
	Status          string    `json:"status"`
	Method          string    `json:"method"`
	Content         string    `json:"content"`
	IsRecovered     bool      `json:"is_recovered"`
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
	TotalCount     int64 `json:"total_count"`
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
func (s *FollowUpService) List(tenantID uint64, patientID uint64, recordID uint64, patientName, status string, isRecoveredStr string, plannedFrom, plannedTo string, page, size int, sortOrder string) ([]FollowUpListItem, int64, error) {
	query := s.DB.Table("follow_ups AS f").
		Select(`f.id, f.tenant_id, f.patient_id,
			COALESCE(p.name, '已删除') AS patient_name,
			COALESCE(p.phone, '') AS patient_phone,
			f.record_id,
			COALESCE(r.diagnosis, '') AS record_diagnosis,
			DATE_FORMAT(r.visit_date, '%Y-%m-%d') AS record_visit_date,
			DATE_FORMAT(f.planned_date, '%Y-%m-%d') AS planned_date,
			DATE_FORMAT(f.actual_date, '%Y-%m-%d') AS actual_date,
			f.status, f.method, f.content, f.is_recovered,
			f.created_by,
			COALESCE(u.real_name, u.username, '') AS created_by_name,
			f.created_at, f.updated_at`).
		Joins("LEFT JOIN patients p ON p.id = f.patient_id AND p.deleted_at IS NULL").
		Joins("LEFT JOIN medical_records r ON r.id = f.record_id AND r.deleted_at IS NULL").
		Joins("LEFT JOIN users u ON u.id = f.created_by").
		Where("f.tenant_id = ? AND f.deleted_at IS NULL", tenantID)

	// Filters
	if patientID > 0 {
		query = query.Where("f.patient_id = ?", patientID)
	}
	if recordID > 0 {
		query = query.Where("f.record_id = ?", recordID)
	}
	if patientName != "" {
		escaped := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(patientName)
		query = query.Where("p.name LIKE ?", "%"+escaped+"%")
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
	if isRecoveredStr == "true" {
		query = query.Where("f.is_recovered = ?", true)
	} else if isRecoveredStr == "false" {
		query = query.Where("f.is_recovered = ?", false)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	orderClause := "f.planned_date ASC"
	if sortOrder == "desc" {
		orderClause = "f.planned_date DESC"
	}
	// "全部" view: pending first, completed second, each group by planned_date
	if status == "" {
		orderClause = "CASE WHEN f.status = 'completed' THEN 1 ELSE 0 END, " + orderClause
	}

	var items []FollowUpListItem
	if err := query.Order(orderClause).
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
		IsRecovered: req.IsRecovered,
		CreatedBy:   createdBy,
	}

	if err := s.DB.Create(&followUp).Error; err != nil {
		return nil, err
	}
	// Load patient info for oplog display.
	s.DB.First(&followUp.Patient, followUp.PatientID)
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
	if req.RecordID != nil {
		updates["record_id"] = *req.RecordID
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
	if req.IsRecovered != nil {
		updates["is_recovered"] = *req.IsRecovered
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

	// Load patient info for oplog display.
	s.DB.First(&oldFollowUp.Patient, oldFollowUp.PatientID)
	s.DB.First(&followUp.Patient, followUp.PatientID)

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

	// Load patient info for oplog display.
	s.DB.First(&followUp.Patient, followUp.PatientID)

	if err := s.DB.Delete(&followUp).Error; err != nil {
		return nil, err
	}
	return &followUp, nil
}

// Stats returns follow-up counts for the menu badge.
// Note: TodayCount overlaps with PendingCount by design (today's items are both "pending" and "today").
func (s *FollowUpService) Stats(tenantID uint64) (*FollowUpStats, error) {
	type aggregated struct {
		PendingCount   int64
		OverdueCount   int64
		TodayCount     int64
		CompletedCount int64
		TotalCount     int64
	}
	var agg aggregated
	if err := s.DB.Model(&model.FollowUp{}).
		Select(`
			SUM(CASE WHEN status='pending' AND planned_date >= CURDATE() THEN 1 ELSE 0 END) AS pending_count,
			SUM(CASE WHEN status='pending' AND planned_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_count,
			SUM(CASE WHEN status='pending' AND planned_date = CURDATE() THEN 1 ELSE 0 END) AS today_count,
			SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_count,
			COUNT(*) AS total_count
		`).
		Where("tenant_id = ?", tenantID).
		Scan(&agg).Error; err != nil {
		return nil, err
	}

	return &FollowUpStats{
		PendingCount:   agg.PendingCount,
		OverdueCount:   agg.OverdueCount,
		TodayCount:     agg.TodayCount,
		CompletedCount: agg.CompletedCount,
		TotalCount:     agg.TotalCount,
	}, nil
}

// FindFollowUpPage returns which page (1-based) a follow-up appears on in planned_date ASC order.
func (s *FollowUpService) FindFollowUpPage(tenantID, followUpID uint64, size int) (int, error) {
	if size <= 0 {
		size = 20
	}
	var fu model.FollowUp
	if err := s.DB.Select("planned_date").Where("id = ? AND tenant_id = ? AND deleted_at IS NULL", followUpID, tenantID).First(&fu).Error; err != nil {
		return 1, err
	}

	// Count how many follow-ups come before this one in planned_date ASC, id ASC order
	var position int64
	s.DB.Table("follow_ups").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Where("planned_date < ? OR (planned_date = ? AND id < ?)", fu.PlannedDate, fu.PlannedDate, followUpID).
		Count(&position)

	page := int(position)/size + 1
	return page, nil
}
