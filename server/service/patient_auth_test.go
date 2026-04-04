package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPatientAuthService_Login_NewUser_AutoCreatesPatient(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	// Tenant must exist
	tenant := model.Tenant{Name: "测试诊所", Code: "test001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	pu, err := svc.Login(uint64(tenant.ID), "13800138001", "张三")
	require.NoError(t, err)
	assert.Equal(t, "13800138001", pu.Phone)
	assert.Equal(t, "张三", pu.Name)
	assert.NotNil(t, pu.PatientID, "should auto-create patient record")

	// Patient record should exist
	var patient model.Patient
	require.NoError(t, db.First(&patient, *pu.PatientID).Error)
	assert.Equal(t, "张三", patient.Name)
}

func TestPatientAuthService_Login_ExistingPatientLinked(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "联动诊所", Code: "link001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	// Pre-existing patient record with matching phone
	existing := model.Patient{TenantID: uint64(tenant.ID), Name: "李四", Phone: "13900139002", Gender: 1, CreatedBy: 1}
	require.NoError(t, db.Create(&existing).Error)

	pu, err := svc.Login(uint64(tenant.ID), "13900139002", "李四")
	require.NoError(t, err)
	require.NotNil(t, pu.PatientID)
	assert.Equal(t, existing.ID, *pu.PatientID, "should link to existing patient")
}

func TestPatientAuthService_Login_ExistingUser_WrongName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "安全诊所", Code: "sec001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	// First login creates the account
	_, err := svc.Login(uint64(tenant.ID), "13700137003", "王五")
	require.NoError(t, err)

	// Second login with wrong name
	_, err = svc.Login(uint64(tenant.ID), "13700137003", "错误姓名")
	assert.ErrorIs(t, err, service.ErrPatientWrongCredentials)
}

func TestPatientAuthService_Login_LoginDisabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "关闭诊所", Code: "off001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	cfg := model.PatientPortalConfig{TenantID: uint64(tenant.ID), LoginEnabled: false, RegisterEnabled: true, AppointmentEnabled: true, QueueEnabled: true, RecordsEnabled: true}
	require.NoError(t, db.Create(&cfg).Error)

	_, err := svc.Login(uint64(tenant.ID), "13600136004", "赵六")
	assert.ErrorIs(t, err, service.ErrPatientLoginDisabled)
}

func TestPatientAuthService_Login_RegisterDisabled_NewUser(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "禁注诊所", Code: "noreg001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	cfg := model.PatientPortalConfig{TenantID: uint64(tenant.ID), LoginEnabled: true, RegisterEnabled: false, AppointmentEnabled: true, QueueEnabled: true, RecordsEnabled: true}
	require.NoError(t, db.Create(&cfg).Error)

	_, err := svc.Login(uint64(tenant.ID), "13500135005", "新用户")
	assert.ErrorIs(t, err, service.ErrPatientRegisterDisabled)
}
