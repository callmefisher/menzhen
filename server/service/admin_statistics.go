package service

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// GlobalTenantItem holds per-tenant aggregated stats for one query period.
type GlobalTenantItem struct {
	TenantID       uint64  `json:"tenant_id"`
	TenantName     string  `json:"tenant_name"`
	Revenue        float64 `json:"revenue"`
	Records        int     `json:"records"`
	Patients       int     `json:"patients"`
	AvgPerRecord   float64 `json:"avg_per_record"`
	RevenuePercent float64 `json:"revenue_percent"`
}

// GlobalSummary holds platform-wide totals.
type GlobalSummary struct {
	TotalRevenue        float64 `json:"total_revenue"`
	TotalRecords        int     `json:"total_records"`
	TotalPatients       int     `json:"total_patients"`
	AvgRevenuePerRecord float64 `json:"avg_revenue_per_record"`
	TenantCount         int     `json:"tenant_count"`
}

// GlobalStatsResult is the response type for GetGlobalStats.
type GlobalStatsResult struct {
	Total   int                `json:"total"`
	Summary GlobalSummary      `json:"summary"`
	Tenants []GlobalTenantItem `json:"tenants"`
}

type globalCacheEntry struct {
	result    *GlobalStatsResult
	expiresAt time.Time
}

// AdminStatisticsService aggregates daily_stats across all tenants.
type AdminStatisticsService struct {
	db    *gorm.DB
	cache sync.Map // key: "start:end:page:size" → *globalCacheEntry; TTL 5 min
}

// NewAdminStatisticsService creates a new AdminStatisticsService.
func NewAdminStatisticsService(db *gorm.DB) *AdminStatisticsService {
	return &AdminStatisticsService{db: db}
}

// GetGlobalStats returns platform-wide aggregated stats for the given date range.
// Results are cached in memory for 5 minutes to reduce DB load at large scale.
// page and size control the returned tenants slice; Summary.Total reflects all tenants.
// groupNames restricts results to tenants belonging to those groups; nil/empty means no restriction.
func (s *AdminStatisticsService) GetGlobalStats(startDate, endDate time.Time, page, size int, groupNames []string) (*GlobalStatsResult, error) {
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 50
	}

	groupKey := strings.Join(groupNames, ",")
	cacheKey := fmt.Sprintf("%s:%s:%d:%d:%s",
		startDate.Format("2006-01-02"), endDate.Format("2006-01-02"), page, size, groupKey)

	if v, ok := s.cache.Load(cacheKey); ok {
		entry := v.(*globalCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.result, nil
		}
		s.cache.Delete(cacheKey)
	}

	type row struct {
		TenantID   uint64
		TenantName string
		Revenue    float64
		Records    int
		Patients   int
	}

	// COUNT distinct tenants that have stats in the date range, optionally filtered by group.
	countQ := s.db.Model(&model.DailyStats{}).
		Where("stat_date >= ? AND stat_date <= ?", startDate, endDate)
	if len(groupNames) > 0 {
		countQ = countQ.Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
			Where("tenants.group_name IN ?", groupNames)
	}
	var totalCount int64
	if err := countQ.Distinct("daily_stats.tenant_id").Count(&totalCount).Error; err != nil {
		return nil, fmt.Errorf("count tenants: %w", err)
	}

	// Per-tenant aggregated rows (always JOINs tenants for the name column).
	var rows []row
	offset := (page - 1) * size
	q := s.db.Model(&model.DailyStats{}).
		Select("daily_stats.tenant_id, tenants.name AS tenant_name, "+
			"SUM(daily_stats.revenue) AS revenue, "+
			"SUM(daily_stats.record_count) AS records, "+
			"SUM(daily_stats.new_patient_count + daily_stats.returning_patient_count) AS patients").
		Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
		Where("daily_stats.stat_date >= ? AND daily_stats.stat_date <= ?", startDate, endDate)
	if len(groupNames) > 0 {
		q = q.Where("tenants.group_name IN ?", groupNames)
	}
	if err := q.Group("daily_stats.tenant_id, tenants.name").
		Order("revenue DESC").
		Limit(size).Offset(offset).
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("query tenants: %w", err)
	}

	// Platform-wide totals, also filtered by group when applicable.
	type totalRow struct {
		TotalRevenue  float64
		TotalRecords  int
		TotalPatients int
	}
	var totals totalRow
	totalsQ := s.db.Model(&model.DailyStats{}).
		Select("SUM(revenue) AS total_revenue, SUM(record_count) AS total_records, "+
			"SUM(new_patient_count + returning_patient_count) AS total_patients").
		Where("stat_date >= ? AND stat_date <= ?", startDate, endDate)
	if len(groupNames) > 0 {
		totalsQ = totalsQ.Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
			Where("tenants.group_name IN ?", groupNames)
	}
	if err := totalsQ.Scan(&totals).Error; err != nil {
		return nil, fmt.Errorf("query totals: %w", err)
	}

	var avgPerRecord float64
	if totals.TotalRecords > 0 {
		avgPerRecord = math.Round(totals.TotalRevenue/float64(totals.TotalRecords)*100) / 100 // round to 2 decimal places
	}

	tenants := make([]GlobalTenantItem, len(rows))
	for i, r := range rows {
		var avg float64
		if r.Records > 0 {
			avg = math.Round(r.Revenue/float64(r.Records)*100) / 100 // round to 2 decimal places
		}
		var pct float64
		if totals.TotalRevenue > 0 {
			pct = math.Round(r.Revenue/totals.TotalRevenue*1000) / 10 // round to 1 decimal place
		}
		tenants[i] = GlobalTenantItem{
			TenantID:       r.TenantID,
			TenantName:     r.TenantName,
			Revenue:        r.Revenue,
			Records:        r.Records,
			Patients:       r.Patients,
			AvgPerRecord:   avg,
			RevenuePercent: pct,
		}
	}

	result := &GlobalStatsResult{
		Total: int(totalCount),
		Summary: GlobalSummary{
			TotalRevenue:        totals.TotalRevenue,
			TotalRecords:        totals.TotalRecords,
			TotalPatients:       totals.TotalPatients,
			AvgRevenuePerRecord: avgPerRecord,
			TenantCount:         int(totalCount),
		},
		Tenants: tenants,
	}

	// NOTE: Cache is not invalidated when daily stats are rebuilt. Stale data will be served
	// for up to 5 minutes. If immediate freshness is required after a rebuild, restart the server
	// or implement a ClearCache() method on this service.
	s.cache.Store(cacheKey, &globalCacheEntry{result: result, expiresAt: time.Now().Add(5 * time.Minute)})
	return result, nil
}
