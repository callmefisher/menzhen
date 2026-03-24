package handler

import (
	"net/http"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	gws "github.com/gorilla/websocket"
)

var upgrader = gws.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WSHandler struct {
	jwtSecret string
}

func NewWSHandler(jwtSecret string) *WSHandler {
	return &WSHandler{jwtSecret: jwtSecret}
}

func (h *WSHandler) Upgrade(c *gin.Context) {
	// Get token from query param (WebSocket can't use headers easily)
	tokenStr := c.Query("token")
	if tokenStr == "" {
		// Fallback to Authorization header
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
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(h.jwtSecret), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	client := ws.NewClient(ws.DefaultHub, conn, claims.TenantID, claims.UserID)
	client.Run() // blocks until disconnect
}
