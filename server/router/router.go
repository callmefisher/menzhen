package router

import (
	"time"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/handler"
	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// SetupRouter creates and configures the Gin engine with all routes.
func SetupRouter(db *gorm.DB, minioClient *minio.Client, cfg *config.Config) *gin.Engine {
	r := gin.Default()

	// CORS middleware — allow all origins for development.
	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// ---------- Create handlers ----------

	authService := service.NewAuthService(db)
	authHandler := handler.NewAuthHandler(authService, cfg.JWTSecret, db)
	patientHandler := handler.NewPatientHandler(db)
	recordHandler := handler.NewRecordHandler(db)
	uploadHandler := handler.NewUploadHandler(minioClient, cfg.MinIOBucket)
	oplogHandler := handler.NewOpLogHandler(db)
	userHandler := handler.NewUserHandler(db)
	roleHandler := handler.NewRoleHandler(db)

	// DeepSeek-powered handlers
	deepSeekService := service.NewDeepSeekService(cfg)
	herbHandler := handler.NewHerbHandler(db, deepSeekService)
	formulaHandler := handler.NewFormulaHandler(db, deepSeekService)
	pulseHandler := handler.NewPulseHandler(db)
	prescriptionHandler := handler.NewPrescriptionHandler(db)
	tenantHandler := handler.NewTenantHandler(db)
	aiAnalysisHandler := handler.NewAIAnalysisHandler(deepSeekService, db)
	meridianResourceHandler := handler.NewMeridianResourceHandler(db)
	wuyunLiuqiHandler := handler.NewWuyunLiuqiHandler(db, deepSeekService)
	clinicalExpHandler := handler.NewClinicalExperienceHandler(db)

	// ---------- Route groups ----------

	v1 := r.Group("/api/v1")

	// Public auth routes.
	auth := v1.Group("/auth")
	{
		auth.POST("/login", authHandler.Login)
		auth.POST("/register", authHandler.Register)
	}

	// Public file download route (no JWT required — browser <img> tags can't send Authorization headers).
	v1.GET("/files/*key", uploadHandler.GetFile)

	// Authenticated routes.
	authenticated := v1.Group("")
	authenticated.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	{
		// Auth routes that require authentication.
		authAuth := authenticated.Group("/auth")
		{
			authAuth.POST("/logout", authHandler.Logout)
			authAuth.GET("/me", authHandler.Me)
			authAuth.POST("/change-password", authHandler.ChangePassword)
		}

		// Patient routes.
		patients := authenticated.Group("/patients")
		{
			patients.GET("", middleware.RequirePermission(db, "patient:read"), patientHandler.List)
			patients.POST("", middleware.RequirePermission(db, "patient:create"), patientHandler.Create)
			patients.GET("/:id", middleware.RequirePermission(db, "patient:read"), patientHandler.Detail)
			patients.PUT("/:id", middleware.RequirePermission(db, "patient:update"), patientHandler.Update)
			patients.DELETE("/:id", middleware.RequirePermission(db, "patient:delete"), patientHandler.Delete)
		}

		// Medical record routes.
		records := authenticated.Group("/records")
		{
			records.GET("", middleware.RequirePermission(db, "record:read"), recordHandler.List)
			records.POST("", middleware.RequirePermission(db, "record:create"), recordHandler.Create)
			records.GET("/:id", middleware.RequirePermission(db, "record:read"), recordHandler.Detail)
			records.PUT("/:id", middleware.RequirePermission(db, "record:update"), recordHandler.Update)
			records.DELETE("/:id", middleware.RequirePermission(db, "record:delete"), recordHandler.Delete)
		}

		// File upload route (authenticated, no specific permission).
		authenticated.POST("/upload", uploadHandler.Upload)

		// AI analysis routes (authenticated, requires record:read permission).
		authenticated.POST("/ai/analyze-diagnosis", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.Analyze)
		authenticated.POST("/ai/analyze-diagnosis-stream", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.AnalyzeStream)

		// Operation log routes.
		oplogs := authenticated.Group("/oplogs")
		{
			oplogs.GET("", middleware.RequirePermission(db, "oplog:read"), oplogHandler.ListOpLogs)
			oplogs.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), oplogHandler.DeleteOpLog)
			oplogs.POST("/batch-delete", middleware.RequirePermission(db, "role:manage"), oplogHandler.BatchDeleteOpLogs)
		}

		// User management routes.
		users := authenticated.Group("/users")
		{
			users.GET("", middleware.RequirePermission(db, "user:manage"), userHandler.List)
			users.PUT("/:id", middleware.RequirePermission(db, "user:manage"), userHandler.Update)
			users.DELETE("/:id", middleware.RequirePermission(db, "user:manage"), userHandler.Delete)
			users.POST("/:id/roles", middleware.RequirePermission(db, "user:manage"), userHandler.AssignRoles)
		}

		// Role management routes.
		roles := authenticated.Group("/roles")
		{
			roles.GET("", middleware.RequirePermission(db, "role:manage"), roleHandler.List)
			roles.POST("", middleware.RequirePermission(db, "role:manage"), roleHandler.Create)
			roles.PUT("/:id", middleware.RequirePermission(db, "role:manage"), roleHandler.Update)
		}

		// Permissions list route.
		authenticated.GET("/permissions", middleware.RequirePermission(db, "role:manage"), roleHandler.ListPermissions)

		// Tenant management routes.
		tenants := authenticated.Group("/tenants")
		{
			tenants.GET("", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.List)
			tenants.POST("", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Create)
			tenants.PUT("/:id", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Update)
			tenants.DELETE("/:id", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Delete)
		}

		// Herb routes (global data, authenticated, no permission required for read).
		herbs := authenticated.Group("/herbs")
		{
			herbs.GET("", herbHandler.List)
			herbs.GET("/categories", herbHandler.Categories)
			herbs.GET("/:id", herbHandler.Detail)
			herbs.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), herbHandler.Delete)
			herbs.PUT("/:id", middleware.RequirePermission(db, "role:manage"), herbHandler.Update)
			herbs.POST("/:id/ai-refresh", middleware.RequirePermission(db, "role:manage"), herbHandler.AIRefresh)
		}

		// Formula routes (global data, authenticated, no permission required for read).
		formulas := authenticated.Group("/formulas")
		{
			formulas.GET("", formulaHandler.List)
			formulas.GET("/:id", formulaHandler.Detail)
			formulas.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), formulaHandler.Delete)
			formulas.PUT("/:id/composition", middleware.RequirePermission(db, "role:manage"), formulaHandler.UpdateComposition)
			formulas.PUT("/:id/name", middleware.RequirePermission(db, "role:manage"), formulaHandler.UpdateName)
			formulas.PUT("/:id/notes", middleware.RequirePermission(db, "role:manage"), formulaHandler.UpdateNotes)
		}

		// Pulse routes (global data, authenticated, no permission required for read).
		pulses := authenticated.Group("/pulses")
		{
			pulses.GET("", pulseHandler.List)
			pulses.GET("/categories", pulseHandler.Categories)
			pulses.GET("/:id", pulseHandler.Detail)
			pulses.POST("", middleware.RequirePermission(db, "role:manage"), pulseHandler.Create)
			pulses.PUT("/:id", middleware.RequirePermission(db, "role:manage"), pulseHandler.Update)
			pulses.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), pulseHandler.Delete)
		}

		// Meridian resource routes (global data, authenticated).
		meridianRes := authenticated.Group("/meridians")
		{
			meridianRes.GET("/:id/resource", meridianResourceHandler.Get)
			meridianRes.PUT("/:id/resource", middleware.RequirePermission(db, "role:manage"), meridianResourceHandler.Update)
		}

		// WuYun LiuQi routes (global data, authenticated).
		wuyunLiuqi := authenticated.Group("/wuyun-liuqi")
		{
			wuyunLiuqi.GET("", wuyunLiuqiHandler.Get)
			wuyunLiuqi.POST("/query-stream", wuyunLiuqiHandler.QueryStream)
			wuyunLiuqi.PUT("/:id", middleware.RequirePermission(db, "role:manage"), wuyunLiuqiHandler.Update)
			wuyunLiuqi.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), wuyunLiuqiHandler.Delete)
		}

		// Clinical experience routes (global data, authenticated).
		clinicalExp := authenticated.Group("/clinical-experiences")
		{
			clinicalExp.GET("", clinicalExpHandler.List)
			clinicalExp.GET("/categories", clinicalExpHandler.Categories)
			clinicalExp.GET("/:id", clinicalExpHandler.Detail)
			clinicalExp.POST("", middleware.RequirePermission(db, "role:manage"), clinicalExpHandler.Create)
			clinicalExp.PUT("/:id", middleware.RequirePermission(db, "role:manage"), clinicalExpHandler.Update)
			clinicalExp.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), clinicalExpHandler.Delete)
		}

		// Prescription routes (tenant-scoped).
		prescriptions := authenticated.Group("/prescriptions")
		{
			prescriptions.POST("", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Create)
			prescriptions.GET("/:id", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.Detail)
			prescriptions.PUT("/:id", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Update)
			prescriptions.DELETE("/:id", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Delete)
		}

		// Prescription list by record (nested under records).
		records.GET("/:id/prescriptions", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.ListByRecord)

		// Cached AI analysis for a record (nested under records).
		records.GET("/:id/ai-analysis", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.GetCached)
		records.POST("/:id/ai-analysis", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.SaveCached)
	}

	return r
}
