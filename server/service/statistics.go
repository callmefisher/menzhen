package service

import (
	"fmt"
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
	nextDate := statDate.AddDate(0, 0, 1)

	// 1. Count medical records on this date (range query for index).
	var recordCount int64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND visit_date >= ? AND visit_date < ?", tenantID, statDate, nextDate).
		Count(&recordCount)

	// 2. Aggregate billing amounts by billings.created_at (revenue reflects actual billing date).
	type billingSummary struct {
		Revenue         float64
		ConsultationFee float64
	}
	var summary billingSummary
	// 以实收为准：每笔诊金不超过该笔实收，避免药费为负
	// Uses idx_billing_tenant_created composite index for efficient range scan on 5M+ rows.
	s.DB.Model(&model.Billing{}).
		Select("COALESCE(SUM(billings.actual_paid), 0) AS revenue, COALESCE(SUM(LEAST(billings.consultation_fee, billings.actual_paid)), 0) AS consultation_fee").
		Joins("JOIN medical_records ON medical_records.id = billings.record_id AND medical_records.deleted_at IS NULL").
		Where("billings.tenant_id = ? AND billings.created_at >= ? AND billings.created_at < ? AND billings.deleted_at IS NULL", tenantID, statDate, nextDate).
		Scan(&summary)

	drugFee := summary.Revenue - summary.ConsultationFee

	// 3. Classify patients who visited today as new vs returning.
	//    Single batch query replaces N+1 loop.
	var patientIDs []uint64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND visit_date >= ? AND visit_date < ?", tenantID, statDate, nextDate).
		Distinct("patient_id").
		Pluck("patient_id", &patientIDs)

	newCount := 0
	returningCount := 0
	if len(patientIDs) > 0 {
		type firstVisitRow struct {
			PatientID  uint64
			FirstVisit time.Time
		}
		var rows []firstVisitRow
		s.DB.Model(&model.MedicalRecord{}).
			Select("patient_id, MIN(visit_date) AS first_visit").
			Where("tenant_id = ? AND patient_id IN ?", tenantID, patientIDs).
			Group("patient_id").
			Scan(&rows)

		for _, r := range rows {
			firstDate := time.Date(r.FirstVisit.Year(), r.FirstVisit.Month(), r.FirstVisit.Day(), 0, 0, 0, 0, r.FirstVisit.Location())
			if firstDate.Equal(statDate) {
				newCount++
			} else {
				returningCount++
			}
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

	// Collect all distinct visit dates (for record/patient stats).
	var visitDates []time.Time
	s.DB.Model(&model.MedicalRecord{}).
		Select("DATE(visit_date) AS visit_date").
		Where("tenant_id = ?", tenantID).
		Group("DATE(visit_date)").
		Pluck("visit_date", &visitDates)

	// Collect all distinct billing dates (for revenue stats).
	var billingDates []time.Time
	s.DB.Model(&model.Billing{}).
		Select("DATE(created_at) AS billing_date").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Group("DATE(created_at)").
		Pluck("billing_date", &billingDates)

	// Merge and deduplicate dates.
	seen := make(map[string]bool, len(visitDates)+len(billingDates))
	var allDates []time.Time
	for _, d := range visitDates {
		key := d.Format("2006-01-02")
		if !seen[key] {
			seen[key] = true
			allDates = append(allDates, d)
		}
	}
	for _, d := range billingDates {
		key := d.Format("2006-01-02")
		if !seen[key] {
			seen[key] = true
			allDates = append(allDates, d)
		}
	}

	for _, d := range allDates {
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
	// endDate is inclusive, so use next day for range upper bound.
	cureEndNext := endDate.AddDate(0, 0, 1)
	s.DB.Raw(`
		SELECT
			COUNT(DISTINCT mr.id) AS total,
			COUNT(DISTINCT CASE WHEN f2.id IS NOT NULL THEN mr.id END) AS recovered
		FROM medical_records mr
		JOIN follow_ups f ON f.record_id = mr.id AND f.deleted_at IS NULL
		LEFT JOIN follow_ups f2 ON f2.record_id = mr.id AND f2.is_recovered = 1 AND f2.deleted_at IS NULL
		WHERE mr.tenant_id = ? AND mr.visit_date >= ? AND mr.visit_date < ? AND mr.deleted_at IS NULL
	`, tenantID, startDate, cureEndNext).Scan(&curCure)

	if curCure.Total > 0 {
		rate := float64(curCure.Recovered) / float64(curCure.Total) * 100
		rate = math.Round(rate*10) / 10
		summary.CureRate = &rate
	}

	// Previous period cure rate for comparison.
	var prevCure cureResult
	prevEndNext := prevEnd.AddDate(0, 0, 1)
	s.DB.Raw(`
		SELECT
			COUNT(DISTINCT mr.id) AS total,
			COUNT(DISTINCT CASE WHEN f2.id IS NOT NULL THEN mr.id END) AS recovered
		FROM medical_records mr
		JOIN follow_ups f ON f.record_id = mr.id AND f.deleted_at IS NULL
		LEFT JOIN follow_ups f2 ON f2.record_id = mr.id AND f2.is_recovered = 1 AND f2.deleted_at IS NULL
		WHERE mr.tenant_id = ? AND mr.visit_date >= ? AND mr.visit_date < ? AND mr.deleted_at IS NULL
	`, tenantID, prevStart, prevEndNext).Scan(&prevCure)

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

// StaffRevenueItem holds aggregated stats for one user over the queried date range.
type StaffRevenueItem struct {
	UserID          uint64  `json:"user_id"`
	RealName        string  `json:"real_name"`
	Revenue         float64 `json:"revenue"`
	ConsultationFee float64 `json:"consultation_fee"`
	DrugFee         float64 `json:"drug_fee"`
	RecordCount     int     `json:"record_count"`
	AvgPerRecord    float64 `json:"avg_per_record"`
	RevenuePercent  float64 `json:"revenue_percent"`
}

// StaffRevenueSummary holds team-level totals.
type StaffRevenueSummary struct {
	TotalRevenue float64 `json:"total_revenue"`
	TotalRecords int     `json:"total_records"`
	StaffCount   int     `json:"staff_count"`
	AvgPerRecord float64 `json:"avg_per_record"`
}

// StaffRevenueResult is the response type for GetStaffRevenue.
type StaffRevenueResult struct {
	Summary StaffRevenueSummary `json:"summary"`
	Staff   []StaffRevenueItem  `json:"staff"`
}

// RefreshDailyStaffStats recomputes and upserts the stats row for one user on one date.
// Revenue = billings created on date for records owned by userID.
// RecordCount = records visited on date owned by userID.
// Drug fee = revenue - LEAST(consultation_fee, actual_paid) per billing (never negative).
func (s *StatisticsService) RefreshDailyStaffStats(tenantID, userID uint64, date time.Time) error {
	statDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	nextDate := statDate.AddDate(0, 0, 1)

	type billingSummary struct {
		Revenue         float64
		ConsultationFee float64
	}
	var summary billingSummary
	s.DB.Model(&model.Billing{}).
		Select("COALESCE(SUM(billings.actual_paid), 0) AS revenue, "+
			"COALESCE(SUM(LEAST(billings.consultation_fee, billings.actual_paid)), 0) AS consultation_fee").
		Joins("JOIN medical_records ON medical_records.id = billings.record_id AND medical_records.deleted_at IS NULL").
		Where("billings.tenant_id = ? AND medical_records.created_by = ? "+
			"AND billings.created_at >= ? AND billings.created_at < ? AND billings.deleted_at IS NULL",
			tenantID, userID, statDate, nextDate).
		Scan(&summary)

	drugFee := summary.Revenue - summary.ConsultationFee

	var recordCount int64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND created_by = ? AND visit_date >= ? AND visit_date < ? AND deleted_at IS NULL",
			tenantID, userID, statDate, nextDate).
		Count(&recordCount)

	stats := model.DailyStaffStats{
		TenantID:        tenantID,
		UserID:          userID,
		StatDate:        statDate,
		Revenue:         summary.Revenue,
		ConsultationFee: summary.ConsultationFee,
		DrugFee:         drugFee,
		RecordCount:     int(recordCount),
	}

	return s.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "tenant_id"}, {Name: "user_id"}, {Name: "stat_date"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"revenue", "consultation_fee", "drug_fee", "record_count", "updated_at",
		}),
	}).Create(&stats).Error
}

