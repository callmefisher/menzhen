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
	pulseHandler := handler.NewPulseHandler(db, deepSeekService)
	prescriptionHandler := handler.NewPrescriptionHandler(db)
	tenantHandler := handler.NewTenantHandler(db)
	aiAnalysisHandler := handler.NewAIAnalysisHandler(deepSeekService, db)
	meridianResourceHandler := handler.NewMeridianResourceHandler(db)
	wuyunLiuqiHandler := handler.NewWuyunLiuqiHandler(db, deepSeekService)
	clinicalExpHandler := handler.NewClinicalExperienceHandler(db)
	inventoryDrugHandler := handler.NewInventoryDrugHandler(db)
	billingHandler := handler.NewBillingHandler(db)
	tenantAdminHandler := handler.NewTenantAdminHandler(db)
	solarTermHandler := handler.NewSolarTermHandler(db)
	hexagramHandler := handler.NewHexagramHandler(db)
	followUpHandler := handler.NewFollowUpHandler(db)
	configHandler := handler.NewConfigHandler(db)

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

	// Auth-only routes (JWT validated, but no token_version check).
	// The refresh endpoint must bypass TokenVersionMiddleware so that
	// a user with a stale token_version can still obtain a new token.
	authOnly := v1.Group("")
	authOnly.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	{
		authOnly.POST("/auth/refresh", authHandler.RefreshToken)
	}

	// Authenticated routes.
	authenticated := v1.Group("")
	authenticated.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	authenticated.Use(middleware.TokenVersionMiddleware(db))
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
			records.GET("/:id/page", middleware.RequirePermission(db, "record:read"), recordHandler.FindPage)
			records.PUT("/:id", middleware.RequirePermission(db, "record:update"), recordHandler.Update)
			records.DELETE("/:id", middleware.RequirePermission(db, "record:delete"), recordHandler.Delete)
		}

		// File upload route (authenticated, no specific permission).
		authenticated.POST("/upload", uploadHandler.Upload)

		// AI analysis routes (authenticated, requires record:read permission).
		authenticated.POST("/ai/analyze-diagnosis", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.Analyze)
		authenticated.POST("/ai/analyze-diagnosis-stream", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.AnalyzeStream)
		authenticated.POST("/ai/analyze-tongue", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.AnalyzeTongue)
		authenticated.POST("/ai/analyze-tongue-stream", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.AnalyzeTongueStream)

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
			roles.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), roleHandler.Delete)
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

		// Tenant-scoped admin routes (for clinic operators).
		tenantAdmin := authenticated.Group("/tenant")
		{
			tenantUsers := tenantAdmin.Group("/users")
			tenantUsers.Use(middleware.RequirePermission(db, "tenant:user:manage", "user:manage"))
			{
				tenantUsers.GET("", tenantAdminHandler.ListUsers)
				tenantUsers.PUT("/:id", tenantAdminHandler.UpdateUser)
				tenantUsers.DELETE("/:id", tenantAdminHandler.DisableUser)
				tenantUsers.POST("/:id/roles", tenantAdminHandler.AssignRoles)
			}
			tenantRoles := tenantAdmin.Group("/roles")
			tenantRoles.Use(middleware.RequirePermission(db, "tenant:role:manage", "role:manage"))
			{
				tenantRoles.GET("", tenantAdminHandler.ListRoles)
				tenantRoles.POST("", tenantAdminHandler.CreateRole)
				tenantRoles.PUT("/:id", tenantAdminHandler.UpdateRole)
				tenantRoles.DELETE("/:id", tenantAdminHandler.DeleteRole)
			}
			tenantAdmin.GET("/permissions",
				middleware.RequirePermission(db, "tenant:role:manage", "role:manage"),
				tenantAdminHandler.ListTenantPermissions)
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

		// Solar terms routes (global data, authenticated).
		solarTerms := authenticated.Group("/solar-terms")
		{
			solarTerms.GET("", solarTermHandler.List)
			solarTerms.PUT("/:id", middleware.RequirePermission(db, "role:manage"), solarTermHandler.Update)
			solarTerms.DELETE("/:id/content", middleware.RequirePermission(db, "role:manage"), solarTermHandler.DeleteContent)
		}

		// Hexagram routes (global data, authenticated).
		hexagrams := authenticated.Group("/hexagrams")
		{
			hexagrams.GET("", hexagramHandler.List)
			hexagrams.GET("/trigrams", hexagramHandler.Trigrams)
			hexagrams.GET("/:id", hexagramHandler.Detail)
			hexagrams.POST("", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Create)
			hexagrams.PUT("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Update)
			hexagrams.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Delete)
		}

		// Prescription routes (tenant-scoped).
		prescriptions := authenticated.Group("/prescriptions")
		{
			prescriptions.POST("", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Create)
			prescriptions.GET("/:id", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.Detail)
			prescriptions.PUT("/:id", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Update)
			prescriptions.DELETE("/:id", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Delete)

			// Billing routes (nested under prescriptions).
			prescriptions.GET("/:id/billing", middleware.RequirePermission(db, "billing:read"), billingHandler.GetDetail)
			prescriptions.POST("/:id/billing", middleware.RequirePermission(db, "billing:create"), billingHandler.Create)
			prescriptions.POST("/:id/billing/deduct-stock", middleware.RequirePermission(db, "billing:create"), billingHandler.DeductStock)
		}

		// Inventory drug routes (tenant-scoped).
		inventoryDrugs := authenticated.Group("/inventory/drugs")
		{
			inventoryDrugs.GET("", middleware.RequirePermission(db, "inventory:read"), inventoryDrugHandler.List)
			inventoryDrugs.POST("", middleware.RequirePermission(db, "inventory:create"), inventoryDrugHandler.Create)
			inventoryDrugs.POST("/batch-stock-in", middleware.RequirePermission(db, "inventory:create"), inventoryDrugHandler.BatchStockIn)
			inventoryDrugs.POST("/:id/stock-in", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.StockIn)
			inventoryDrugs.PUT("/:id", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.Update)
			inventoryDrugs.DELETE("/:id", middleware.RequirePermission(db, "inventory:delete"), inventoryDrugHandler.Delete)
		}

		// Follow-up routes (tenant-scoped).
		followUps := authenticated.Group("/follow-ups")
		{
			followUps.GET("", middleware.RequirePermission(db, "followup:read"), followUpHandler.List)
			followUps.POST("", middleware.RequirePermission(db, "followup:create"), followUpHandler.Create)
			followUps.GET("/stats", middleware.RequirePermission(db, "followup:read"), followUpHandler.Stats)
			followUps.GET("/:id", middleware.RequirePermission(db, "followup:read"), followUpHandler.Detail)
			followUps.PUT("/:id", middleware.RequirePermission(db, "followup:update"), followUpHandler.Update)
			followUps.DELETE("/:id", middleware.RequirePermission(db, "followup:delete"), followUpHandler.Delete)
		}

		// System config routes (super admin only).
		configRoutes := authenticated.Group("/config")
		{
			configRoutes.GET("", middleware.RequirePermission(db, "user:manage"), configHandler.Get)
			configRoutes.PUT("", middleware.RequirePermission(db, "user:manage"), configHandler.Update)
			configRoutes.POST("/restart", middleware.RequirePermission(db, "user:manage"), configHandler.Restart)
		}

		// Statistics routes (tenant-scoped).
		statistics := authenticated.Group("/statistics")
		{
			statisticsHandler := handler.NewStatisticsHandler(db)
			statistics.GET("/dashboard", middleware.RequirePermission(db, "statistics:read"), statisticsHandler.GetDashboard)
			statistics.POST("/rebuild", middleware.RequirePermission(db, "tenant:manage"), statisticsHandler.RebuildStats)
		}

		// Prescription list by record (nested under records).
		records.GET("/:id/prescriptions", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.ListByRecord)

		// Billings list by record (nested under records).
		records.GET("/:id/billings", middleware.RequirePermission(db, "billing:read"), billingHandler.ListByRecord)
		// Record-level billing (consultation fee only, no prescription needed).
		records.GET("/:id/billing-detail", middleware.RequirePermission(db, "billing:read"), billingHandler.GetRecordBillingDetail)
		records.POST("/:id/billing", middleware.RequirePermission(db, "billing:create"), billingHandler.CreateRecordBilling)

		// Cached AI analysis for a record (nested under records).
		records.GET("/:id/ai-analysis", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.GetCached)
		records.POST("/:id/ai-analysis", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.SaveCached)
	}

	return r
}
