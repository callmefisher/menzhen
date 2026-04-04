package service_test

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetGlobalStats_MultiTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	t1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	t2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	db.Create(&model.DailyStats{TenantID: t1.ID, StatDate: date, Revenue: 1000, RecordCount: 10, NewPatientCount: 3, ReturningPatientCount: 7})
	db.Create(&model.DailyStats{TenantID: t2.ID, StatDate: date, Revenue: 500, RecordCount: 5, NewPatientCount: 2, ReturningPatientCount: 3})

	svc := service.NewAdminStatisticsService(db)
	result, err := svc.GetGlobalStats(date, date, 1, 50, nil)
	require.NoError(t, err)

	assert.Equal(t, float64(1500), result.Summary.TotalRevenue)
	assert.Equal(t, 15, result.Summary.TotalRecords)
	assert.Equal(t, 15, result.Summary.TotalPatients)
	assert.Equal(t, 2, result.Summary.TenantCount)
	assert.Equal(t, float64(100), result.Summary.AvgRevenuePerRecord)
	require.Len(t, result.Tenants, 2)
	assert.Equal(t, t1.ID, result.Tenants[0].TenantID)
	assert.Equal(t, "诊所A", result.Tenants[0].TenantName)
	assert.InDelta(t, 66.67, result.Tenants[0].RevenuePercent, 0.1)
}

func TestGetGlobalStats_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewAdminStatisticsService(db)
	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	result, err := svc.GetGlobalStats(date, date, 1, 50, nil)
	require.NoError(t, err)
	assert.Equal(t, float64(0), result.Summary.TotalRevenue)
	assert.Empty(t, result.Tenants)
}

func TestGetGlobalStats_Pagination(t *testing.T) {
	db := testutil.SetupTestDB(t)
	for i := 0; i < 3; i++ {
		tn := testutil.SeedTestTenant(t, db, "诊所"+string(rune('A'+i)), "clinic-"+string(rune('a'+i)))
		date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
		db.Create(&model.DailyStats{TenantID: tn.ID, StatDate: date, Revenue: float64((3 - i) * 100), RecordCount: 1})
	}
	svc := service.NewAdminStatisticsService(db)
	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	result, err := svc.GetGlobalStats(date, date, 1, 2, nil)
	require.NoError(t, err)
	assert.Equal(t, 3, result.Summary.TenantCount)
	assert.Len(t, result.Tenants, 2)
}
