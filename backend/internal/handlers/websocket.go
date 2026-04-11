package handlers

import (
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // No origin header = non-browser client
		}
		host := r.Host
		return origin == "http://"+host || origin == "https://"+host ||
			origin == "http://localhost:3033" || origin == "http://localhost:5173"
	},
}

// WebSocketHandler upgrades HTTP connection to WebSocket using the ws.Hub from dependencies
func WebSocketHandler(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.WSHub == nil {
			http.Error(w, "websocket hub not configured", http.StatusInternalServerError)
			return
		}

		// Extract store_id from query string
		storeID := r.URL.Query().Get("store_id")

		// Allow both dashboard users (no device ID) and paired devices
		// The WebSocket is used for real-time order updates, node sync status, etc.
		deps.WSHub.ServeWSWithStore(w, r, storeID)
	}
}
