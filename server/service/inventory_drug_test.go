package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupInventoryDrugService(t *testing.T) (*service.InventoryDrugService, uint64, uint64) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	svc := service.NewInventoryDrugService(db)
	return svc, tenant1.ID, tenant2.ID
}

func ptrFloat64(v float64) *float64 { return &v }
func ptrString(v string) *string    { return &v }

func seedInventoryDrugs(t *testing.T, svc *service.InventoryDrugService, tenantID uint64) []*model.InventoryDrug {
	threshold := 10.0
	drugs := []service.CreateInventoryDrugRequest{
		{Name: "黄芪饮片", Category: "herb", Stock: 100, PurchasePrice: 30, SellingPrice: 50, AlertThreshold: &threshold},
		{Name: "当归饮片", Category: "herb", Stock: 80, PurchasePrice: 25, SellingPrice: 40},
		{Name: "六味地黄丸", Category: "patent", Stock: 50, PurchasePrice: 15, SellingPrice: 28},
	}
	var result []*model.InventoryDrug
	for _, req := range drugs {
		r := req
		drug, err := svc.Create(tenantID, &r)
		assert.NoError(t, err)
		result = append(result, drug)
	}
	return result
}

func TestInventoryDrugService_List_Success(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seedInventoryDrugs(t, svc, tenantID)

	drugs, total, err := svc.List(tenantID, "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, drugs, 3)
}

func TestInventoryDrugService_List_FilterByName(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seedInventoryDrugs(t, svc, tenantID)

	drugs, total, err := svc.List(tenantID, "黄芪", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, drugs, 1)
	assert.Equal(t, "黄芪饮片", drugs[0].Name)
}

func TestInventoryDrugService_List_FilterByCategory(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seedInventoryDrugs(t, svc, tenantID)

	drugs, total, err := svc.List(tenantID, "", "patent", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, drugs, 1)
	assert.Equal(t, "六味地黄丸", drugs[0].Name)
}

func TestInventoryDrugService_List_TenantIsolation(t *testing.T) {
	svc, tenantID1, tenantID2 := setupInventoryDrugService(t)
	seedInventoryDrugs(t, svc, tenantID1)

	// Tenant 2 should see nothing
	drugs, total, err := svc.List(tenantID2, "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, drugs, 0)
}

func TestInventoryDrugService_Create_Success(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)

	threshold := 5.0
	req := &service.CreateInventoryDrugRequest{
		Name:           "板蓝根颗粒",
		Category:       "patent",
		Stock:          200,
		PurchasePrice:  8,
		SellingPrice:   15,
		AlertThreshold: &threshold,
		Remark:         "常备药",
	}
	drug, err := svc.Create(tenantID, req)
	assert.NoError(t, err)
	assert.NotZero(t, drug.ID)
	assert.Equal(t, "板蓝根颗粒", drug.Name)
	assert.Equal(t, "patent", drug.Category)
	assert.Equal(t, float64(200), drug.Stock)
	assert.NotNil(t, drug.AlertThreshold)
	assert.Equal(t, 5.0, *drug.AlertThreshold)
	assert.Equal(t, "常备药", drug.Remark)
}

func TestInventoryDrugService_Update_Success(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID)

	newName := "黄芪饮片(特级)"
	newPrice := 60.0
	req := &service.UpdateInventoryDrugRequest{
		Name:         &newName,
		SellingPrice: &newPrice,
	}

	oldDrug, newDrug, err := svc.Update(tenantID, seeded[0].ID, req)
	assert.NoError(t, err)
	assert.Equal(t, "黄芪饮片", oldDrug.Name)
	assert.Equal(t, "黄芪饮片(特级)", newDrug.Name)
	assert.Equal(t, 60.0, newDrug.SellingPrice)
}

func TestInventoryDrugService_Update_ClearThreshold(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID)

	// seeded[0] has AlertThreshold = 10.0
	assert.NotNil(t, seeded[0].AlertThreshold)

	clearVal := -1.0
	req := &service.UpdateInventoryDrugRequest{
		AlertThreshold: &clearVal,
	}

	_, newDrug, err := svc.Update(tenantID, seeded[0].ID, req)
	assert.NoError(t, err)
	assert.Nil(t, newDrug.AlertThreshold)
}

func TestInventoryDrugService_Update_CrossTenant(t *testing.T) {
	svc, tenantID1, tenantID2 := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID1)

	newName := "hijacked"
	req := &service.UpdateInventoryDrugRequest{Name: &newName}

	_, _, err := svc.Update(tenantID2, seeded[0].ID, req)
	assert.ErrorIs(t, err, service.ErrInventoryDrugNotFound)
}

func TestInventoryDrugService_Delete_Success(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID)

	deletedDrug, err := svc.Delete(tenantID, seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "黄芪饮片", deletedDrug.Name)

	// Verify it is soft-deleted (list should not include it)
	drugs, total, err := svc.List(tenantID, "黄芪", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, drugs, 0)
}

func TestInventoryDrugService_Delete_CrossTenant(t *testing.T) {
	svc, tenantID1, tenantID2 := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID1)

	_, err := svc.Delete(tenantID2, seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrInventoryDrugNotFound)
}

