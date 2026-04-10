package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/monero-superpay/superpay-desktop/internal/models"
)

type PairingTokenRequest struct {
	DeviceName  string `json:"device_name"`
	DeviceType  string `json:"device_type,omitempty"`  // "pos" or "order_monitor"
	TailscaleIP string `json:"tailscale_ip,omitempty"` // optional: Tailscale IP for remote access
}

type PairDeviceRequest struct {
	Token string `json:"token"`
}

type PairDeviceResponse struct {
	Device *models.Device `json:"device"`
	APIKey string         `json:"api_key"`
}

// ConnectionMethod represents one way a PoS device can connect
type ConnectionMethod struct {
	Type string `json:"type"` // "local", "tor", "tailscale"
	URL  string `json:"url"`
	Name string `json:"name"` // friendly label
}

// QRCodeData is encoded into the pairing QR — contains all connection options
type QRCodeData struct {
	Token       string             `json:"token"`
	DeviceName  string             `json:"device_name"`
	Connections []ConnectionMethod `json:"connections"`
}

type UpdateDeviceRequest struct {
	Name   string `json:"name"`
	Config string `json:"config"`
}

// CreatePairingToken generates a new pairing token
func CreatePairingToken(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req PairingTokenRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.DeviceName == "" {
			respondError(w, http.StatusBadRequest, "device_name is required")
			return
		}

		token, err := models.CreatePairingToken(deps.DB, req.DeviceName, req.DeviceType)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create pairing token")
			return
		}

		// Build connection methods for the QR code
		// Route to the correct page based on device type
		deviceType := req.DeviceType
		if deviceType == "" {
			deviceType = "pos"
		}
		pairPath := "/pos?pair="
		if deviceType == "order_monitor" {
			pairPath = "/monitor?pair="
		}

		// Determine the base URL for local connections.
		// For desktop builds, the server binds to 127.0.0.1:<random>, so we need
		// to use the LAN IP + actual port so PoS devices on the same network can reach it.
		// For Umbrel builds, SERVER_URL already has the right host:port.
		localBaseURL := deps.Cfg.ServerURL
		if localBaseURL == "" || localBaseURL == "http://localhost:3033" || strings.HasPrefix(localBaseURL, "http://127.0.0.1:") {
			// Get the actual port from the request Host header
			port := ""
			if r.Host != "" {
				if u, err := url.Parse("http://" + r.Host); err == nil && u.Port() != "" {
					port = u.Port()
				}
			}
			if port == "" {
				port = deps.Cfg.Port
			}

			// Try LAN IP first so other devices on the network can connect
			lanIP := getSettingFromDB(deps.DB, "lan_ip")
			if lanIP != "" {
				localBaseURL = "http://" + lanIP + ":" + port
			} else if r.Host != "" {
				scheme := "http"
				if r.TLS != nil {
					scheme = "https"
				}
				localBaseURL = scheme + "://" + r.Host
			}
		}

		connections := []ConnectionMethod{
			{
				Type: "local",
				URL:  localBaseURL + pairPath + token,
				Name: "Local Network",
			},
		}

		// Add Tor .onion address if available (Umbrel sets this via app proxy)
		torAddr := getSettingFromDB(deps.DB, "tor_address")
		if torAddr != "" {
			connections = append(connections, ConnectionMethod{
				Type: "tor",
				URL:  "http://" + torAddr + pairPath + token,
				Name: "Tor (.onion)",
			})
		}

		// Add Tailscale if provided in request or stored in settings
		tailscaleIP := req.TailscaleIP
		if tailscaleIP == "" {
			tailscaleIP = getSettingFromDB(deps.DB, "tailscale_ip")
		}
		if tailscaleIP != "" {
			// Use the actual runtime port — the desktop app binds to 0.0.0.0:0 (random),
			// so deps.Cfg.ServerURL / deps.Cfg.Port may have stale defaults like "3033".
			externalPort := ""
			if deps.ActualPort > 0 {
				externalPort = fmt.Sprintf("%d", deps.ActualPort)
			} else if r.Host != "" {
				if u, err := url.Parse("http://" + r.Host); err == nil && u.Port() != "" {
					externalPort = u.Port()
				}
			}
			if externalPort == "" {
				externalPort = deps.Cfg.Port
			}
			connections = append(connections, ConnectionMethod{
				Type: "tailscale",
				URL:  "http://" + tailscaleIP + ":" + externalPort + pairPath + token,
				Name: "Tailscale",
			})
		}

		qrData := QRCodeData{
			Token:       token,
			DeviceName:  req.DeviceName,
			Connections: connections,
		}

		respondSuccess(w, http.StatusOK, map[string]interface{}{
			"token":       token,
			"qr_data":     qrData,
			"connections": connections,
		})
	}
}

// GetPairingTokenStatus checks if a token has been used
func GetPairingTokenStatus(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		if token == "" {
			respondError(w, http.StatusBadRequest, "token is required")
			return
		}

		var used bool
		err := deps.DB.QueryRow("SELECT used FROM pairing_tokens WHERE token = ?", token).Scan(&used)
		if err != nil {
			if err == sql.ErrNoRows {
				respondError(w, http.StatusNotFound, "token not found")
			} else {
				respondError(w, http.StatusInternalServerError, "failed to query token")
			}
			return
		}

		respondSuccess(w, http.StatusOK, map[string]interface{}{
			"token": token,
			"used":  used,
		})
	}
}

// PairDevice uses a pairing token to create a new device
func PairDevice(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req PairDeviceRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Token == "" {
			respondError(w, http.StatusBadRequest, "token is required")
			return
		}

		device, apiKey, err := models.PairDevice(deps.DB, req.Token)
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}

		respondSuccess(w, http.StatusCreated, PairDeviceResponse{
			Device: device,
			APIKey: apiKey,
		})
	}
}

// ListDevices returns all devices
func ListDevices(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		devices, err := models.ListDevices(deps.DB)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to list devices")
			return
		}

		if devices == nil {
			devices = []models.Device{}
		}

		respondSuccess(w, http.StatusOK, devices)
	}
}

// GetDevice returns a specific device
func GetDevice(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deviceID := chi.URLParam(r, "id")

		device, err := models.GetDevice(deps.DB, deviceID)
		if err != nil {
			respondError(w, http.StatusNotFound, "device not found")
			return
		}

		respondSuccess(w, http.StatusOK, device)
	}
}

// UpdateDevice updates a device
func UpdateDevice(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deviceID := chi.URLParam(r, "id")

		var req UpdateDeviceRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		device, err := models.UpdateDevice(deps.DB, deviceID, req.Name, req.Config)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to update device")
			return
		}

		respondSuccess(w, http.StatusOK, device)
	}
}

// DeleteDevice deletes a device
func DeleteDevice(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deviceID := chi.URLParam(r, "id")

		if err := models.DeleteDevice(deps.DB, deviceID); err != nil {
			respondError(w, http.StatusNotFound, "device not found")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// UpdateHeartbeat updates device's last_seen timestamp
func UpdateHeartbeat(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deviceID := chi.URLParam(r, "id")

		if err := models.UpdateHeartbeat(deps.DB, deviceID); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to update heartbeat")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// getSettingFromDB reads a single setting value, returns "" if not found
func getSettingFromDB(db *sql.DB, key string) string {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err != nil {
		return ""
	}
	return value
}
