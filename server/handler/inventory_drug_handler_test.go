package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
)

func TestInventoryHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)

	reqBody := map[string]interface{}{
		"name":     "黄芪饮片",
		"category": "herb",
		"stock":    100,
	}

	w := env.doRequest("POST", "/api/v1/inventory/drugs", reqBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, "黄芪饮片", data["name"])
	assert.Equal(t, "herb", data["category"])
	assert.Equal(t, float64(100), data["stock"])
}

func TestInventoryHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Create a drug first so list is non-empty
	createBody := map[string]interface{}{
		"name":     "当归片",
		"category": "herb",
		"stock":    50,
	}
	w := env.doRequest("POST", "/api/v1/inventory/drugs", createBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	w = env.doRequest("GET", "/api/v1/inventory/drugs?page=1&size=20", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.GreaterOrEqual(t, data["total"].(float64), float64(1))

	list := data["list"].([]interface{})
	assert.GreaterOrEqual(t, len(list), 1)
}

func TestInventoryHandler_Create_WithShelfNo(t *testing.T) {
	env := setupTestEnv(t)

	reqBody := map[string]interface{}{
		"name":     "川芎",
		"category": "herb",
		"stock":    200,
		"shelf_no": "A-03",
	}

	w := env.doRequest("POST", "/api/v1/inventory/drugs", reqBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	data := body["data"].(map[string]interface{})
	assert.Equal(t, "A-03", data["shelf_no"])
}

func TestInventoryHandler_Update_ShelfNo(t *testing.T) {
	env := setupTestEnv(t)

	// Create drug first
	createBody := map[string]interface{}{
		"name":     "白芍",
		"category": "herb",
		"stock":    100,
		"shelf_no": "A-01",
	}
	w := env.doRequest("POST", "/api/v1/inventory/drugs", createBody)
	assert.Equal(t, http.StatusCreated, w.Code)
	createData := parseJSON(w)["data"].(map[string]interface{})
	drugID := int(createData["id"].(float64))
	assert.Equal(t, "A-01", createData["shelf_no"])

	// Update shelf_no
	updateBody := map[string]interface{}{
		"shelf_no": "B-05",
	}
	url := fmt.Sprintf("/api/v1/inventory/drugs/%d", drugID)
	t.Logf("Update URL: %s, drugID: %d", url, drugID)
	w = env.doRequest("PUT", url, updateBody)
	assert.Equal(t, http.StatusOK, w.Code)

	updateData := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, "B-05", updateData["shelf_no"])
}

func TestInventoryHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/inventory/drugs", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	w = env.doRequestNoAuth("POST", "/api/v1/inventory/drugs", map[string]interface{}{
		"name":     "test",
		"category": "herb",
		"stock":    1,
	})
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestInventoryHandler_BatchStockIn_OpLogDetails(t *testing.T) {
	env := setupTestEnv(t)

	reqBody := map[string]interface{}{
		"items": []map[string]interface{}{
			{"name": "黄芪", "quantity": 100, "purchase_price": 15.5, "selling_price": 25.0, "shelf_no": "A-01"},
			{"name": "当归", "quantity": 200, "purchase_price": 20.0, "selling_price": 35.0},
			{"name": "白术", "quantity": 50, "purchase_price": 12.0, "selling_price": 18.0, "shelf_no": "B-02"},
		},
		"alert_threshold": 10.0,
	}

	w := env.doRequest("POST", "/api/v1/inventory/drugs/batch-stock-in", reqBody)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(3), data["created"])
	assert.Equal(t, float64(3), data["total"])

	// Verify oplog was recorded with item details
	var oplog model.OpLog
	err := env.DB.Where("tenant_id = ? AND action = ? AND resource_type = ?",
		env.TenantID, "batch_stock_in", "inventory_drug").
		Order("id DESC").First(&oplog).Error
	assert.NoError(t, err)
	assert.Equal(t, uint64(0), oplog.ResourceID)

	// Parse new_data and verify it contains item details
	var newData map[string]interface{}
	err = json.Unmarshal(oplog.NewData, &newData)
	assert.NoError(t, err)

	// Verify summary fields
	assert.Equal(t, float64(3), newData["created"])
	assert.Equal(t, float64(0), newData["updated"])
	assert.Equal(t, float64(3), newData["total"])
	assert.Equal(t, float64(10), newData["alert_threshold"])

	// Verify items detail
	items, ok := newData["items"].([]interface{})
	assert.True(t, ok, "items should be an array")
	assert.Equal(t, 3, len(items))

	item0 := items[0].(map[string]interface{})
	assert.Equal(t, "黄芪", item0["name"])
	assert.Equal(t, float64(100), item0["quantity"])
	assert.Equal(t, 15.5, item0["purchase_price"])
	assert.Equal(t, 25.0, item0["selling_price"])
	assert.Equal(t, "A-01", item0["shelf_no"])

	item1 := items[1].(map[string]interface{})
	assert.Equal(t, "当归", item1["name"])
	assert.Equal(t, float64(200), item1["quantity"])
}

func TestInventoryHandler_BatchStockIn_UpdateExisting_OpLog(t *testing.T) {
	env := setupTestEnv(t)

	// Create existing drug
	createBody := map[string]interface{}{
		"name":     "黄芪",
		"category": "herb",
		"stock":    50,
	}
	w := env.doRequest("POST", "/api/v1/inventory/drugs", createBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	// Batch stock-in with one existing + one new
	batchBody := map[string]interface{}{
		"items": []map[string]interface{}{
			{"name": "黄芪", "quantity": 30, "purchase_price": 15.0, "selling_price": 25.0},
			{"name": "新药材", "quantity": 100, "purchase_price": 10.0, "selling_price": 20.0},
		},
	}
	w = env.doRequest("POST", "/api/v1/inventory/drugs/batch-stock-in", batchBody)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["created"])
	assert.Equal(t, float64(1), data["updated"])

	// Verify oplog contains all items
	var oplog model.OpLog
	err := env.DB.Where("tenant_id = ? AND action = ?", env.TenantID, "batch_stock_in").
		Order("id DESC").First(&oplog).Error
	assert.NoError(t, err)

	var newData map[string]interface{}
	err = json.Unmarshal(oplog.NewData, &newData)
	assert.NoError(t, err)

	items := newData["items"].([]interface{})
	assert.Equal(t, 2, len(items))
	assert.Equal(t, float64(1), newData["created"])
	assert.Equal(t, float64(1), newData["updated"])
}
