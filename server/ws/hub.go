package ws

import "sync"

// Message is the WebSocket broadcast message structure
type Message struct {
	Type    string      `json:"type"`    // rx_notify, rx_done, rx_cleanup
	Payload interface{} `json:"payload"`
}

// Hub manages all WebSocket connections, grouped by tenantID
type Hub struct {
	mu    sync.RWMutex
	rooms map[uint64]map[*Client]struct{} // tenantID -> clients
}

var DefaultHub = NewHub()

func NewHub() *Hub {
	return &Hub{rooms: make(map[uint64]map[*Client]struct{})}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[c.TenantID] == nil {
		h.rooms[c.TenantID] = make(map[*Client]struct{})
	}
	h.rooms[c.TenantID][c] = struct{}{}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.rooms[c.TenantID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.rooms, c.TenantID)
		}
	}
}

// Broadcast sends a message to all connections in the specified tenant
func (h *Hub) Broadcast(tenantID uint64, msg Message) {
	h.mu.RLock()
	clients := h.rooms[tenantID]
	targets := make([]*Client, 0, len(clients))
	for c := range clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		c.Send(msg)
	}
}
