package handler

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// exitFunc is the function called to terminate the process. Overridden in tests.
var exitFunc = os.Exit

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

func (h *ConfigHandler) Restart(c *gin.Context) {
	if h.db != nil {
		middleware.LogOperation(h.db, c, "restart", "system_config", 0, nil, nil)
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "服务将在 2 秒后重启"})

	go func() {
		time.Sleep(2 * time.Second)
		log.Println("管理员触发服务重启，进程退出...")
		exitFunc(0)
	}()
}

func GetVersion(c *gin.Context) {
	data, err := os.ReadFile("scripts/version")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"version": "unknown"}})
		return
	}
	ver := strings.TrimSpace(string(data))
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"version": ver}})
}