func TestInventoryDrugService_BatchStockIn_CreateNew(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)

	req := &service.BatchStockInRequest{
		Items: []service.StockInItem{
			{Name: "新药材A", Quantity: 50, PurchasePrice: 20, SellingPrice: 35},
			{Name: "新药材B", Quantity: 30, PurchasePrice: 10, SellingPrice: 18},
		},
	}

	result, err := svc.BatchStockIn(tenantID, req)
	assert.NoError(t, err)
	assert.Equal(t, 2, result.Created)
	assert.Equal(t, 0, result.Updated)
	assert.Equal(t, 2, result.Total)

	// Verify created
	drugs, total, err := svc.List(tenantID, "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, drugs, 2)
}

func TestInventoryDrugService_BatchStockIn_UpdateExisting(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seedInventoryDrugs(t, svc, tenantID) // Creates "黄芪饮片" with Stock=100

	req := &service.BatchStockInRequest{
		Items: []service.StockInItem{
			{Name: "黄芪饮片", Quantity: 50, PurchasePrice: 32},
		},
	}

	result, err := svc.BatchStockIn(tenantID, req)
	assert.NoError(t, err)
	assert.Equal(t, 0, result.Created)
	assert.Equal(t, 1, result.Updated)

	// Verify stock increased
	drugs, _, err := svc.List(tenantID, "黄芪饮片", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, drugs, 1)
	assert.Equal(t, float64(150), drugs[0].Stock)
	assert.Equal(t, float64(32), drugs[0].PurchasePrice)
}

func TestInventoryDrugService_StockIn_Success(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID)

	req := &service.StockInRequest{
		Quantity:      25,
		PurchasePrice: 28,
	}

	res, err := svc.StockIn(tenantID, seeded[0].ID, req)
	assert.NoError(t, err)
	assert.Equal(t, float64(100), res.OldDrug.Stock)
	assert.Equal(t, float64(125), res.NewDrug.Stock)
	assert.Equal(t, float64(28), res.NewDrug.PurchasePrice)
}

func TestInventoryDrugService_StockIn_NotFound(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)

	req := &service.StockInRequest{
		Quantity:      10,
		PurchasePrice: 20,
	}

	_, err := svc.StockIn(tenantID, 99999, req)
	assert.ErrorIs(t, err, service.ErrInventoryDrugNotFound)
}

func TestInventoryDrugService_Create_WithShelfNo(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)

	req := &service.CreateInventoryDrugRequest{
		Name:     "白术",
		Category: "herb",
		Stock:    300,
		ShelfNo:  "A3",
	}
	drug, err := svc.Create(tenantID, req)
	assert.NoError(t, err)
	assert.Equal(t, "A3", drug.ShelfNo)
}

func TestInventoryDrugService_Create_DefaultShelfNo(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)

	req := &service.CreateInventoryDrugRequest{
		Name:     "陈皮",
		Category: "herb",
		Stock:    200,
	}
	drug, err := svc.Create(tenantID, req)
	assert.NoError(t, err)
	// Default shelf_no should be H1 (from GORM default)
	assert.Equal(t, "H1", drug.ShelfNo)
}

func TestInventoryDrugService_Update_ShelfNo(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID)

	newShelf := "B2"
	req := &service.UpdateInventoryDrugRequest{
		ShelfNo: &newShelf,
	}

	oldDrug, newDrug, err := svc.Update(tenantID, seeded[0].ID, req)
	assert.NoError(t, err)
	assert.Equal(t, "H1", oldDrug.ShelfNo)
	assert.Equal(t, "B2", newDrug.ShelfNo)
}

func TestInventoryDrugService_BatchStockIn_WithShelfNo(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)

	req := &service.BatchStockInRequest{
		Items: []service.StockInItem{
			{Name: "新药C", Quantity: 100, ShelfNo: "C1"},
		},
	}

	result, err := svc.BatchStockIn(tenantID, req)
	assert.NoError(t, err)
	assert.Equal(t, 1, result.Created)

	drugs, _, err := svc.List(tenantID, "新药C", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, drugs, 1)
	assert.Equal(t, "C1", drugs[0].ShelfNo)
}

func TestInventoryDrugService_BatchStockIn_UpdateShelfNo(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seedInventoryDrugs(t, svc, tenantID)

	req := &service.BatchStockInRequest{
		Items: []service.StockInItem{
			{Name: "黄芪饮片", Quantity: 10, ShelfNo: "D5"},
		},
	}

	result, err := svc.BatchStockIn(tenantID, req)
	assert.NoError(t, err)
	assert.Equal(t, 1, result.Updated)

	drugs, _, err := svc.List(tenantID, "黄芪饮片", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, "D5", drugs[0].ShelfNo)
}

func TestInventoryDrugService_StockIn_WithShelfNo(t *testing.T) {
	svc, tenantID, _ := setupInventoryDrugService(t)
	seeded := seedInventoryDrugs(t, svc, tenantID)

	shelf := "E1"
	req := &service.StockInRequest{
		Quantity: 10,
		ShelfNo:  &shelf,
	}

	res, err := svc.StockIn(tenantID, seeded[0].ID, req)
	assert.NoError(t, err)
	assert.Equal(t, "E1", res.NewDrug.ShelfNo)
}
