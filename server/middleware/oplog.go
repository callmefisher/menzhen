package middleware

import (
	"encoding/json"
	"log"
	"sort"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var oplogSkipKeys = map[string]bool{
	"id": true, "created_at": true, "updated_at": true, "deleted_at": true,
}

func normalizeForCompare(v interface{}) (interface{}, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return stripAutoFields(m), nil
}

func stripAutoFields(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		m := make(map[string]interface{}, len(val))
		for k, v2 := range val {
			if oplogSkipKeys[k] {
				continue
			}
			m[k] = stripAutoFields(v2)
		}
		return m
	case []interface{}:
		arr := make([]interface{}, len(val))
		for i, v2 := range val {
			arr[i] = stripAutoFields(v2)
		}
		sort.Slice(arr, func(i, j int) bool {
			bi, _ := json.Marshal(arr[i])
			bj, _ := json.Marshal(arr[j])
			return string(bi) < string(bj)
		})
		return arr
	default:
		return v
	}
}

func isContentUnchanged(oldData, newData interface{}) bool {
	oldNorm, err1 := normalizeForCompare(oldData)
	newNorm, err2 := normalizeForCompare(newData)
	if err1 != nil || err2 != nil {
		return false
	}
	ob, _ := json.Marshal(oldNorm)
	nb, _ := json.Marshal(newNorm)
	return string(ob) == string(nb)
}

func LogOperation(db *gorm.DB, c *gin.Context, action, resourceType string, resourceID uint64, oldData, newData interface{}) {
	if action == "update" && oldData != nil && newData != nil && isContentUnchanged(oldData, newData) {
		return
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
