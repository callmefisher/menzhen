package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
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
	"gorm.io/gorm"
)

// seedApptPermissions seeds appointment-specific permissions and assigns them to the
// given role. SeedAdminUser / SeedAllPermissions does not include these codes.
func seedApptPermissions(t *testing.T, db *gorm.DB, roleID uint64) {
	t.Helper()
	codes := []struct{ code, name string }{
		{"appointment:create", "创建预约"},
		{"appointment:read", "查看预约"},
		{"appointment:update", "更新预约"},
		{"appointment:delete", "删除预约"},
		{"appointment:checkin", "预约签到"},
	}
	for _, c := range codes {
		perm := testutil.SeedTestPermission(t, db, c.code, c.name)
		err := db.Create(&model.RolePermission{RoleID: roleID, PermissionID: perm.ID}).Error
		require.NoError(t, err)
	}
}

// setupApptHandlerRouter creates a gin.Engine with appointment routes and returns
// the router and a valid JWT token for an admin user who has all appointment permissions.
func setupApptHandlerRouter(t *testing.T) (*gin.Engine, string) {
	gin.SetMode(gin.TestMode)
	db := testutil.SetupTestDB(t)
	tenant, user, token := testutil.SeedAdminUser(t, db)
	_ = user

	// Fetch the role created for the admin user so we can attach appointment perms.
	var userRole model.UserRole
	err := db.Where("user_id = ?", user.ID).First(&userRole).Error
	require.NoError(t, err)
	seedApptPermissions(t, db, uint64(userRole.RoleID))
	_ = tenant

	h := NewAppointmentHandler(db)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))
	appts := r.Group("/api/v1/appointments")
	appts.POST("", middleware.RequirePermission(db, "appointment:create"), h.Create)
	appts.GET("", middleware.RequirePermission(db, "appointment:read"), h.List)
	appts.POST("/:id/checkin", middleware.RequirePermission(db, "appointment:checkin"), h.Checkin)
	appts.POST("/:id/cancel", middleware.RequirePermission(db, "appointment:update"), h.Cancel)
	appts.DELETE("/:id", middleware.RequirePermission(db, "appointment:delete"), h.Delete)
	return r, token
}

// doApptRequest is a convenience helper that sends an authenticated JSON request.
func doApptRequest(t *testing.T, r *gin.Engine, method, path string, body interface{}, token string) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		reqBody = bytes.NewReader(b)
	} else {
		reqBody = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// today returns today's date as "2006-01-02".
func todayStr() string {
	return time.Now().Format("2006-01-02")
}

// validCreateBody returns a minimal valid appointment creation request body.
func validCreateBody() map[string]interface{} {
	return map[string]interface{}{
		"patient_name": "张三",
		"doctor_id":    1,
		"doctor_name":  "李医生",
		"room":         "诊室1",
		"appoint_date": todayStr(),
		"slot_start":   "09:00",
		"slot_end":     "09:30",
	}
}

// — Create —

func TestApptHandler_Create_Success(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, float64(0), resp["code"], "expected code=0, body=%s", w.Body.String())

	data, ok := resp["data"].(map[string]interface{})
	require.True(t, ok, "data should be an object")
	assert.Equal(t, "张三", data["patient_name"])
	assert.Equal(t, "pending", data["status"])
}

func TestApptHandler_Create_Duplicate(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// First appointment succeeds.
	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, w.Code)

	// Second identical appointment should conflict.
	w2 := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	assert.Equal(t, http.StatusConflict, w2.Code)
}

func TestApptHandler_Create_MissingField(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// patient_name is required — omit it.
	body := map[string]interface{}{
		"doctor_id":    1,
		"doctor_name":  "李医生",
		"appoint_date": todayStr(),
		"slot_start":   "09:00",
		"slot_end":     "09:30",
	}
	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", body, token)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// — List —

func TestApptHandler_List(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// Seed one appointment first.
	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, w.Code)

	// List by today's date.
	path := fmt.Sprintf("/api/v1/appointments?date=%s", todayStr())
	w2 := doApptRequest(t, r, http.MethodGet, path, nil, token)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, float64(0), resp["code"])

	data, ok := resp["data"].(map[string]interface{})
	require.True(t, ok, "data should be an object")
	list, ok := data["list"].([]interface{})
	require.True(t, ok)
	assert.Len(t, list, 1)
}

func TestApptHandler_List_EmptyDate(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// No date param — handler must return 400.
	w := doApptRequest(t, r, http.MethodGet, "/api/v1/appointments", nil, token)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, float64(1), resp["code"])
}

// — Checkin —

