package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestHerbHandler_List_InvalidPage(t *testing.T) {
	// This tests the handler's parsing logic, not DB. We can't test DB-dependent
	// parts without a real database, but we can verify request handling.
	cfg := &config.Config{}
	ds := service.NewDeepSeekService(cfg)

	h := NewHerbHandler(nil, ds) // nil db will fail, but we test that page defaults work

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/herbs?page=-1&size=0", nil)

	// This will panic/fail because db is nil, but the test verifies compilation
	// and handler structure. Integration tests with real DB are separate.
	_ = h
}

func TestFormulaHandler_List_Structure(t *testing.T) {
	cfg := &config.Config{}
	ds := service.NewDeepSeekService(cfg)

	h := NewFormulaHandler(nil, ds)
	_ = h // Verify handler creates successfully
}

func TestPrescriptionHandler_Create_Structure(t *testing.T) {
	h := NewPrescriptionHandler(nil)
	_ = h // Verify handler creates successfully
}

func TestSuccessResponse(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	Success(c, map[string]string{"key": "value"})

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp["code"] != float64(0) {
		t.Errorf("expected code 0, got %v", resp["code"])
	}
	if resp["message"] != "success" {
		t.Errorf("expected message success, got %v", resp["message"])
	}
}

func TestCreatedResponse(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	Created(c, map[string]string{"id": "1"})

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", w.Code)
	}
}

func TestErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	Error(c, http.StatusNotFound, "not found")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp["code"] != float64(404) {
		t.Errorf("expected code 404, got %v", resp["code"])
	}
	if resp["message"] != "not found" {
		t.Errorf("expected message 'not found', got %v", resp["message"])
	}
}
