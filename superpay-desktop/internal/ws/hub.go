package ws

import (
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Hub maintains active WebSocket client connections
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan *Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// Client represents a WebSocket connection
type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	send    chan *Message
	id      string
	StoreID string
}

// Message represents a broadcast message
type Message struct {
	EventType string      `json:"event_type"`
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
	StoreID   string      `json:"store_id,omitempty"`
}

// NewHub creates a new WebSocket hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan *Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's event loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			var slow []*Client
			for client := range h.clients {
				if message.StoreID != "" && client.StoreID != message.StoreID {
					continue
				}
				select {
				case client.send <- message:
				default:
					slow = append(slow, client)
				}
			}
			h.mu.RUnlock()
			if len(slow) > 0 {
				h.mu.Lock()
				for _, c := range slow {
					if _, ok := h.clients[c]; ok {
						delete(h.clients, c)
						close(c.send)
					}
				}
				h.mu.Unlock()
			}
		}
	}
}

// Broadcast sends a message to all connected clients
func (h *Hub) Broadcast(eventType string, data interface{}, storeID string) {
	message := &Message{
		EventType: eventType,
		Data:      data,
		Timestamp: time.Now().Unix(),
		StoreID:   storeID,
	}
	select {
	case h.broadcast <- message:
	default:
		// Broadcast channel is full, skip
	}
}

// ServeWS handles WebSocket upgrades and serves the hub
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	h.ServeWSWithStore(w, r, "")
}

// ServeWSWithStore handles WebSocket upgrades with store ID filtering
func (h *Hub) ServeWSWithStore(w http.ResponseWriter, r *http.Request, storeID string) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Localhost-only server, all origins OK
		},
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &Client{
		hub:     h,
		conn:    conn,
		send:    make(chan *Message, 256),
		id:      uuid.New().String(),
		StoreID: storeID,
	}

	h.register <- client

	// Start goroutines for reading and writing
	go client.readPump()
	go client.writePump()
}

// readPump reads messages from the client
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Time{}) // No read deadline
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Time{})
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				// Log error
			}
			return
		}
		// For now, we don't process incoming messages from clients
		// In a production system, you might want to handle client commands
	}
}

// writePump writes messages to the client
func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()

	for message := range c.send {
		c.conn.SetWriteDeadline(time.Time{})

		// Send message as JSON
		if err := c.conn.WriteJSON(message); err != nil {
			return
		}
	}
}

// Event type constants
const (
	EventOrderCreated       = "order_created"
	EventOrderPaid          = "order_paid"
	EventOrderDelivered     = "order_delivered"
	EventOrderCancelled     = "order_cancelled"
	EventDeviceConnected    = "device_connected"
	EventDeviceDisconnected = "device_disconnected"
)