// RebuildAllDailyStaffStats drops and recomputes every daily_staff_stats row for the given tenant.
func (s *StatisticsService) RebuildAllDailyStaffStats(tenantID uint64) error {
	if err := s.DB.Where("tenant_id = ?", tenantID).Delete(&model.DailyStaffStats{}).Error; err != nil {
		return err
	}

	type userDate struct {
		UserID uint64
		Date   time.Time
	}

	// Billing dates per user (via record.created_by).
	var billingCombos []userDate
	s.DB.Raw(`
		SELECT mr.created_by AS user_id, DATE(b.created_at) AS date
		FROM billings b
		JOIN medical_records mr ON mr.id = b.record_id AND mr.deleted_at IS NULL
		WHERE b.tenant_id = ? AND b.deleted_at IS NULL
		GROUP BY mr.created_by, DATE(b.created_at)
	`, tenantID).Scan(&billingCombos)

	// Visit dates per user.
	var visitCombos []userDate
	s.DB.Model(&model.MedicalRecord{}).
		Select("created_by AS user_id, DATE(visit_date) AS date").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Group("created_by, DATE(visit_date)").
		Scan(&visitCombos)

	// Merge and deduplicate.
	seen := make(map[string]bool, len(billingCombos)+len(visitCombos))
	all := make([]userDate, 0, len(billingCombos)+len(visitCombos))
	for _, c := range append(billingCombos, visitCombos...) {
		key := fmt.Sprintf("%d_%s", c.UserID, c.Date.Format("2006-01-02"))
		if !seen[key] {
			seen[key] = true
			all = append(all, c)
		}
	}

	for _, c := range all {
		if err := s.RefreshDailyStaffStats(tenantID, c.UserID, c.Date); err != nil {
			return err
		}
	}
	return nil
}

