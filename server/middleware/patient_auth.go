// server/middleware/patient_auth.go
package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const (
	CtxKeyPatientUserID   = "patient_user_id"
	CtxKeyPatientID       = "patient_id"
	CtxKeyPatientTenantID = "patient_tenant_id"
)

// PatientClaims holds JWT payload for patient portal tokens.
type PatientClaims struct {
	PatientUserID uint64  `json:"patient_user_id"`
	PatientID     *uint64 `json:"patient_id"`
	TenantID      uint64  `json:"tenant_id"`
	UserType      string  `json:"user_type"` // always "patient"
	jwt.RegisteredClaims
}

// GeneratePatientToken signs a 30-day JWT for a patient user.
func GeneratePatientToken(patientUserID uint64, patientID *uint64, tenantID uint64, secret string) (string, error) {
	claims := PatientClaims{
		PatientUserID: patientUserID,
		PatientID:     patientID,
		TenantID:      tenantID,
		UserType:      "patient",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// PatientAuthMiddleware validates patient JWT and rejects staff tokens.
func PatientAuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "missing authorization header"})
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid authorization header format"})
			return
		}
		claims := &PatientClaims{}
		token, err := jwt.ParseWithClaims(parts[1], claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid || claims.UserType != "patient" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid or expired token"})
			return
		}
		c.Set(CtxKeyPatientUserID, claims.PatientUserID)
		c.Set(CtxKeyPatientID, claims.PatientID)
		c.Set(CtxKeyPatientTenantID, claims.TenantID)
		c.Next()
	}
}

// GetPatientUserID extracts patient_user_id from context.
func GetPatientUserID(c *gin.Context) uint64 {
	v, _ := c.Get(CtxKeyPatientUserID)
	id, _ := v.(uint64)
	return id
}

// GetPatientTenantID extracts tenant_id from patient context.
func GetPatientTenantID(c *gin.Context) uint64 {
	v, _ := c.Get(CtxKeyPatientTenantID)
	id, _ := v.(uint64)
	return id
}

// GetPatientIDFromCtx extracts the patient_id pointer from context.
// May be nil if the patient_user has no linked patient record.
func GetPatientIDFromCtx(c *gin.Context) *uint64 {
	v, _ := c.Get(CtxKeyPatientID)
	id, _ := v.(*uint64)
	return id
}
