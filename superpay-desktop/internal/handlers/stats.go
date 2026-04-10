package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/monero-superpay/superpay-desktop/internal/models"
)

// DashboardStatsResponse matches the frontend DashboardStats type exactly
type DashboardStatsResponse struct {
	TodayOrders      int            `json:"today_orders"`
	TodayRevenueFiat float64        `json:"today_revenue_fiat"`
	TodayRevenueXMR  float64        `json:"today_revenue_xmr"`
	FiatCurrency     string         `json:"fiat_currency"`
	ActiveDevices    int            `json:"active_devices"`
	TotalDevices     int            `json:"total_devices"`
	RecentOrders     []OrderSummary `json:"recent_orders"`
}

// OrderSummary — matches enough of the frontend Order type to render in Dashboard table
type OrderSummary struct {
	ID           string    `json:"id"`
	DeviceID     *string   `json:"device_id"`
	DeviceName   string    `json:"device_name"`
	CustomerName string    `json:"customer_name"`
	Status       string    `json:"status"`
	TotalFiat    float64   `json:"total_fiat"`
	TotalXMR     float64   `json:"total_xmr"`
	Items        []string  `json:"items"`
	CreatedAt    time.Time `json:"created_at"`
}

// GetDashboardStats handles GET /api/stats/dashboard endpoint
func GetDashboardStats(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Get all orders
		orders, err := models.ListOrders(r.Context(), deps.DB, nil, nil, nil, nil, 1000, 0)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to fetch orders")
			return
		}

		// Get all devices
		devices, err := models.ListDevices(deps.DB)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to fetch devices")
			return
		}

		// Build device name lookup
		deviceNames := make(map[string]string)
		for _, d := range devices {
			deviceNames[d.ID] = d.Name
		}

		// Calculate statistics
		now := time.Now()
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

		var todayOrders int
		var todayRevenueFiat float64
		xmrTotal := 0.0
		var recentOrders []OrderSummary

		for _, order := range orders {
			// Today's orders
			if order.CreatedAt.After(today) || order.CreatedAt.Equal(today) {
				todayOrders++
				if order.Status == "paid" {
					todayRevenueFiat += order.TotalFiat

					// Parse XMR amount
					if order.TotalXMR != "" {
						if xmrAmt, err := strconv.ParseFloat(order.TotalXMR, 64); err == nil {
							xmrTotal += xmrAmt
						}
					}
				}
			}

			// Recent orders (last 10)
			if len(recentOrders) < 10 {
				xmrFloat := 0.0
				if order.TotalXMR != "" {
					xmrFloat, _ = strconv.ParseFloat(order.TotalXMR, 64)
				}

				deviceName := ""
				if order.DeviceID != nil {
					deviceName = deviceNames[*order.DeviceID]
				}

				recentOrders = append(recentOrders, OrderSummary{
					ID:           order.ID,
					DeviceID:     order.DeviceID,
					DeviceName:   deviceName,
					CustomerName: order.CustomerName,
					Status:       order.Status,
					TotalFiat:    order.TotalFiat,
					TotalXMR:     xmrFloat,
					Items:        []string{}, // empty array so frontend doesn't crash
					CreatedAt:    order.CreatedAt,
				})
			}
		}

		// Count active devices (seen within last 5 minutes)
		var activeDevicesCount int
		fiveMinutesAgo := now.Add(-5 * time.Minute)
		for _, device := range devices {
			if device.LastSeen != nil && device.LastSeen.After(fiveMinutesAgo) {
				activeDevicesCount++
			}
		}

		// Ensure recent_orders is never null
		if recentOrders == nil {
			recentOrders = []OrderSummary{}
		}

		response := DashboardStatsResponse{
			TodayOrders:      todayOrders,
			TodayRevenueFiat: todayRevenueFiat,
			TodayRevenueXMR:  xmrTotal,
			FiatCurrency:     deps.Cfg.FiatCurrency,
			ActiveDevices:    activeDevicesCount,
			TotalDevices:     len(devices),
			RecentOrders:     recentOrders,
		}

		respondSuccess(w, http.StatusOK, response)
	}
}
