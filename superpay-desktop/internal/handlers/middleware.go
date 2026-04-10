package handlers

import (
	"net/http"
	"strings"

	"github.com/monero-superpay/superpay-desktop/internal/models"
)

// APIKeyAuth middleware validates API key from header
func APIKeyAuth(deps *Dependencies) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				authHeader = r.Header.Get("X-API-Key")
			}

			if authHeader == "" {
				respondError(w, http.StatusUnauthorized, "missing api key")
				return
			}

			// Extract bearer token if present
			apiKey := authHeader
			apiKey = strings.TrimPrefix(apiKey, "Bearer ")

			// Validate API key
			device, err := models.ValidateAPIKey(deps.DB, apiKey)
			if err != nil {
				respondError(w, http.StatusUnauthorized, "invalid api key")
				return
			}

			// Store device in context for later use
			r.Header.Set("X-Device-ID", device.ID)
			r.Header.Set("X-Device-Name", device.Name)

			next.ServeHTTP(w, r)
		})
	}
}

// Helper to get device ID from context
func getDeviceID(r *http.Request) string {
	return r.Header.Get("X-Device-ID")
}

// Helper to get device name from context
func getDeviceName(r *http.Request) string {
	return r.Header.Get("X-Device-Name")
}
