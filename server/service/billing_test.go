package service

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseDosageValue(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
	}{
		{"9g", 9},
		{"15", 15},
		{"30克", 30},
		{"2盒", 2},
		{"9.5g", 9.5},
		{"0.5", 0.5},
		{"", 0},
		{"abc", 0},
		{"  12g  ", 12},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := parseDosageValue(tt.input)
			assert.InDelta(t, tt.expected, result, 0.001)
		})
	}
}

func setupBillingTestData(t *testing.T) (*BillingService, uint64, uint64, uint64) {
	t.Helper()
	db := testutil.SetupTestDB(t)

	tenant := testutil.SeedTestTenant(t, db, "billing-clinic", "billing-test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)

	// Create patient.
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create medical record.
	record := model.MedicalRecord{
		TenantID:  tenant.ID,
		PatientID: patient.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)

	// Create prescription with items.
	prescription := model.Prescription{
		RecordID:   record.ID,
		TenantID:   tenant.ID,
		FormulaName: "麻黄汤",
		TotalDoses: 7,
		CreatedBy:  user.ID,
	}
	require.NoError(t, db.Create(&prescription).Error)

	items := []model.PrescriptionItem{
		{PrescriptionID: prescription.ID, HerbName: "麻黄", Dosage: "9g", Category: "herb", SortOrder: 1},
		{PrescriptionID: prescription.ID, HerbName: "桂枝", Dosage: "6g", Category: "herb", SortOrder: 2},
		{PrescriptionID: prescription.ID, HerbName: "感冒灵", Dosage: "2盒", Category: "patent", SortOrder: 3},
	}
	for _, item := range items {
		require.NoError(t, db.Create(&item).Error)
	}

	// Create inventory drugs.
	drugs := []model.InventoryDrug{
		{TenantID: tenant.ID, Name: "麻黄", Category: "herb", Stock: 500, SellingPrice: 0.5, PurchasePrice: 0.3},
		{TenantID: tenant.ID, Name: "桂枝", Category: "herb", Stock: 300, SellingPrice: 0.8, PurchasePrice: 0.5},
		{TenantID: tenant.ID, Name: "感冒灵", Category: "patent", Stock: 50, SellingPrice: 15, PurchasePrice: 10},
	}
	for _, drug := range drugs {
		require.NoError(t, db.Create(&drug).Error)
	}

	svc := NewBillingService(db)
	return svc, tenant.ID, user.ID, prescription.ID
}

func TestGetBillingDetail(t *testing.T) {
	svc, tenantID, _, prescriptionID := setupBillingTestData(t)

	detail, err := svc.GetBillingDetail(tenantID, prescriptionID)
	require.NoError(t, err)
	assert.Equal(t, prescriptionID, detail.PrescriptionID)
	assert.Equal(t, "麻黄汤", detail.FormulaName)
	assert.Equal(t, 7, detail.TotalDoses)
	assert.Len(t, detail.Items, 3)

	// 麻黄: 9 × 0.5 × 7 = 31.5
	assert.InDelta(t, 31.5, detail.Items[0].ItemCost, 0.01)
	assert.True(t, detail.Items[0].InStock)

	// 桂枝: 6 × 0.8 × 7 = 33.6
	assert.InDelta(t, 33.6, detail.Items[1].ItemCost, 0.01)

	// 感冒灵: 2 × 15 × 7 = 210
	assert.InDelta(t, 210, detail.Items[2].ItemCost, 0.01)

	// Total drug cost: 31.5 + 33.6 + 210 = 275.1
	assert.InDelta(t, 275.1, detail.DrugCostTotal, 0.01)

	// Default consultation fee = 100, total = 375.1
	assert.InDelta(t, 100, detail.ConsultationFee, 0.01)
	assert.InDelta(t, 375.1, detail.TotalAmount, 0.01)
	assert.False(t, detail.StockDeducted)
}

func TestGetBillingDetail_PrescriptionNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewBillingService(db)
	_, err := svc.GetBillingDetail(1, 99999)
	assert.ErrorIs(t, err, ErrPrescriptionNotFound)
}

