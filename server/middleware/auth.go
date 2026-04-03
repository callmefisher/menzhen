package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

// Context keys used by the auth middleware.
const (
	CtxKeyUserID        = "user_id"
	CtxKeyTenantID      = "tenant_id"
	CtxKeyUsername      = "username"
	CtxKeyTokenVersion  = "token_version"
	CtxKeyManagedGroups = "managed_groups"
)

// Claims represents the JWT claims for an authenticated user.
type Claims struct {
	UserID        uint64   `json:"user_id"`
	TenantID      uint64   `json:"tenant_id"`
	Username      string   `json:"username"`
	TokenVersion  int64    `json:"token_version"`
	ManagedGroups []string `json:"managed_groups,omitempty"`
	jwt.RegisteredClaims
}

// GenerateToken creates a signed JWT token with user information.
// The token expires after 24 hours.
func GenerateToken(userID uint64, tenantID uint64, username string, tokenVersion int64, managedGroups []string, secret string) (string, error) {
	claims := Claims{
		UserID:        userID,
		TenantID:      tenantID,
		Username:      username,
		TokenVersion:  tokenVersion,
		ManagedGroups: managedGroups,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// AuthMiddleware returns a Gin middleware that validates JWT tokens
// from the Authorization header and sets user info in the context.
func AuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "missing authorization header",
			})
			return
		}

		// Expect "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "invalid authorization header format",
			})
			return
		}

		tokenString := parts[1]

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "invalid or expired token",
			})
			return
		}

		// Set user info in context for downstream handlers.
		c.Set(CtxKeyUserID, claims.UserID)
		c.Set(CtxKeyTenantID, claims.TenantID)
		c.Set(CtxKeyUsername, claims.Username)
		c.Set(CtxKeyTokenVersion, claims.TokenVersion)
		c.Set(CtxKeyManagedGroups, claims.ManagedGroups)

		c.Next()
	}
}

// GetUserID extracts the authenticated user's ID from the Gin context.
func GetUserID(c *gin.Context) uint64 {
	v, _ := c.Get(CtxKeyUserID)
	id, _ := v.(uint64)
	return id
}

// GetTenantID extracts the authenticated user's tenant ID from the Gin context.
func GetTenantID(c *gin.Context) uint64 {
	v, _ := c.Get(CtxKeyTenantID)
	id, _ := v.(uint64)
	return id
}

// GetUsername extracts the authenticated user's username from the Gin context.
func GetUsername(c *gin.Context) string {
	v, _ := c.Get(CtxKeyUsername)
	name, _ := v.(string)
	return name
}

// GetTokenVersion extracts the token version from the Gin context.
func GetTokenVersion(c *gin.Context) int64 {
	v, _ := c.Get(CtxKeyTokenVersion)
	ver, _ := v.(int64)
	return ver
}

// GetManagedGroups extracts the powerAdmin's managed group names from context.
func GetManagedGroups(c *gin.Context) []string {
	v, _ := c.Get(CtxKeyManagedGroups)
	groups, _ := v.([]string)
	return groups
}

// SuperAdminTenantOverrideMiddleware allows the protected "admin" account to
// temporarily operate in another tenant's context by passing ?tenant_id=X.
// For powerAdmin users, they may switch only to tenants within their managed groups.
func SuperAdminTenantOverrideMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		username := GetUsername(c)
		tid := c.Query("tenant_id")

		if username == "admin" {
			// superAdmin: can switch to any tenant
			if tid == "" {
				c.Next()
				return
			}
			parsed, err := strconv.ParseUint(tid, 10, 64)
			if err != nil || parsed == 0 {
				c.Next()
				return
			}
			var count int64
			if err := db.Model(&model.Tenant{}).Where("id = ?", parsed).Count(&count).Error; err != nil || count == 0 {
				c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"code": 404, "message": "诊所不存在"})
				return
			}
			c.Set(CtxKeyTenantID, parsed)
			c.Next()
			return
		}

		// powerAdmin: can switch only within managed groups
		managedGroups := GetManagedGroups(c)
		if len(managedGroups) == 0 || tid == "" {
			c.Next()
			return
		}
		parsed, err := strconv.ParseUint(tid, 10, 64)
		if err != nil || parsed == 0 {
			c.Next()
			return
		}
		var tenant model.Tenant
		if err := db.Select("id, group_name").First(&tenant, parsed).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"code": 404, "message": "诊所不存在"})
			return
		}
		for _, g := range managedGroups {
			if g == tenant.GroupName {
				c.Set(CtxKeyTenantID, parsed)
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "message": "无权访问该诊所"})
	}
}

// TokenVersionMiddleware checks that the JWT's token_version matches the DB.
// Returns HTTP 409 with "token_refresh_required" when mismatched, signalling
// the frontend to call /auth/refresh.
func TokenVersionMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.Next()
			return
		}

		jwtVersion := GetTokenVersion(c)

		var user model.User
		if err := db.Select("token_version").First(&user, userID).Error; err != nil {
			c.Next()
			return
		}

		if jwtVersion != user.TokenVersion {
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "token_refresh_required",
			})
			return
		}

		c.Next()
	}
}
