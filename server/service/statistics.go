package service

import (
	"math"
	"time"

	"github.com/callmefisher/menzhen/server/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Response structures for GetDashboard.

type DashboardSummary struct {
	TotalRevenue             float64  `json:"total_revenue"`
	TotalRecords             int      `json:"total_records"`
	TotalPatients            int      `json:"total_patients"`
	AvgRevenuePerRecord      float64  `json:"avg_revenue_per_record"`
	RevenueChangePercent     *float64 `json:"revenue_change_percent"`
	RecordsChangePercent     *float64 `json:"records_change_percent"`
	PatientsChangePercent    *float64 `json:"patients_change_percent"`
	CureRate                 *float64 `json:"cure_rate"`
	CureRateChangePercent    *float64 `json:"cure_rate_change_percent"`
}

type DailyTrendItem struct {
	Date                  string  `json:"date"`
	Revenue               float64 `json:"revenue"`
	ConsultationFee       float64 `json:"consultation_fee"`
	DrugFee               float64 `json:"drug_fee"`
	RecordCount           int     `json:"record_count"`
	NewPatientCount       int     `json:"new_patient_count"`
	ReturningPatientCount int     `json:"returning_patient_count"`
}

type RevenueBreakdown struct {
	ConsultationFeeTotal float64 `json:"consultation_fee_total"`
	DrugFeeTotal         float64 `json:"drug_fee_total"`
}

type PatientBreakdown struct {
	NewPatients       int `json:"new_patients"`
	ReturningPatients int `json:"returning_patients"`
}

type DashboardResult struct {
	Summary          DashboardSummary `json:"summary"`
	DailyTrend       []DailyTrendItem `json:"daily_trend"`
	RevenueBreakdown RevenueBreakdown `json:"revenue_breakdown"`
	PatientBreakdown PatientBreakdown `json:"patient_breakdown"`
}

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
	// 以实收为准：每笔诊金不超过该笔实收，避免药费为负
	s.DB.Model(&model.Billing{}).
		Select("COALESCE(SUM(billings.actual_paid), 0) AS revenue, COALESCE(SUM(LEAST(billings.consultation_fee, billings.actual_paid)), 0) AS consultation_fee").
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

// GetDashboard aggregates daily_stats rows for the given date range and returns
// summary metrics, daily trend, revenue breakdown, and patient breakdown.
// It also computes period-over-period change percentages against the equal-length
// preceding period.
func (s *StatisticsService) GetDashboard(tenantID uint64, startDate, endDate time.Time) (*DashboardResult, error) {
	var stats []model.DailyStats
	s.DB.Where("tenant_id = ? AND stat_date >= ? AND stat_date <= ?", tenantID, startDate, endDate).
		Order("stat_date ASC").
		Find(&stats)

	// Build a lookup from stat rows keyed by date string.
	statsMap := make(map[string]model.DailyStats, len(stats))
	for _, st := range stats {
		statsMap[st.StatDate.Format("2006-01-02")] = st
	}

	// Fill in every date in [startDate, endDate] so charts always show the full range.
	var totalRevenue, totalConsultation, totalDrug float64
	var totalRecords, totalNew, totalReturning int
	var dailyTrend []DailyTrendItem

	for d := startDate; !d.After(endDate); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		item := DailyTrendItem{Date: dateStr}
		if st, ok := statsMap[dateStr]; ok {
			totalRevenue += st.Revenue
			totalConsultation += st.ConsultationFee
			totalDrug += st.DrugFee
			totalRecords += st.RecordCount
			totalNew += st.NewPatientCount
			totalReturning += st.ReturningPatientCount

			item.Revenue = st.Revenue
			item.ConsultationFee = st.ConsultationFee
			item.DrugFee = st.DrugFee
			item.RecordCount = st.RecordCount
			item.NewPatientCount = st.NewPatientCount
			item.ReturningPatientCount = st.ReturningPatientCount
		}
		dailyTrend = append(dailyTrend, item)
	}

	totalPatients := totalNew + totalReturning
	var avgRevenue float64
	if totalRecords > 0 {
		avgRevenue = math.Round(totalRevenue/float64(totalRecords)*100) / 100
	}

	// 环比: previous period of equal duration.
	duration := endDate.Sub(startDate)
	prevEnd := startDate.AddDate(0, 0, -1)
	prevStart := prevEnd.Add(-duration)

	var prevStats []model.DailyStats
	s.DB.Where("tenant_id = ? AND stat_date >= ? AND stat_date <= ?", tenantID, prevStart, prevEnd).
		Find(&prevStats)

	var prevRevenue float64
	var prevRecords, prevPatients int
	for _, ps := range prevStats {
		prevRevenue += ps.Revenue
		prevRecords += ps.RecordCount
		prevPatients += ps.NewPatientCount + ps.ReturningPatientCount
	}

	calcChange := func(current, previous float64) *float64 {
		if previous == 0 {
			return nil
		}
		change := (current - previous) / previous * 100
		return &change
	}

	summary := DashboardSummary{
		TotalRevenue:          totalRevenue,
		TotalRecords:          totalRecords,
		TotalPatients:         totalPatients,
		AvgRevenuePerRecord:   avgRevenue,
		RevenueChangePercent:  calcChange(totalRevenue, prevRevenue),
		RecordsChangePercent:  calcChange(float64(totalRecords), float64(prevRecords)),
		PatientsChangePercent: calcChange(float64(totalPatients), float64(prevPatients)),
	}

	// Cure rate: real-time from follow_ups (not stored in daily_stats).
	type cureResult struct {
		Total     int
		Recovered int
	}
	var curCure cureResult
	s.DB.Raw(`
		SELECT
			COUNT(DISTINCT mr.id) AS total,
			COUNT(DISTINCT CASE WHEN f2.id IS NOT NULL THEN mr.id END) AS recovered
		FROM medical_records mr
		JOIN follow_ups f ON f.record_id = mr.id AND f.deleted_at IS NULL
		LEFT JOIN follow_ups f2 ON f2.record_id = mr.id AND f2.is_recovered = 1 AND f2.deleted_at IS NULL
		WHERE mr.tenant_id = ? AND DATE(mr.visit_date) BETWEEN ? AND ? AND mr.deleted_at IS NULL
	`, tenantID, startDate.Format("2006-01-02"), endDate.Format("2006-01-02")).Scan(&curCure)

	if curCure.Total > 0 {
		rate := float64(curCure.Recovered) / float64(curCure.Total) * 100
		rate = math.Round(rate*10) / 10
		summary.CureRate = &rate
	}

	// Previous period cure rate for comparison.
	var prevCure cureResult
	s.DB.Raw(`
		SELECT
			COUNT(DISTINCT mr.id) AS total,
			COUNT(DISTINCT CASE WHEN f2.id IS NOT NULL THEN mr.id END) AS recovered
		FROM medical_records mr
		JOIN follow_ups f ON f.record_id = mr.id AND f.deleted_at IS NULL
		LEFT JOIN follow_ups f2 ON f2.record_id = mr.id AND f2.is_recovered = 1 AND f2.deleted_at IS NULL
		WHERE mr.tenant_id = ? AND DATE(mr.visit_date) BETWEEN ? AND ? AND mr.deleted_at IS NULL
	`, tenantID, prevStart.Format("2006-01-02"), prevEnd.Format("2006-01-02")).Scan(&prevCure)

	if summary.CureRate != nil && prevCure.Total > 0 {
		prevRate := float64(prevCure.Recovered) / float64(prevCure.Total) * 100
		change := *summary.CureRate - prevRate
		summary.CureRateChangePercent = &change
	}

	return &DashboardResult{
		Summary:    summary,
		DailyTrend: dailyTrend,
		RevenueBreakdown: RevenueBreakdown{
			ConsultationFeeTotal: totalConsultation,
			DrugFeeTotal:         totalDrug,
		},
		PatientBreakdown: PatientBreakdown{
			NewPatients:       totalNew,
			ReturningPatients: totalReturning,
		},
	}, nil
}