// GetStaffRevenue aggregates daily_staff_stats for the given date range and returns
// per-user revenue sorted by total revenue descending.
// Queries the pre-aggregated table — O(doctors × days) not O(billings), safe at 10M+ rows.
func (s *StatisticsService) GetStaffRevenue(tenantID uint64, startDate, endDate time.Time) (*StaffRevenueResult, error) {
	type staffAgg struct {
		UserID          uint64
		Revenue         float64
		ConsultationFee float64
		DrugFee         float64
		RecordCount     int
	}
	var rows []staffAgg
	s.DB.Model(&model.DailyStaffStats{}).
		Select("user_id, SUM(revenue) AS revenue, SUM(consultation_fee) AS consultation_fee, "+
			"SUM(drug_fee) AS drug_fee, SUM(record_count) AS record_count").
		Where("tenant_id = ? AND stat_date >= ? AND stat_date <= ?", tenantID, startDate, endDate).
		Group("user_id").
		Order("revenue DESC").
		Scan(&rows)

	if len(rows) == 0 {
		return &StaffRevenueResult{
			Summary: StaffRevenueSummary{},
			Staff:   []StaffRevenueItem{},
		}, nil
	}

	// Fetch user names in a single query.
	userIDs := make([]uint64, len(rows))
	for i, r := range rows {
		userIDs[i] = r.UserID
	}
	var users []model.User
	s.DB.Select("id, real_name").Where("tenant_id = ? AND id IN ?", tenantID, userIDs).Find(&users)
	nameMap := make(map[uint64]string, len(users))
	for _, u := range users {
		nameMap[u.ID] = u.RealName
	}

	// Compute summary.
	var totalRevenue float64
	var totalRecords int
	for _, r := range rows {
		totalRevenue += r.Revenue
		totalRecords += r.RecordCount
	}
	var summaryAvg float64
	if totalRecords > 0 {
		summaryAvg = math.Round(totalRevenue/float64(totalRecords)*100) / 100
	}

	// Build staff items.
	staff := make([]StaffRevenueItem, len(rows))
	for i, r := range rows {
		var avgPerRecord float64
		if r.RecordCount > 0 {
			avgPerRecord = r.Revenue / float64(r.RecordCount)
		}
		var pct float64
		if totalRevenue > 0 {
			pct = r.Revenue / totalRevenue * 100
		}
		staff[i] = StaffRevenueItem{
			UserID:          r.UserID,
			RealName:        nameMap[r.UserID],
			Revenue:         r.Revenue,
			ConsultationFee: r.ConsultationFee,
			DrugFee:         r.DrugFee,
			RecordCount:     r.RecordCount,
			AvgPerRecord:    avgPerRecord,
			RevenuePercent:  pct,
		}
	}

	return &StaffRevenueResult{
		Summary: StaffRevenueSummary{
			TotalRevenue: totalRevenue,
			TotalRecords: totalRecords,
			StaffCount:   len(rows),
			AvgPerRecord: summaryAvg,
		},
		Staff: staff,
	}, nil
}
