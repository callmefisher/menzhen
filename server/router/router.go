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

	// ---------- Route groups ----------

	v1 := r.Group("/api/v1")

	// Public auth routes.
	auth := v1.Group("/auth")
	{
		auth.POST("/login", authHandler.Login)
		auth.POST("/register", authHandler.Register)
	}

	// Authenticated routes.
	authenticated := v1.Group("")
	authenticated.Use(middleware.AuthMiddleware(cfg.JWTSecret))
	{
		// Auth routes that require authentication.
		authAuth := authenticated.Group("/auth")
		{
			authAuth.POST("/logout", authHandler.Logout)
			authAuth.GET("/me", authHandler.Me)
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

		// File upload/download routes (authenticated, no specific permission).
		authenticated.POST("/upload", uploadHandler.Upload)
		authenticated.GET("/files/*key", uploadHandler.GetFile)

		// Operation log routes.
		oplogs := authenticated.Group("/oplogs")
		{
			oplogs.GET("", middleware.RequirePermission(db, "oplog:read"), oplogHandler.ListOpLogs)
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
	}

	return r
}
