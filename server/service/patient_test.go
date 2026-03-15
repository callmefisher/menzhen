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

func TestCreatePatient_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	svc := service.NewPatientService(db)
	req := &service.CreatePatientRequest{
		Name:    "王五",
		Gender:  1,
		Age:     45,
		Phone:   "13800138000",
		Address: "北京市朝阳区",
		Notes:   "高血压病史",
	}

	patient, err := svc.CreatePatient(tenant.ID, user.ID, req)

	assert.NoError(t, err)
	assert.NotNil(t, patient)
	assert.NotZero(t, patient.ID)
	assert.Equal(t, "王五", patient.Name)
	assert.Equal(t, int8(1), patient.Gender)
	assert.Equal(t, 45, patient.Age)
	assert.Equal(t, "13800138000", patient.Phone)
	assert.Equal(t, "北京市朝阳区", patient.Address)
	assert.Equal(t, "高血压病史", patient.Notes)
	assert.Equal(t, tenant.ID, patient.TenantID)
	assert.Equal(t, user.ID, patient.CreatedBy)
}

func TestCreatePatient_WithBirthday(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	birthday := "1990-06-15"
	svc := service.NewPatientService(db)
	req := &service.CreatePatientRequest{
		Name:     "赵六",
		Gender:   2,
		Age:      0, // Should be auto-calculated from birthday.
		Birthday: &birthday,
	}

	patient, err := svc.CreatePatient(tenant.ID, user.ID, req)

	assert.NoError(t, err)
	assert.NotNil(t, patient)
	assert.NotNil(t, patient.Birthday)
	// Age should be auto-calculated (born 1990-06-15, now 2026 => 35 or 36 depending on month).
	assert.Greater(t, patient.Age, 0)
	assert.Equal(t, "赵六", patient.Name)
}

func TestCreatePatient_ChineseCharacters(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	svc := service.NewPatientService(db)
	req := &service.CreatePatientRequest{
		Name:        "欧阳修远",
		Gender:      1,
		Age:         60,
		NativePlace: "湖南省长沙市",
		Address:     "上海市浦东新区陆家嘴金融中心",
		Notes:       "患者自述：头晕目眩，心悸气短。舌淡苔白，脉细弱。",
	}

	patient, err := svc.CreatePatient(tenant.ID, user.ID, req)

	assert.NoError(t, err)
	assert.Equal(t, "欧阳修远", patient.Name)
	assert.Equal(t, "湖南省长沙市", patient.NativePlace)
	assert.Equal(t, "上海市浦东新区陆家嘴金融中心", patient.Address)
	assert.Contains(t, patient.Notes, "头晕目眩")
}

func TestGetPatient_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	svc := service.NewPatientService(db)
	patient, err := svc.GetPatient(tenant.ID, seeded.ID)

	assert.NoError(t, err)
	assert.NotNil(t, patient)
	assert.Equal(t, seeded.ID, patient.ID)
	assert.Equal(t, "张三", patient.Name)
	assert.Equal(t, tenant.ID, patient.TenantID)
}

func TestGetPatient_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "doctorA", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "张三")

	svc := service.NewPatientService(db)
	// Attempt to access tenant A's patient from tenant B.
	patient, err := svc.GetPatient(tenantB.ID, seeded.ID)

	assert.Nil(t, patient)
	assert.ErrorIs(t, err, service.ErrPatientNotFound)
}

func TestGetPatient_PreloadLimit(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所Limit", "clinic-limit")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor", "pass123", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "多记录患者")

	// Create 110 medical records for this patient (exceeds 100 limit).
	for i := 0; i < 110; i++ {
		day := time.Date(2025, 1, 1, 0, 0, 0, 0, time.Local).AddDate(0, 0, i)
		r := model.MedicalRecord{
			TenantID:  tenant.ID,
			PatientID: patient.ID,
			CreatedBy: user.ID,
			VisitDate: day,
			Diagnosis: "诊断",
		}
		require.NoError(t, db.Create(&r).Error)
	}

	svc := service.NewPatientService(db)
	result, err := svc.GetPatient(tenant.ID, patient.ID)
	require.NoError(t, err)

	// Should be capped at 100 records.
	assert.LessOrEqual(t, len(result.MedicalRecords), 100)
}

func TestListPatients_Pagination(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	// Create 5 patients.
	for i := 0; i < 5; i++ {
		testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "患者"+string(rune('A'+i)))
	}

	svc := service.NewPatientService(db)

	// Page 1, size 2.
	patients, total, err := svc.ListPatients(tenant.ID, "", 1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, patients, 2)

	// Page 3, size 2 — should return 1 patient.
	patients, total, err = svc.ListPatients(tenant.ID, "", 3, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, patients, 1)
}

