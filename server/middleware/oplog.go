package middleware

import (
	"encoding/json"
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func LogOperation(db *gorm.DB, c *gin.Context, action, resourceType string, resourceID uint64, oldData, newData interface{}) {
	if action == "update" && oldData != nil && newData != nil {
		oldBytes, err1 := json.Marshal(oldData)
		newBytes, err2 := json.Marshal(newData)
		if err1 == nil && err2 == nil && string(oldBytes) == string(newBytes) {
			return
		}
	}

	tenantID := GetTenantID(c)
	userID := GetUserID(c)

	userName := GetUsername(c)
	var user model.User
	if err := db.Select("real_name").First(&user, userID).Error; err == nil && user.RealName != "" {
		userName = user.RealName
	}

	svc := service.NewOpLogService(db)
	if err := svc.CreateOpLog(tenantID, userID, userName, action, resourceType, resourceID, oldData, newData); err != nil {
		log.Printf("[oplog] failed to record operation log: %v", err)
	}
}
