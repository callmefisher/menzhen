package middleware

import (
	"log"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// LogOperation is a helper function for recording operation logs from handlers.
// It extracts user context from the gin.Context and creates an OpLog entry.
// Errors are logged but do not fail the request (best-effort).
func LogOperation(db *gorm.DB, c *gin.Context, action, resourceType string, resourceID uint64, oldData, newData interface{}) {
	tenantID := GetTenantID(c)
	userID := GetUserID(c)
	userName := GetUsername(c)

	svc := service.NewOpLogService(db)
	if err := svc.CreateOpLog(tenantID, userID, userName, action, resourceType, resourceID, oldData, newData); err != nil {
		log.Printf("[oplog] failed to record operation log: %v", err)
	}
}
