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

func TestGetGlobalStats_FilteredByGroups(t *testing.T) {
	db := testutil.SetupTestDB(t)

	t1 := model.Tenant{Name: "北京诊所", Code: "gs_bj1", Status: 1, GroupName: "华北分组"}
	t2 := model.Tenant{Name: "上海诊所", Code: "gs_sh1", Status: 1, GroupName: "华东分组"}
	require.NoError(t, db.Create(&t1).Error)
	require.NoError(t, db.Create(&t2).Error)

	day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	require.NoError(t, db.Create(&model.DailyStats{
		TenantID: t1.ID, StatDate: day,
		Revenue: 1000, RecordCount: 10,
		NewPatientCount: 3, ReturningPatientCount: 7,
	}).Error)
	require.NoError(t, db.Create(&model.DailyStats{
		TenantID: t2.ID, StatDate: day,
		Revenue: 2000, RecordCount: 20,
		NewPatientCount: 5, ReturningPatientCount: 15,
	}).Error)

	svc := service.NewAdminStatisticsService(db)

	// Unfiltered: both tenants
	all, err := svc.GetGlobalStats(day, day, 1, 50, nil)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, all.Total, 2)

	// Filtered by 华北分组: only t1
	filtered, err := svc.GetGlobalStats(day, day, 1, 50, []string{"华北分组"})
	require.NoError(t, err)
	assert.Equal(t, 1, filtered.Total)
	assert.Equal(t, "北京诊所", filtered.Tenants[0].TenantName)
}