func TestGetBillingDetail_DrugNotInInventory(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "李四")

	record := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: time.Now()}
	require.NoError(t, db.Create(&record).Error)

	prescription := model.Prescription{RecordID: record.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: user.ID}
	require.NoError(t, db.Create(&prescription).Error)

	// Item not in inventory.
	item := model.PrescriptionItem{PrescriptionID: prescription.ID, HerbName: "未知药", Dosage: "10g", Category: "herb"}
	require.NoError(t, db.Create(&item).Error)

	svc := NewBillingService(db)
	detail, err := svc.GetBillingDetail(tenant.ID, prescription.ID)
	require.NoError(t, err)
	assert.Len(t, detail.Items, 1)
	assert.False(t, detail.Items[0].InStock)
	assert.InDelta(t, 0, detail.Items[0].ItemCost, 0.01)
}

func TestCreateBilling(t *testing.T) {
	svc, tenantID, userID, prescriptionID := setupBillingTestData(t)

	req := &CreateBillingRequest{ConsultationFee: 120, ActualPaid: 400}
	billing, err := svc.CreateBilling(tenantID, userID, prescriptionID, req)
	require.NoError(t, err)
	assert.Equal(t, prescriptionID, billing.PrescriptionID)
	assert.InDelta(t, 120, billing.ConsultationFee, 0.01)
	assert.InDelta(t, 400, billing.ActualPaid, 0.01)
	assert.False(t, billing.StockDeducted)

	// Update existing billing.
	req2 := &CreateBillingRequest{ConsultationFee: 150, ActualPaid: 500}
	billing2, err := svc.CreateBilling(tenantID, userID, prescriptionID, req2)
	require.NoError(t, err)
	assert.Equal(t, billing.ID, billing2.ID)
	assert.InDelta(t, 150, billing2.ConsultationFee, 0.01)
	assert.InDelta(t, 500, billing2.ActualPaid, 0.01)
}

func TestDeductStockAndBill(t *testing.T) {
	svc, tenantID, userID, prescriptionID := setupBillingTestData(t)

	req := &CreateBillingRequest{ConsultationFee: 100, ActualPaid: 375}
	billing, err := svc.DeductStockAndBill(tenantID, userID, prescriptionID, req)
	require.NoError(t, err)
	assert.True(t, billing.StockDeducted)

	// Verify stock was deducted.
	var mahuang model.InventoryDrug
	require.NoError(t, svc.DB.Where("tenant_id = ? AND name = ?", tenantID, "麻黄").First(&mahuang).Error)
	// 500 - (9 × 7) = 437
	assert.InDelta(t, 437, mahuang.Stock, 0.01)

	var guizhi model.InventoryDrug
	require.NoError(t, svc.DB.Where("tenant_id = ? AND name = ?", tenantID, "桂枝").First(&guizhi).Error)
	// 300 - (6 × 7) = 258
	assert.InDelta(t, 258, guizhi.Stock, 0.01)

	var ganmaoling model.InventoryDrug
	require.NoError(t, svc.DB.Where("tenant_id = ? AND name = ?", tenantID, "感冒灵").First(&ganmaoling).Error)
	// 50 - (2 × 7) = 36
	assert.InDelta(t, 36, ganmaoling.Stock, 0.01)
}

func TestDeductStockAndBill_PreventDuplicate(t *testing.T) {
	svc, tenantID, userID, prescriptionID := setupBillingTestData(t)

	req := &CreateBillingRequest{ConsultationFee: 100, ActualPaid: 375}
	_, err := svc.DeductStockAndBill(tenantID, userID, prescriptionID, req)
	require.NoError(t, err)

	// Second deduction should fail.
	_, err = svc.DeductStockAndBill(tenantID, userID, prescriptionID, req)
	assert.ErrorIs(t, err, ErrStockAlreadyDeducted)
}

