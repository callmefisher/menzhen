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
	recordHandler := handler.NewRecordHandler(db, minioClient, cfg.MinIOBucket)
	uploadHandler := handler.NewUploadHandler(minioClient, cfg.MinIOBucket, db)
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
	wsHandler := handler.NewWSHandler(cfg.JWTSecret)
	pnHandler := handler.NewPrescriptionNotificationHandler(db)
	queueHandler := handler.NewQueueHandler(db)
	qdSvc := service.NewQueueDoctorService(db)
	schedSvc := service.NewDoctorScheduleService(db)
	qdHandler := handler.NewQueueDoctorHandler(qdSvc, schedSvc, db)

	// ---------- Route groups ----------

	v1 := r.Group("/api/v1")

	// Public auth routes.
	auth := v1.Group("/auth")
	{
		auth.POST("/login", authHandler.Login)
		auth.POST("/register", authHandler.Register)
	}

	// WebSocket upgrade (handles its own JWT auth via query param or header).
	v1.GET("/ws", wsHandler.Upgrade)
	// Patient WebSocket — validates patient_token from query param, joins same Hub.
	v1.GET("/patient/ws", wsHandler.PatientUpgrade)

	// Auth-only routes (JWT validated, but no token_version check).
	// The refresh endpoint must bypass TokenVersionMiddleware so that
	// a user with a stale token_version can still obtain a new token.
	authOnly := v1.Group("")
	authOnly.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	authOnly.Use(middleware.TenantStatusMiddleware(db))
	{
		authOnly.POST("/auth/refresh", authHandler.RefreshToken)
	}

	// Authenticated routes.
	authenticated := v1.Group("")
	authenticated.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	authenticated.Use(middleware.TokenVersionMiddleware(db))
	authenticated.Use(middleware.TenantStatusMiddleware(db))
	authenticated.Use(middleware.SuperAdminTenantOverrideMiddleware(db))
	{
		// File download route (authenticated, tenant-isolated).
		authenticated.GET("/files/*key", uploadHandler.GetFile)

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
			patients.GET("/:id/page", middleware.RequirePermission(db, "patient:read"), patientHandler.FindPage)
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

		// File upload/delete routes (authenticated, no specific permission).
		authenticated.POST("/upload", uploadHandler.Upload)
		authenticated.DELETE("/upload", uploadHandler.DeleteUploadedFile)

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
			users.POST("", middleware.RequirePermission(db, "user:manage"), userHandler.CreateUser)
			users.PUT("/:id", middleware.RequirePermission(db, "user:manage"), userHandler.Update)
			users.DELETE("/:id", middleware.RequirePermission(db, "user:manage"), userHandler.Delete)
			users.POST("/:id/roles", middleware.RequirePermission(db, "user:manage"), userHandler.AssignRoles)
			users.POST("/:id/reset-password", middleware.RequirePermission(db, "user:manage"), userHandler.ResetPassword)
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
			// Accessible tenants for filter dropdowns (super admin + power admin).
			tenants.GET("/accessible", middleware.RequireSuperOrPowerAdmin(db), tenantHandler.ListAccessible)
		}

		// Tenant-scoped admin routes (for clinic operators).
		tenantAdmin := authenticated.Group("/tenant")
		{
			tenantUsers := tenantAdmin.Group("/users")
			tenantUsers.Use(middleware.RequirePermission(db, "tenant:user:manage", "user:manage"))
			{
				tenantUsers.GET("", tenantAdminHandler.ListUsers)
				tenantUsers.POST("", tenantAdminHandler.CreateUser)
				tenantUsers.PUT("/:id", tenantAdminHandler.UpdateUser)
				tenantUsers.DELETE("/:id", tenantAdminHandler.DeleteUser)
				tenantUsers.POST("/:id/roles", tenantAdminHandler.AssignRoles)
				tenantUsers.POST("/:id/reset-password", tenantAdminHandler.ResetPassword)
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
			herbs.GET("/:id/page", herbHandler.FindPage)
			herbs.POST("", middleware.RequirePermission(db, "role:manage"), herbHandler.Create)
			herbs.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), herbHandler.Delete)
			herbs.PUT("/:id", middleware.RequirePermission(db, "role:manage"), herbHandler.Update)
			herbs.POST("/:id/ai-refresh", middleware.RequirePermission(db, "role:manage"), herbHandler.AIRefresh)
		}

		// Formula routes (global data, authenticated, no permission required for read).
		formulas := authenticated.Group("/formulas")
		{
			formulas.GET("", formulaHandler.List)
			formulas.GET("/:id", formulaHandler.Detail)
			formulas.GET("/:id/page", formulaHandler.FindPage)
			formulas.POST("", middleware.RequirePermission(db, "role:manage"), formulaHandler.Create)
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
			clinicalExp.GET("/:id/page", clinicalExpHandler.FindPage)
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
			inventoryDrugs.POST("/batch-stock-out", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.BatchStockOut)
			inventoryDrugs.POST("/:id/stock-in", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.StockIn)
			inventoryDrugs.POST("/:id/stock-out", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.StockOut)
			inventoryDrugs.GET("/:id/page", middleware.RequirePermission(db, "inventory:read"), inventoryDrugHandler.FindPage)
			inventoryDrugs.PUT("/:id", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.Update)
			inventoryDrugs.DELETE("/:id", middleware.RequirePermission(db, "inventory:delete"), inventoryDrugHandler.Delete)
		}

		// Prescription notification routes (tenant-scoped, dispense workflow).
		pn := authenticated.Group("/prescription-notifications")
		{
			pn.GET("", middleware.RequirePermission(db, "inventory:read"), pnHandler.List)
			pn.GET("/pending-count", pnHandler.PendingCount)
			pn.GET("/:id/detail", middleware.RequirePermission(db, "inventory:read"), pnHandler.Detail)
			pn.POST("/:id/done", middleware.RequirePermission(db, "inventory:update"), pnHandler.MarkDone)
			pn.POST("/batch-done", middleware.RequirePermission(db, "inventory:update"), pnHandler.BatchDone)
		}

		// Queue (virtual number / waiting list) routes (tenant-scoped).
		queue := authenticated.Group("/queue")
		{
			queue.GET("", middleware.RequirePermission(db, "queue:read"), queueHandler.List)
			queue.GET("/doctors", middleware.RequirePermission(db, "queue:create"), queueHandler.Doctors)
			queue.POST("/take", middleware.RequirePermission(db, "queue:create"), queueHandler.TakeNumber)
			queue.POST("/:id/call", middleware.RequirePermission(db, "queue:update"), queueHandler.Call)
			queue.POST("/:id/complete", middleware.RequirePermission(db, "queue:update"), queueHandler.Complete)
			queue.POST("/clear", middleware.RequirePermission(db, "queue:clear"), queueHandler.Clear)
			queue.GET("/stats", middleware.RequirePermission(db, "queue:read"), queueHandler.Stats)
		}

		// Appointment routes (tenant-scoped).
		apptHandler := handler.NewAppointmentHandler(db)
		appt := authenticated.Group("/appointments")
		{
			appt.POST("", middleware.RequirePermission(db, "appointment:create"), apptHandler.Create)
			appt.GET("", middleware.RequirePermission(db, "appointment:read"), apptHandler.List)
			appt.GET("/slots", middleware.RequirePermission(db, "appointment:read"), apptHandler.Slots)
			appt.GET("/matrix", middleware.RequirePermission(db, "appointment:read"), apptHandler.Matrix)
			appt.POST("/enqueue-today", middleware.RequirePermission(db, "appointment:update"), apptHandler.EnqueueToday)
			appt.PUT("/:id", middleware.RequirePermission(db, "appointment:update"), apptHandler.Update)
			appt.POST("/:id/checkin", middleware.RequirePermission(db, "appointment:checkin"), apptHandler.Checkin)
			appt.POST("/:id/cancel", middleware.RequirePermission(db, "appointment:update"), apptHandler.Cancel)
			appt.DELETE("/:id", middleware.RequirePermission(db, "appointment:delete"), apptHandler.Delete)
		}

		// Appointment slot config routes (tenant-scoped, admin).
		slotSvc := service.NewSlotConfigService(db)
		slotHandler := handler.NewSlotConfigHandler(slotSvc)
		apptSlots := authenticated.Group("/appointment-slots")
		{
			apptSlots.GET("", middleware.RequirePermission(db, "appointment:read"), slotHandler.List)
			apptSlots.POST("", middleware.RequirePermission(db, "appointment:update"), slotHandler.Create)
			apptSlots.PUT("/:id", middleware.RequirePermission(db, "appointment:update"), slotHandler.Update)
			apptSlots.DELETE("/:id", middleware.RequirePermission(db, "appointment:update"), slotHandler.Delete)
		}

		// Queue doctor management routes (tenant-scoped).
		qd := authenticated.Group("/queue-doctors")
		{
			qd.GET("", middleware.RequirePermission(db, "queue:read"), qdHandler.List)
			qd.POST("", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.Create)
			qd.PUT("/sort", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.UpdateSort)
			qd.PUT("/:id", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.Update)
			qd.DELETE("/:id", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.Delete)
			qd.GET("/:id/schedule", middleware.RequirePermission(db, "appointment:read"), qdHandler.GetDoctorSchedule)
			qd.PUT("/:id/schedule", middleware.RequirePermission(db, "appointment:update"), qdHandler.SetDoctorSchedule)
		}
		authenticated.GET("/tenant/queue-enabled", middleware.RequirePermission(db, "queue:read"), qdHandler.GetQueueEnabled)
		authenticated.PUT("/tenant/queue-enabled", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.SetQueueEnabled)
		authenticated.GET("/tenant/call-duration", middleware.RequirePermission(db, "queue:read"), qdHandler.GetCallDisplayDuration)
		authenticated.PUT("/tenant/call-duration", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.SetCallDisplayDuration)
		authenticated.GET("/tenant/show-arrival-time", middleware.RequirePermission(db, "queue:read"), qdHandler.GetShowArrivalTime)
		authenticated.PUT("/tenant/show-arrival-time", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.SetShowArrivalTime)
		authenticated.GET("/tenant/appointment-enabled", middleware.RequirePermission(db, "appointment:read"), qdHandler.GetAppointmentEnabled)
		authenticated.PUT("/tenant/appointment-enabled", middleware.RequirePermission(db, "appointment:update"), qdHandler.SetAppointmentEnabled)
		authenticated.GET("/tenant/appointment-config", middleware.RequirePermission(db, "appointment:read"), qdHandler.GetAppointmentConfig)
		authenticated.PUT("/tenant/appointment-config", middleware.RequirePermission(db, "appointment:update"), qdHandler.SetAppointmentConfig)
		authenticated.GET("/tenant/call-sound-enabled", middleware.RequirePermission(db, "queue:read"), qdHandler.GetCallSoundEnabled)
		authenticated.PUT("/tenant/call-sound-enabled", middleware.RequirePermission(db, "queue:read"), qdHandler.SetCallSoundEnabled)

		// Follow-up routes (tenant-scoped).
		followUps := authenticated.Group("/follow-ups")
		{
			followUps.GET("", middleware.RequirePermission(db, "followup:read"), followUpHandler.List)
			followUps.POST("", middleware.RequirePermission(db, "followup:create"), followUpHandler.Create)
			followUps.GET("/stats", middleware.RequirePermission(db, "followup:read"), followUpHandler.Stats)
			followUps.GET("/:id/page", middleware.RequirePermission(db, "followup:read"), followUpHandler.FindPage)
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

		// Storage cleanup route (super admin only).
		authenticated.POST("/storage/cleanup", middleware.RequirePermission(db, "user:manage"), uploadHandler.CleanupOrphanFiles)

		// Database cleanup route (super admin only).
		dbCleanupHandler := handler.NewDBCleanupHandler(db)
		authenticated.POST("/db/cleanup", middleware.RequirePermission(db, "user:manage"), dbCleanupHandler.CleanupOrphanData)

		// Backup & Restore routes (super admin only).
		backupHandler := handler.NewBackupHandler(db)
		backupRoutes := authenticated.Group("/backup")
		{
			backupRoutes.GET("/docker-status", middleware.RequirePermission(db, "user:manage"), backupHandler.DockerStatus)
			backupRoutes.POST("/trigger", middleware.RequirePermission(db, "user:manage"), backupHandler.TriggerBackup)
			backupRoutes.GET("/status/:task_id", middleware.RequirePermission(db, "user:manage"), backupHandler.GetTaskStatus)
			backupRoutes.GET("/list/local", middleware.RequirePermission(db, "user:manage"), backupHandler.ListLocalFiles)
			backupRoutes.GET("/list/cloud", middleware.RequirePermission(db, "user:manage"), backupHandler.ListCloudFiles)
		}
		restoreRoutes := authenticated.Group("/restore")
		{
			restoreRoutes.POST("/trigger", middleware.RequirePermission(db, "user:manage"), backupHandler.TriggerRestore)
			restoreRoutes.GET("/status/:task_id", middleware.RequirePermission(db, "user:manage"), backupHandler.GetTaskStatus)
		}

		// Disk monitor & migration routes (super admin only).
		diskHandler := handler.NewDiskHandler(db)
		diskRoutes := authenticated.Group("/disk")
		{
			diskRoutes.GET("/status", middleware.RequirePermission(db, "user:manage"), diskHandler.GetStatus)
			diskRoutes.PUT("/interval", middleware.RequirePermission(db, "user:manage"), diskHandler.SetInterval)
			diskRoutes.GET("/fs", middleware.RequirePermission(db, "user:manage"), diskHandler.BrowseFS)
		}

		// Tenant migration routes (super admin only) — independent from backup/restore.
		migrateSvc := service.NewTenantMigrateService(db)
		migrateHandler := handler.NewTenantMigrateHandler(migrateSvc, db)
		migrateRoutes := authenticated.Group("/tenant-migrate")
		{
			migrateRoutes.POST("/upload", middleware.RequirePermission(db, "user:manage"), migrateHandler.Upload)
			migrateRoutes.POST("/parse", middleware.RequirePermission(db, "user:manage"), migrateHandler.ParseFromBackup)
			migrateRoutes.GET("/status/:task_id", middleware.RequirePermission(db, "user:manage"), migrateHandler.GetStatus)
			migrateRoutes.POST("/execute", middleware.RequirePermission(db, "user:manage"), migrateHandler.Execute)
			migrateRoutes.GET("/backup-files", middleware.RequirePermission(db, "user:manage"), migrateHandler.ListBackupFiles)
		}

		// Statistics routes (tenant-scoped).
		statistics := authenticated.Group("/statistics")
		{
			statisticsHandler := handler.NewStatisticsHandler(db)
			statistics.GET("/dashboard", middleware.RequirePermission(db, "statistics:read"), statisticsHandler.GetDashboard)
			statistics.POST("/rebuild", middleware.RequirePermission(db, "tenant:manage"), statisticsHandler.RebuildStats)
			statistics.GET("/staff", middleware.RequirePermission(db, "statistics:read"), statisticsHandler.GetStaffRevenue)
		}

		// Admin statistics routes (superAdmin only, checked inside handler).
		adminStatsHandler := handler.NewAdminStatisticsHandler(db)
		adminStats := authenticated.Group("/admin/statistics")
		{
			// /global is accessible to superAdmin (any tenant) and powerAdmin (filtered by managed groups).
			// Route-level guard: RequireSuperOrPowerAdmin. Handler applies the group filter.
			adminStats.GET("/global",
				middleware.RequireSuperOrPowerAdmin(db),
				adminStatsHandler.GetGlobal,
			)
		}

		// PowerAdmin management (superAdmin only).
		powerAdminHandler := handler.NewPowerAdminHandler(db)
		powerAdmins := authenticated.Group("/settings/power-admins")
		{
			powerAdmins.GET("", middleware.RequireSuperAdmin(db), powerAdminHandler.List)
			powerAdmins.DELETE("/:id", middleware.RequireSuperAdmin(db), powerAdminHandler.Delete)
			powerAdmins.PUT("/:id/groups", middleware.RequireSuperAdmin(db), powerAdminHandler.AssignGroups)
			powerAdmins.GET("/groups", middleware.RequireSuperAdmin(db), powerAdminHandler.ListAllGroups)
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

	// ---------- Patient portal handlers ----------
	patientAuthSvc := service.NewPatientAuthService(db)
	patientAuthHandler := handler.NewPatientAuthHandler(patientAuthSvc, cfg.JWTSecret, db)
	patientSettingsHandler := handler.NewPatientSettingsHandler(patientAuthSvc, db)
	patientPortalHandler := handler.NewPatientPortalHandler(db, patientAuthSvc)

	// Public patient auth route (no JWT required).
	patientPublic := v1.Group("/patient")
	{
		patientPublic.POST("/auth/login", patientAuthHandler.Login)
		patientPublic.GET("/auth/tenant-list", patientAuthHandler.ListTenantsByPhone)
		patientPublic.GET("/auth/tenant-info", patientAuthHandler.GetTenantInfo)
	}

	// Authenticated patient routes (patient JWT required).
	patientAuth := v1.Group("/patient")
	patientAuth.Use(middleware.PatientAuthMiddleware(cfg.JWTSecret))
	{
		patientAuth.GET("/me", patientAuthHandler.Me)
		patientAuth.GET("/doctors", patientPortalHandler.ListDoctors)
		patientAuth.GET("/doctors/:id/schedule", patientPortalHandler.GetDoctorSchedule)

		// Appointments
		patientAuth.GET("/appointments", patientPortalHandler.ListAppointments)
		patientAuth.POST("/appointments", patientPortalHandler.CreateAppointment)
		patientAuth.GET("/appointments/slots", patientPortalHandler.GetAppointmentSlots)
		patientAuth.POST("/appointments/:id/cancel", patientPortalHandler.CancelAppointment)
		patientAuth.DELETE("/appointments/:id", patientPortalHandler.DeleteAppointment)
		patientAuth.POST("/appointments/:id/checkin", patientPortalHandler.PatientCheckin)

		// Queue
		patientAuth.POST("/queue/take", patientPortalHandler.TakeNumber)
		patientAuth.GET("/queue/my-status", patientPortalHandler.GetMyQueueStatus)
		patientAuth.GET("/queue/list", patientPortalHandler.ListQueue)

		// Records (read-only)
		patientAuth.GET("/records", patientPortalHandler.ListRecords)
		patientAuth.GET("/records/:id", patientPortalHandler.GetRecord)

		// Billing (read-only)
		patientAuth.GET("/billings", patientPortalHandler.ListBillings)
	}

	// Admin: patient portal config (tenant:user:manage required).
	authenticated.GET("/tenant/patient-portal-config",
		middleware.RequirePermission(db, "tenant:user:manage"),
		patientSettingsHandler.GetPortalConfig)
	authenticated.PUT("/tenant/patient-portal-config",
		middleware.RequirePermission(db, "tenant:user:manage"),
		patientSettingsHandler.UpdatePortalConfig)

	return r
}
