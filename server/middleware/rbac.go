package middleware

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RequirePermission returns a Gin middleware that checks whether the
// authenticated user has ANY of the specified permission codes.
// It should be placed after AuthMiddleware in the handler chain so that
// the user_id is already available in the context.
//
// Usage:
//
//	router.GET("/admin/users", middleware.RequirePermission(db, "user:list", "user:manage"), handler)
func RequirePermission(db *gorm.DB, permCodes ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "unauthorized",
			})
			return
		}

		permSvc := service.NewPermissionService(db)

		// Check if the user has ANY of the required permission codes.
		for _, code := range permCodes {
			has, err := permSvc.HasPermission(userID, code)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"code":    500,
					"message": "permission check failed",
				})
				return
			}
			if has {
				c.Next()
				return
			}
		}

		// None of the required permissions were found.
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"code":    403,
			"message": "没有操作权限",
		})
	}
}