func TestApptHandler_Checkin_NotFound(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments/99999/checkin", nil, token)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestApptHandler_Checkin_NotQueued(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// Create an appointment (it starts as "pending", not "queued").
	cw := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, cw.Code)
	var createResp map[string]interface{}
	require.NoError(t, json.Unmarshal(cw.Body.Bytes(), &createResp))
	apptData := createResp["data"].(map[string]interface{})
	apptID := int(apptData["id"].(float64))

	// Checkin on a pending (not queued) appointment should return 400.
	path := fmt.Sprintf("/api/v1/appointments/%d/checkin", apptID)
	w := doApptRequest(t, r, http.MethodPost, path, nil, token)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// — Cancel —

func TestApptHandler_Cancel_NotFound(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments/99999/cancel", nil, token)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestApptHandler_Cancel_Success(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// Create an appointment.
	cw := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, cw.Code)
	var createResp map[string]interface{}
	require.NoError(t, json.Unmarshal(cw.Body.Bytes(), &createResp))
	apptData := createResp["data"].(map[string]interface{})
	apptID := int(apptData["id"].(float64))

	// Cancel it.
	path := fmt.Sprintf("/api/v1/appointments/%d/cancel", apptID)
	w := doApptRequest(t, r, http.MethodPost, path, nil, token)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, float64(0), resp["code"])
}

func TestApptHandler_Cancel_AlreadyCancelled(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// Create and cancel once.
	cw := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, cw.Code)
	var createResp map[string]interface{}
	require.NoError(t, json.Unmarshal(cw.Body.Bytes(), &createResp))
	apptData := createResp["data"].(map[string]interface{})
	apptID := int(apptData["id"].(float64))
	path := fmt.Sprintf("/api/v1/appointments/%d/cancel", apptID)

	w := doApptRequest(t, r, http.MethodPost, path, nil, token)
	require.Equal(t, http.StatusOK, w.Code)

	// Second cancel should 409 (ErrCancelNotAllowed).
	w2 := doApptRequest(t, r, http.MethodPost, path, nil, token)
	assert.Equal(t, http.StatusConflict, w2.Code)
}

// — Delete —

// createAndCancelAppt creates an appointment via API and then cancels it,
// returning the appointment ID ready for deletion tests.
func createAndCancelAppt(t *testing.T, r *gin.Engine, token string) int {
	t.Helper()
	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, w.Code, "create failed: %s", w.Body.String())
	var cr map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &cr))
	apptID := int(cr["data"].(map[string]interface{})["id"].(float64))

	cancelPath := fmt.Sprintf("/api/v1/appointments/%d/cancel", apptID)
	w2 := doApptRequest(t, r, http.MethodPost, cancelPath, nil, token)
	require.Equal(t, http.StatusOK, w2.Code, "cancel failed: %s", w2.Body.String())
	return apptID
}

// TestApptHandler_Delete_CancelledAppointment verifies that a cancelled appointment
// can be hard-deleted and returns 200 with code=0.
func TestApptHandler_Delete_CancelledAppointment(t *testing.T) {
	r, token := setupApptHandlerRouter(t)
	apptID := createAndCancelAppt(t, r, token)

	path := fmt.Sprintf("/api/v1/appointments/%d", apptID)
	w := doApptRequest(t, r, http.MethodDelete, path, nil, token)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, float64(0), resp["code"], "body=%s", w.Body.String())

	// Confirm it no longer appears in the list.
	listPath := fmt.Sprintf("/api/v1/appointments?date=%s", todayStr())
	wl := doApptRequest(t, r, http.MethodGet, listPath, nil, token)
	var lr map[string]interface{}
	require.NoError(t, json.Unmarshal(wl.Body.Bytes(), &lr))
	list := lr["data"].(map[string]interface{})["list"].([]interface{})
	assert.Empty(t, list, "deleted appointment should not appear in list")
}

// TestApptHandler_Delete_PendingAppointment verifies that deleting a pending
// appointment is rejected with 409 (only cancelled/no_show are deletable).
func TestApptHandler_Delete_PendingAppointment(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	// Create but do NOT cancel — status stays pending.
	w := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), token)
	require.Equal(t, http.StatusOK, w.Code)
	var cr map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &cr))
	apptID := int(cr["data"].(map[string]interface{})["id"].(float64))

	path := fmt.Sprintf("/api/v1/appointments/%d", apptID)
	w2 := doApptRequest(t, r, http.MethodDelete, path, nil, token)
	assert.Equal(t, http.StatusConflict, w2.Code, "body=%s", w2.Body.String())
}

