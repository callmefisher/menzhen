package ws

import (
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait   = 10 * time.Second
	pongWait    = 60 * time.Second
	pingPeriod  = 30 * time.Second
	maxMsgSize  = 4096
	sendBufSize = 16
)

type Client struct {
	TenantID uint64
	UserID   uint64
	conn     *websocket.Conn
	send     chan []byte
	hub      *Hub
	closed   chan struct{}
}

func NewClient(hub *Hub, conn *websocket.Conn, tenantID, userID uint64) *Client {
	return &Client{
		TenantID: tenantID,
		UserID:   userID,
		conn:     conn,
		send:     make(chan []byte, sendBufSize),
		hub:      hub,
		closed:   make(chan struct{}),
	}
}

func (c *Client) Send(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
		// drop message for slow consumer; they'll refetch via API
	case <-c.closed:
	}
}

// ReadPump reads client messages (mainly handles pong)
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		close(c.closed)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}

// WritePump writes messages to client + heartbeat
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case data, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-c.closed:
			return
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Run starts read/write goroutines. Blocks until connection closes.
func (c *Client) Run() {
	c.hub.Register(c)
	go c.WritePump()
	c.ReadPump() // blocks until connection closes
}