func TestDeductStockAndBill_InsufficientStock(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "test", "test-insuf")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "王五")

	record := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: time.Now()}
	require.NoError(t, db.Create(&record).Error)

	prescription := model.Prescription{RecordID: record.ID, TenantID: tenant.ID, TotalDoses: 100, CreatedBy: user.ID}
	require.NoError(t, db.Create(&prescription).Error)

	item := model.PrescriptionItem{PrescriptionID: prescription.ID, HerbName: "麻黄", Dosage: "9g", Category: "herb"}
	require.NoError(t, db.Create(&item).Error)

	// Only 10g in stock, but need 9 × 100 = 900.
	drug := model.InventoryDrug{TenantID: tenant.ID, Name: "麻黄", Category: "herb", Stock: 10, SellingPrice: 0.5}
	require.NoError(t, db.Create(&drug).Error)

	svc := NewBillingService(db)
	req := &CreateBillingRequest{ConsultationFee: 100, ActualPaid: 0}
	_, err := svc.DeductStockAndBill(tenant.ID, user.ID, prescription.ID, req)
	assert.ErrorIs(t, err, ErrInsufficientStock)

	// Verify stock was NOT deducted (transaction rolled back).
	var afterDrug model.InventoryDrug
	require.NoError(t, db.Where("tenant_id = ? AND name = ?", tenant.ID, "麻黄").First(&afterDrug).Error)
	assert.InDelta(t, 10, afterDrug.Stock, 0.01)
}

func TestListBillingsByRecord(t *testing.T) {
	svc, tenantID, userID, prescriptionID := setupBillingTestData(t)

	// Get the record ID from the prescription.
	var prescription model.Prescription
	require.NoError(t, svc.DB.First(&prescription, prescriptionID).Error)

	req := &CreateBillingRequest{ConsultationFee: 100, ActualPaid: 300}
	_, err := svc.CreateBilling(tenantID, userID, prescriptionID, req)
	require.NoError(t, err)

	billings, err := svc.ListBillingsByRecord(tenantID, prescription.RecordID)
	require.NoError(t, err)
	assert.Len(t, billings, 1)
	assert.Equal(t, prescriptionID, billings[0].PrescriptionID)
}

func TestBillingTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "clinic1", "c1")
	tenant2 := testutil.SeedTestTenant(t, db, "clinic2", "c2")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	patient1 := testutil.SeedTestPatient(t, db, tenant1.ID, user1.ID, "A")
	patient2 := testutil.SeedTestPatient(t, db, tenant2.ID, user2.ID, "B")

	record1 := model.MedicalRecord{TenantID: tenant1.ID, PatientID: patient1.ID, CreatedBy: user1.ID, VisitDate: time.Now()}
	require.NoError(t, db.Create(&record1).Error)
	record2 := model.MedicalRecord{TenantID: tenant2.ID, PatientID: patient2.ID, CreatedBy: user2.ID, VisitDate: time.Now()}
	require.NoError(t, db.Create(&record2).Error)

	presc1 := model.Prescription{RecordID: record1.ID, TenantID: tenant1.ID, TotalDoses: 1, CreatedBy: user1.ID}
	require.NoError(t, db.Create(&presc1).Error)
	presc2 := model.Prescription{RecordID: record2.ID, TenantID: tenant2.ID, TotalDoses: 1, CreatedBy: user2.ID}
	require.NoError(t, db.Create(&presc2).Error)

	svc := NewBillingService(db)

	// Tenant 1 cannot access tenant 2's prescription.
	_, err := svc.GetBillingDetail(tenant1.ID, presc2.ID)
	assert.ErrorIs(t, err, ErrPrescriptionNotFound)

	// Tenant 2 cannot access tenant 1's prescription.
	_, err = svc.GetBillingDetail(tenant2.ID, presc1.ID)
	assert.ErrorIs(t, err, ErrPrescriptionNotFound)
}