// TestApptHandler_Delete_NotFound verifies that deleting a non-existent ID returns 404.
func TestApptHandler_Delete_NotFound(t *testing.T) {
	r, token := setupApptHandlerRouter(t)

	w := doApptRequest(t, r, http.MethodDelete, "/api/v1/appointments/99999", nil, token)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestApptHandler_Delete_CrossTenant verifies that an appointment belonging to
// another tenant cannot be deleted (should return 404, not 200).
func TestApptHandler_Delete_CrossTenant(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testutil.SetupTestDB(t)

	// Tenant A: create and cancel an appointment.
	tenantA, _, tokenA := testutil.SeedAdminUser(t, db)
	var roleA model.UserRole
	require.NoError(t, db.Where("tenant_id = ?", tenantA.ID).First(&roleA).Error)
	seedApptPermissions(t, db, uint64(roleA.RoleID))

	// Tenant B: own router and token.
	tenantB, _, tokenB := testutil.SeedAdminUser(t, db)
	var roleB model.UserRole
	require.NoError(t, db.Where("tenant_id = ?", tenantB.ID).First(&roleB).Error)
	seedApptPermissions(t, db, uint64(roleB.RoleID))

	h := NewAppointmentHandler(db)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))
	appts := r.Group("/api/v1/appointments")
	appts.POST("", middleware.RequirePermission(db, "appointment:create"), h.Create)
	appts.POST("/:id/cancel", middleware.RequirePermission(db, "appointment:update"), h.Cancel)
	appts.DELETE("/:id", middleware.RequirePermission(db, "appointment:delete"), h.Delete)

	// Tenant A creates and cancels an appointment.
	wc := doApptRequest(t, r, http.MethodPost, "/api/v1/appointments", validCreateBody(), tokenA)
	require.Equal(t, http.StatusOK, wc.Code)
	var cr map[string]interface{}
	require.NoError(t, json.Unmarshal(wc.Body.Bytes(), &cr))
	apptID := int(cr["data"].(map[string]interface{})["id"].(float64))
	wcan := doApptRequest(t, r, http.MethodPost, fmt.Sprintf("/api/v1/appointments/%d/cancel", apptID), nil, tokenA)
	require.Equal(t, http.StatusOK, wcan.Code)

	// Tenant B tries to delete Tenant A's appointment — must be 404.
	wdel := doApptRequest(t, r, http.MethodDelete, fmt.Sprintf("/api/v1/appointments/%d", apptID), nil, tokenB)
	assert.Equal(t, http.StatusNotFound, wdel.Code, "cross-tenant delete must return 404, body=%s", wdel.Body.String())
}

// TestApptHandler_Delete_NoShowAppointment verifies that a no_show appointment
// can also be deleted (regression: ensure status guard covers both deletable statuses).
func TestApptHandler_Delete_NoShowAppointment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testutil.SetupTestDB(t)
	tenant, user, token := testutil.SeedAdminUser(t, db)
	_ = user

	var userRole model.UserRole
	require.NoError(t, db.Where("user_id = ?", user.ID).First(&userRole).Error)
	seedApptPermissions(t, db, uint64(userRole.RoleID))

	// Directly insert a no_show appointment (the API has no no_show endpoint).
	appt := model.Appointment{
		TenantID: uint(tenant.ID), PatientName: "吴六", DoctorID: 1, DoctorName: "李医生",
		AppointDate: todayStr(), SlotStart: "10:00", SlotEnd: "10:30",
		Status: model.AppointmentStatusNoShow,
	}
	require.NoError(t, db.Create(&appt).Error)

	h := NewAppointmentHandler(db)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))
	appts := r.Group("/api/v1/appointments")
	appts.DELETE("/:id", middleware.RequirePermission(db, "appointment:delete"), h.Delete)

	w := doApptRequest(t, r, http.MethodDelete, fmt.Sprintf("/api/v1/appointments/%d", appt.ID), nil, token)
	assert.Equal(t, http.StatusOK, w.Code, "no_show appointment should be deletable, body=%s", w.Body.String())
}

func TestApptHandler_Checkin_WrongDate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testutil.SetupTestDB(t)
	tenant, user, token := testutil.SeedAdminUser(t, db)

	var userRole model.UserRole
	require.NoError(t, db.Where("user_id = ?", user.ID).First(&userRole).Error)
	seedApptPermissions(t, db, uint64(userRole.RoleID))

	h := NewAppointmentHandler(db)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))
	appts := r.Group("/api/v1/appointments")
	appts.POST("/:id/checkin", middleware.RequirePermission(db, "appointment:checkin"), h.Checkin)

	// Create a QueueEntry with a past date.
	qe := model.QueueEntry{
		TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		SeqNumber: 1, Status: model.QueueStatusWaiting, QueueDate: "2020-01-01",
		CheckinStatus: model.CheckinStatusPending, Source: "appointment",
	}
	require.NoError(t, db.Create(&qe).Error)

	// Create appointment with a past date and status queued.
	appt := model.Appointment{
		TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: "2020-01-01", SlotStart: "09:00", SlotEnd: "09:30",
		Status: model.AppointmentStatusQueued, QueueEntryID: &qe.ID,
	}
	require.NoError(t, db.Create(&appt).Error)

	// Checkin on a queued appointment with a past date should return 400.
	w := doApptRequest(t, r, http.MethodPost, fmt.Sprintf("/api/v1/appointments/%d/checkin", appt.ID), nil, token)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
