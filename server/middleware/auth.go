package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// Context keys used by the auth middleware.
const (
	CtxKeyUserID   = "user_id"
	CtxKeyTenantID = "tenant_id"
	CtxKeyUsername = "username"
)

// Claims represents the JWT claims for an authenticated user.
type Claims struct {
	UserID   uint64 `json:"user_id"`
	TenantID uint64 `json:"tenant_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// GenerateToken creates a signed JWT token with user information.
// The token expires after 24 hours.
func GenerateToken(userID uint64, tenantID uint64, username string, secret string) (string, error) {
	claims := Claims{
		UserID:   userID,
		TenantID: tenantID,
		Username: username,
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
