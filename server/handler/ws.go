package handler

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	gws "github.com/gorilla/websocket"
)

var upgrader = gws.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		return u.Host == r.Host
	},
}

// hmacKeyFunc returns a jwt.Keyfunc that enforces HMAC signing and rejects algorithm confusion.
func hmacKeyFunc(secret string) jwt.Keyfunc {
	return func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	}
}

type WSHandler struct {
	jwtSecret string
}

func NewWSHandler(jwtSecret string) *WSHandler {
	return &WSHandler{jwtSecret: jwtSecret}
}

// Upgrade handles staff WebSocket connections authenticated with admin JWT.
func (h *WSHandler) Upgrade(c *gin.Context) {
	tokenStr := c.Query("token")
	if tokenStr == "" {
		auth := c.GetHeader("Authorization")
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) == 2 {
			tokenStr = parts[1]
		}
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "missing token"})
		return
	}

	claims := &middleware.Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, hmacKeyFunc(h.jwtSecret))
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ws: upgrade failed for user %d: %v", claims.UserID, err)
		return
	}

	client := ws.NewClient(ws.DefaultHub, conn, claims.TenantID, claims.UserID)
	client.Run()
}

// PatientUpgrade handles patient WebSocket connections authenticated with patient JWT.
// Patients join the same Hub as staff so they receive queue_update broadcasts.
func (h *WSHandler) PatientUpgrade(c *gin.Context) {
	tokenStr := c.Query("token")
	if tokenStr == "" {
		auth := c.GetHeader("Authorization")
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) == 2 {
			tokenStr = parts[1]
		}
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "missing token"})
		return
	}
	claims := &middleware.PatientClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, hmacKeyFunc(h.jwtSecret))
	if err != nil || !token.Valid || claims.UserType != "patient" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid token"})
		return
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ws: patient upgrade failed for user %d: %v", claims.PatientUserID, err)
		return
	}
	client := ws.NewClient(ws.DefaultHub, conn, claims.TenantID, claims.PatientUserID)
	client.Run()
}