func TestListPatients_SearchByName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")
	testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张四")
	testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "李五")

	svc := service.NewPatientService(db)

	// Search for "张" should return 2.
	patients, total, err := svc.ListPatients(tenant.ID, "张", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, patients, 2)

	// Search for "李" should return 1.
	patients, total, err = svc.ListPatients(tenant.ID, "李", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, patients, 1)
	assert.Equal(t, "李五", patients[0].Name)
}

func TestListPatients_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	svc := service.NewPatientService(db)
	patients, total, err := svc.ListPatients(tenant.ID, "", 1, 10)

	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Empty(t, patients)
}

func TestUpdatePatient_PartialUpdate(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	svc := service.NewPatientService(db)
	newPhone := "13900139000"
	newNotes := "更新备注"
	req := &service.UpdatePatientRequest{
		Phone: &newPhone,
		Notes: &newNotes,
	}

	old, updated, err := svc.UpdatePatient(tenant.ID, seeded.ID, req)

	assert.NoError(t, err)
	assert.NotNil(t, old)
	assert.NotNil(t, updated)
	// Old data should have original values.
	assert.Equal(t, "张三", old.Name)
	assert.Empty(t, old.Phone)
	// Updated data should reflect partial changes.
	assert.Equal(t, "张三", updated.Name) // Name unchanged.
	assert.Equal(t, "13900139000", updated.Phone)
	assert.Equal(t, "更新备注", updated.Notes)
}

func TestPatientService_UpdatePatient_AllFields(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "原始名")

	svc := service.NewPatientService(db)

	newName := "新名字"
	newGender := int8(2)
	newAge := 50
	newWeight := 65.5
	newPhone := "13700137000"
	newIDCard := "110101199001011234"
	newAddress := "上海市浦东新区"
	newNativePlace := "江苏省南京市"
	newNotes := "全字段更新备注"
	newBirthday := "1976-03-15"

	req := &service.UpdatePatientRequest{
		Name:        &newName,
		Gender:      &newGender,
		Age:         &newAge,
		Weight:      &newWeight,
		Phone:       &newPhone,
		IDCard:      &newIDCard,
		Address:     &newAddress,
		NativePlace: &newNativePlace,
		Notes:       &newNotes,
		Birthday:    &newBirthday,
	}

	old, updated, err := svc.UpdatePatient(tenant.ID, seeded.ID, req)

	assert.NoError(t, err)
	assert.NotNil(t, old)
	assert.NotNil(t, updated)

	// Verify old snapshot has original name.
	assert.Equal(t, "原始名", old.Name)

	// Verify all fields updated.
	assert.Equal(t, "新名字", updated.Name)
	assert.Equal(t, int8(2), updated.Gender)
	// Age is auto-calculated from Birthday (1976-03-15), so just verify it's positive.
	assert.Greater(t, updated.Age, 0)
	assert.Equal(t, 65.5, updated.Weight)
	assert.Equal(t, "13700137000", updated.Phone)
	assert.Equal(t, "110101199001011234", updated.IDCard)
	assert.Equal(t, "上海市浦东新区", updated.Address)
	assert.Equal(t, "江苏省南京市", updated.NativePlace)
	assert.Equal(t, "全字段更新备注", updated.Notes)
	assert.NotNil(t, updated.Birthday)
}

func TestUpdatePatient_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "doctorA", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "张三")

	svc := service.NewPatientService(db)
	newName := "被修改"
	req := &service.UpdatePatientRequest{Name: &newName}

	old, updated, err := svc.UpdatePatient(tenantB.ID, seeded.ID, req)

	assert.Nil(t, old)
	assert.Nil(t, updated)
	assert.ErrorIs(t, err, service.ErrPatientNotFound)
}

func TestDeletePatient_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	svc := service.NewPatientService(db)
	deleted, err := svc.DeletePatient(tenant.ID, seeded.ID)

	assert.NoError(t, err)
	assert.NotNil(t, deleted)
	assert.Equal(t, seeded.ID, deleted.ID)
	assert.Equal(t, "张三", deleted.Name)

	// Verify patient is no longer found (soft-deleted).
	_, err = svc.GetPatient(tenant.ID, seeded.ID)
	assert.ErrorIs(t, err, service.ErrPatientNotFound)
}

func TestDeletePatient_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "doctorA", "pass123", nil)
	seeded := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "张三")

	svc := service.NewPatientService(db)
	deleted, err := svc.DeletePatient(tenantB.ID, seeded.ID)

	assert.Nil(t, deleted)
	assert.ErrorIs(t, err, service.ErrPatientNotFound)
}
