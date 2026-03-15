package handler

import (
	"net/http"
	"os"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ConfigHandler struct {
	db      *gorm.DB
	envPath string
}

func NewConfigHandler(db *gorm.DB) *ConfigHandler {
	envPath := os.Getenv("ENV_FILE_PATH")
	if envPath == "" {
		envPath = ".env"
	}
	return &ConfigHandler{db: db, envPath: envPath}
}

func (h *ConfigHandler) Get(c *gin.Context) {
	svc := service.NewConfigService(h.envPath)
	cfg, sensitiveSet, err := svc.GetConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to read config"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"config": cfg, "sensitive_set": sensitiveSet},
	})
}

func (h *ConfigHandler) Update(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}
	svc := service.NewConfigService(h.envPath)
	changedKeys, err := svc.UpdateConfig(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to update config"})
		return
	}
	// resourceID=0 because system config is not a DB entity
	if len(changedKeys) > 0 && h.db != nil {
		middleware.LogOperation(h.db, c, "update", "system_config", 0, nil,
			map[string]interface{}{"changed_keys": changedKeys})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}
