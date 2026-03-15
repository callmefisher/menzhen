package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFollowUpRouter(t *testing.T) (*gin.Engine, string, uint64, uint64) {
	gin.SetMode(gin.TestMode)
	db := testutil.SetupTestDB(t)
	tenant, user, token := testutil.SeedAdminUser(t, db)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "测试患者")

	// Create a medical record for follow-up tests (record_id is required).
	record := model.MedicalRecord{
		TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID,
		VisitDate: time.Now(), Diagnosis: "测试诊断",
	}
	require.NoError(t, db.Create(&record).Error)

	h := NewFollowUpHandler(db)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))

	g := r.Group("/follow-ups")
	g.GET("", middleware.RequirePermission(db, "followup:read"), h.List)
	g.POST("", middleware.RequirePermission(db, "followup:create"), h.Create)
	g.GET("/stats", middleware.RequirePermission(db, "followup:read"), h.Stats)
	g.GET("/:id", middleware.RequirePermission(db, "followup:read"), h.Detail)
	g.PUT("/:id", middleware.RequirePermission(db, "followup:update"), h.Update)
	g.DELETE("/:id", middleware.RequirePermission(db, "followup:delete"), h.Delete)

	return r, token, patient.ID, record.ID
}

func TestFollowUpHandlerCreate(t *testing.T) {
	r, token, patientID, recordID := setupFollowUpRouter(t)

	body, _ := json.Marshal(map[string]interface{}{
		"patient_id":   patientID,
		"record_id":    recordID,
		"planned_date": "2026-03-20",
		"method":       "电话",
		"content":      "术后回访",
	})

	req := httptest.NewRequest(http.MethodPost, "/follow-ups", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestFollowUpHandlerList(t *testing.T) {
	r, token, patientID, recordID := setupFollowUpRouter(t)

	// Create a follow-up first
	body, _ := json.Marshal(map[string]interface{}{
		"patient_id":   patientID,
		"record_id":    recordID,
		"planned_date": "2026-03-20",
		"method":       "电话",
	})
	req := httptest.NewRequest(http.MethodPost, "/follow-ups", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusCreated, w.Code)

	// List
	req = httptest.NewRequest(http.MethodGet, "/follow-ups?page=1&size=10", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["total"])
}

func TestFollowUpHandlerStats(t *testing.T) {
	r, token, _, _ := setupFollowUpRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/follow-ups/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestFollowUpHandlerDeleteNotFound(t *testing.T) {
	r, token, _, _ := setupFollowUpRouter(t)

	req := httptest.NewRequest(http.MethodDelete, "/follow-ups/99999", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestFollowUpHandlerCreateBadRequest(t *testing.T) {
	r, token, _, _ := setupFollowUpRouter(t)

	// Missing required fields
	body, _ := json.Marshal(map[string]interface{}{})
	req := httptest.NewRequest(http.MethodPost, "/follow-ups", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
