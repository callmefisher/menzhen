package handler

import (
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PowerAdminHandler manages powerAdmin CRUD and group assignment.
type PowerAdminHandler struct {
	svc *service.PowerAdminService
}

// NewPowerAdminHandler creates a new PowerAdminHandler.
func NewPowerAdminHandler(db *gorm.DB) *PowerAdminHandler {
	return &PowerAdminHandler{svc: service.NewPowerAdminService(db)}
}

// List handles GET /api/v1/settings/power-admins.
// Returns all users that have at least one managed group.
func (h *PowerAdminHandler) List(c *gin.Context) {
	items, err := h.svc.ListPowerAdmins()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": items})
}

// Delete handles DELETE /api/v1/settings/power-admins/:id.
// Removes all group assignments for the user (revokes powerAdmin status).
func (h *PowerAdminHandler) Delete(c *gin.Context) {
	userID, err := parsePowerAdminIDParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的用户ID"})
		return
	}
	if err := h.svc.AssignGroups(userID, []string{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

// AssignGroups handles PUT /api/v1/settings/power-admins/:id/groups.
// Body: {"groups": ["华北分组", "华南分组"]}
// Replaces the full set of managed groups for the target user.
func (h *PowerAdminHandler) AssignGroups(c *gin.Context) {
	userID, err := parsePowerAdminIDParam(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的用户ID"})
		return
	}
	var req struct {
		Groups []string `json:"groups"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}
	if req.Groups == nil {
		req.Groups = []string{}
	}
	if err := h.svc.AssignGroups(userID, req.Groups); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "分配失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

// ListAllGroups handles GET /api/v1/settings/power-admins/groups.
// Returns all distinct group names from the tenants table.
func (h *PowerAdminHandler) ListAllGroups(c *gin.Context) {
	groups, err := h.svc.GetAllGroups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": groups})
}

// parsePowerAdminIDParam parses the ":id" path parameter as uint64.
// Named distinctly to avoid collision with any future shared helper.
func parsePowerAdminIDParam(c *gin.Context) (uint64, error) {
	return strconv.ParseUint(c.Param("id"), 10, 64)
}
