package service

import (
	"time"

	"github.com/callmefisher/menzhen/server/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// StatisticsService aggregates billing and visit data into daily_stats.
type StatisticsService struct {
	DB *gorm.DB
}

// NewStatisticsService creates a new StatisticsService.
func NewStatisticsService(db *gorm.DB) *StatisticsService {
	return &StatisticsService{DB: db}
}

// RefreshDailyStats recomputes and upserts the stats row for the given tenant and date.
func (s *StatisticsService) RefreshDailyStats(tenantID uint64, date time.Time) error {
	// Normalise to midnight so the unique index (tenant_id, stat_date) stays stable.
	statDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	dateStr := statDate.Format("2006-01-02")

	// 1. Count medical records on this date.
	var recordCount int64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND DATE(visit_date) = ?", tenantID, dateStr).
		Count(&recordCount)

	// 2. Aggregate billing amounts joined through medical_records.visit_date.
	type billingSummary struct {
		Revenue         float64
		ConsultationFee float64
	}
	var summary billingSummary
	s.DB.Model(&model.Billing{}).
		Select("COALESCE(SUM(billings.actual_paid), 0) AS revenue, COALESCE(SUM(billings.consultation_fee), 0) AS consultation_fee").
		Joins("JOIN medical_records ON medical_records.id = billings.record_id AND medical_records.deleted_at IS NULL").
		Where("billings.tenant_id = ? AND DATE(medical_records.visit_date) = ? AND billings.deleted_at IS NULL", tenantID, dateStr).
		Scan(&summary)

	drugFee := summary.Revenue - summary.ConsultationFee

	// 3. Classify patients who visited today as new vs returning.
	var patientIDs []uint64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND DATE(visit_date) = ?", tenantID, dateStr).
		Distinct("patient_id").
		Pluck("patient_id", &patientIDs)

	newCount := 0
	returningCount := 0
	for _, pid := range patientIDs {
		var firstVisit time.Time
		s.DB.Model(&model.MedicalRecord{}).
			Where("tenant_id = ? AND patient_id = ?", tenantID, pid).
			Order("visit_date ASC").
			Limit(1).
			Pluck("visit_date", &firstVisit)

		firstDate := time.Date(firstVisit.Year(), firstVisit.Month(), firstVisit.Day(), 0, 0, 0, 0, firstVisit.Location())
		if firstDate.Equal(statDate) {
			newCount++
		} else {
			returningCount++
		}
	}

	// 4. UPSERT into daily_stats.
	stats := model.DailyStats{
		TenantID:              tenantID,
		StatDate:              statDate,
		Revenue:               summary.Revenue,
		ConsultationFee:       summary.ConsultationFee,
		DrugFee:               drugFee,
		RecordCount:           int(recordCount),
		NewPatientCount:       newCount,
		ReturningPatientCount: returningCount,
	}

	return s.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "stat_date"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"revenue", "consultation_fee", "drug_fee",
			"record_count", "new_patient_count", "returning_patient_count",
			"updated_at",
		}),
	}).Create(&stats).Error
}

// RebuildAllDailyStats drops and recomputes every daily_stats row for the given tenant.
func (s *StatisticsService) RebuildAllDailyStats(tenantID uint64) error {
	// DailyStats has no soft-delete column, so use Unscoped to hard-delete.
	if err := s.DB.Where("tenant_id = ?", tenantID).Delete(&model.DailyStats{}).Error; err != nil {
		return err
	}

	// Collect all distinct visit dates for this tenant.
	var dates []time.Time
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ?", tenantID).
		Distinct("DATE(visit_date)").
		Pluck("DATE(visit_date)", &dates)

	for _, d := range dates {
		if err := s.RefreshDailyStats(tenantID, d); err != nil {
			return err
		}
	}
	return nil
}
