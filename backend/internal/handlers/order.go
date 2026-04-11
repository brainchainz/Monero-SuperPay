package handlers

import (
	"fmt"
	"html"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/monero-superpay/monero-superpay/internal/models"
	"github.com/monero-superpay/monero-superpay/internal/payments"
	"github.com/monero-superpay/monero-superpay/internal/printer"
)

type CreateOrderItemRequest struct {
	ProductID   *string `json:"product_id"`
	ProductName string  `json:"product_name"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	LineTotal   float64 `json:"line_total"`
	Note        string  `json:"note"`
}

type CreateOrderRequest struct {
	DeviceID     *string                  `json:"device_id"`
	DeviceName   string                   `json:"device_name"`
	CustomerName string                   `json:"customer_name"`
	Note         string                   `json:"note"`
	SubtotalFiat float64                  `json:"subtotal_fiat"`
	TaxFiat      float64                  `json:"tax_fiat"`
	TotalFiat    float64                  `json:"total_fiat"`
	FiatCurrency string                   `json:"fiat_currency"`
	TotalXMR     string                   `json:"total_xmr"`
	XMRRate      float64                  `json:"xmr_rate"`
	PaymentID    string                   `json:"payment_id"`
	PaymentAddr  string                   `json:"payment_address"`
	Status       string                   `json:"status"`
	Items        []CreateOrderItemRequest `json:"items"`
}

type UpdateOrderStatusRequest struct {
	Status string `json:"status"`
}

// CreateOrder creates a new order
func CreateOrder(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req CreateOrderRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.TotalFiat < 0 || req.TotalXMR == "" {
			respondError(w, http.StatusBadRequest, "total_fiat and total_xmr are required")
			return
		}

		// Validate item quantities
		for _, item := range req.Items {
			if item.Quantity <= 0 {
				respondError(w, http.StatusBadRequest, "each item quantity must be greater than 0")
				return
			}
		}

		if req.FiatCurrency == "" {
			req.FiatCurrency = deps.Cfg.FiatCurrency
		}

		// Create a unique subaddress for this payment via wallet-rpc
		var paymentAddr, paymentURI string
		paymentResult, err := payments.CreatePayment(deps.Cfg, req.TotalXMR)
		if err != nil {
			fmt.Printf("[order] Warning: could not create payment subaddress: %v\n", err)
			// Still create the order — just without a payment address
		} else {
			paymentAddr = paymentResult.Address
			paymentURI = paymentResult.URI
		}

		// Get current wallet name for tracking
		walletName, _ := GetSetting(deps.DB, "wallet_filename")

		// Resolve device name: use provided name, look up from device, or default
		deviceName := req.DeviceName
		if deviceName == "" && req.DeviceID != nil && *req.DeviceID != "" {
			// Look up device name from devices table
			device, err := models.GetDevice(deps.DB, *req.DeviceID)
			if err == nil && device != nil {
				deviceName = device.Name
			}
		}
		if deviceName == "" {
			deviceName = "SuperPay Main"
		}

		order := &models.Order{
			DeviceID:       req.DeviceID,
			DeviceName:     deviceName,
			CustomerName:   req.CustomerName,
			Note:           req.Note,
			SubtotalFiat:   req.SubtotalFiat,
			TaxFiat:        req.TaxFiat,
			TotalFiat:      req.TotalFiat,
			FiatCurrency:   req.FiatCurrency,
			TotalXMR:       req.TotalXMR,
			XMRRate:        req.XMRRate,
			PaymentID:      "",
			PaymentAddress: paymentAddr,
			WalletName:     walletName,
			Status:         "pending",
		}

		// Convert items
		for _, itemReq := range req.Items {
			item := models.OrderItem{
				ProductID:   itemReq.ProductID,
				ProductName: itemReq.ProductName,
				Quantity:    itemReq.Quantity,
				UnitPrice:   itemReq.UnitPrice,
				LineTotal:   itemReq.LineTotal,
				Note:        itemReq.Note,
			}
			order.Items = append(order.Items, item)
		}

		createdOrder, err := models.CreateOrder(r.Context(), deps.DB, order)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create order")
			return
		}

		// Broadcast order created event via WebSocket
		if deps.WSHub != nil {
			deps.WSHub.Broadcast("order_created", createdOrder, "")
		}

		// Build response with payment_uri included
		type OrderResponse struct {
			*models.Order
			PaymentURI string `json:"payment_uri,omitempty"`
		}

		respondSuccess(w, http.StatusCreated, OrderResponse{
			Order:      createdOrder,
			PaymentURI: paymentURI,
		})
	}
}

// ListOrders returns orders with optional filtering
func ListOrders(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var status, deviceID *string
		var startDate, endDate *time.Time

		if s := r.URL.Query().Get("status"); s != "" {
			status = &s
		}

		if d := r.URL.Query().Get("device_id"); d != "" {
			deviceID = &d
		}

		if startStr := r.URL.Query().Get("start_date"); startStr != "" {
			if t, err := time.Parse(time.RFC3339, startStr); err == nil {
				startDate = &t
			}
		}

		if endStr := r.URL.Query().Get("end_date"); endStr != "" {
			if t, err := time.Parse(time.RFC3339, endStr); err == nil {
				endDate = &t
			}
		}

		limit := 100
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}

		offset := 0
		if o := r.URL.Query().Get("offset"); o != "" {
			if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
				offset = parsed
			}
		}

		orders, err := models.ListOrders(r.Context(), deps.DB, status, deviceID, startDate, endDate, limit, offset)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to list orders")
			return
		}

		if orders == nil {
			orders = []models.Order{}
		}

		// Enrich device names: use current device name from devices table when available,
		// fall back to the persisted device_name column (covers "SuperPay Main" and renamed devices)
		devices, _ := models.ListDevices(deps.DB)
		if devices != nil {
			deviceNames := make(map[string]string)
			for _, d := range devices {
				deviceNames[d.ID] = d.Name
			}
			for i := range orders {
				if orders[i].DeviceID != nil {
					if name, ok := deviceNames[*orders[i].DeviceID]; ok {
						orders[i].DeviceName = name
					}
				}
				// For orders without a device_id, the persisted device_name
				// (e.g. "SuperPay Main") is already set from the DB column
			}
		}

		respondSuccess(w, http.StatusOK, orders)
	}
}

// GetOrder returns a specific order with items
func GetOrder(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orderID := chi.URLParam(r, "id")

		order, err := models.GetOrder(r.Context(), deps.DB, orderID)
		if err != nil {
			respondError(w, http.StatusNotFound, "order not found")
			return
		}

		respondSuccess(w, http.StatusOK, order)
	}
}

// UpdateOrderStatus updates an order's status
func UpdateOrderStatus(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orderID := chi.URLParam(r, "id")

		var req UpdateOrderStatusRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Status == "" {
			respondError(w, http.StatusBadRequest, "status is required")
			return
		}

		if err := models.UpdateOrderStatus(deps.DB, orderID, req.Status); err != nil {
			respondError(w, http.StatusNotFound, "order not found")
			return
		}

		order, err := models.GetOrder(r.Context(), deps.DB, orderID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to fetch updated order")
			return
		}

		respondSuccess(w, http.StatusOK, order)
	}
}

// ListDeviceOrders returns ALL orders (POS and Monitor devices see the full order stream).
// The device must be authenticated but orders are not filtered by device_id.
func ListDeviceOrders(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deviceID := getDeviceID(r)
		if deviceID == "" {
			respondError(w, http.StatusUnauthorized, "device not authenticated")
			return
		}

		var status *string
		if s := r.URL.Query().Get("status"); s != "" {
			status = &s
		}

		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}

		offset := 0
		if o := r.URL.Query().Get("offset"); o != "" {
			if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
				offset = parsed
			}
		}

		// Return ALL orders — not filtered by device — so POS terminals and
		// Order Monitors see every order regardless of where it was created.
		orders, err := models.ListOrders(r.Context(), deps.DB, status, nil, nil, nil, limit, offset)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to list orders")
			return
		}

		if orders == nil {
			orders = []models.Order{}
		}

		// Enrich device names from devices table
		devices, _ := models.ListDevices(deps.DB)
		if devices != nil {
			deviceNames := make(map[string]string)
			for _, d := range devices {
				deviceNames[d.ID] = d.Name
			}
			for i := range orders {
				if orders[i].DeviceID != nil {
					if name, ok := deviceNames[*orders[i].DeviceID]; ok {
						orders[i].DeviceName = name
					}
				}
			}
		}

		respondSuccess(w, http.StatusOK, orders)
	}
}

// GetOrderStats returns order statistics
func GetOrderStats(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := models.GetOrderStats(deps.DB)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to get order stats")
			return
		}

		respondSuccess(w, http.StatusOK, stats)
	}
}

// MarkOrderDelivered marks an order as delivered
func MarkOrderDelivered(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orderID := chi.URLParam(r, "id")

		if err := models.UpdateOrderStatus(deps.DB, orderID, "delivered"); err != nil {
			respondError(w, http.StatusNotFound, "order not found")
			return
		}

		order, err := models.GetOrder(r.Context(), deps.DB, orderID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to fetch updated order")
			return
		}

		// Broadcast via WebSocket
		if deps.WSHub != nil {
			deps.WSHub.Broadcast("order_delivered", order, "")
		}

		respondSuccess(w, http.StatusOK, order)
	}
}

// sanitizeCSVField prevents spreadsheet formula injection
func sanitizeCSVField(s string) string {
	if strings.HasPrefix(s, "=") || strings.HasPrefix(s, "+") || strings.HasPrefix(s, "-") || strings.HasPrefix(s, "@") {
		return "'" + s
	}
	return s
}

// ExportOrdersCSV generates a CSV file of all orders
func ExportOrdersCSV(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Fetch all orders without pagination/limits for the export
		orders, err := models.ListOrders(r.Context(), deps.DB, nil, nil, nil, nil, 1000000, 0)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to export orders")
			return
		}

		// Set response headers for CSV download
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment;filename=orders_export.csv")

		// Write CSV header
		fmt.Fprintln(w, "Order ID,Order Number,Date,Device,Customer,Total Fiat,Fiat Currency,Total XMR,Status")

		// Write rows
		for _, o := range orders {
			customerName := o.CustomerName
			if customerName != "" {
				customerName = fmt.Sprintf(`"%s"`, sanitizeCSVField(customerName)) // escape commas and formula injection
			}

			deviceName := o.DeviceName
			if deviceName == "" {
				deviceName = "SuperPay Main"
			}
			deviceName = sanitizeCSVField(deviceName)

			fmt.Fprintf(w, "%s,%d,%s,%s,%s,%.2f,%s,%s,%s\n",
				o.ID,
				o.OrderNumber,
				o.CreatedAt.Format(time.RFC3339),
				deviceName,
				customerName,
				o.TotalFiat,
				o.FiatCurrency,
				o.TotalXMR,
				o.Status,
			)
		}
	}
}

// OrderReceipt serves a printable HTML receipt for an order
func OrderReceipt(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orderID := chi.URLParam(r, "id")

		order, err := models.GetOrder(r.Context(), deps.DB, orderID)
		if err != nil {
			http.Error(w, "Order not found", http.StatusNotFound)
			return
		}

		businessName, _ := GetSetting(deps.DB, "business_name")
		if businessName == "" {
			businessName = "Monero SuperPay"
		}
		currency, _ := GetSetting(deps.DB, "fiat_currency")
		if currency == "" {
			currency = "USD"
		}

		sym := "$"
		switch currency {
		case "EUR":
			sym = "€"
		case "GBP":
			sym = "£"
		}

		orderLabel := fmt.Sprintf("#%d", order.OrderNumber)
		if order.OrderNumber == 0 {
			orderLabel = order.ID[:8]
		}

		statusLabel := strings.ToUpper(order.Status)
		if order.Status == "paid" || order.Status == "delivered" {
			statusLabel = "PAID"
		} else if order.Status == "pending" {
			statusLabel = "PAYMENT PENDING"
		}

		// Build items HTML
		var itemsHTML string
		for _, item := range order.Items {
			name := html.EscapeString(item.ProductName)
			qty := ""
			if item.Quantity > 1 {
				qty = fmt.Sprintf(" x%.0f", item.Quantity)
			}
			note := ""
			if item.Note != "" {
				note = fmt.Sprintf(` <em style="color:#666;font-size:0.85em">* %s</em>`, html.EscapeString(item.Note))
			}
			itemsHTML += fmt.Sprintf(`<div style="display:flex;justify-content:space-between;padding:1px 0;">
				<span style="flex:1;padding-right:8px;">%s%s%s</span>
				<span style="white-space:nowrap;">%s%.2f</span>
			</div>`, name, qty, note, sym, item.LineTotal)
		}

		// Tax section
		taxHTML := ""
		if order.TaxFiat > 0 {
			taxHTML = fmt.Sprintf(`
				<div style="display:flex;justify-content:space-between;font-size:11px;color:#333;">
					<span>Subtotal</span><span>%s%.2f</span>
				</div>
				<div style="display:flex;justify-content:space-between;font-size:11px;color:#333;">
					<span>Tax</span><span>%s%.2f</span>
				</div>`, sym, order.SubtotalFiat, sym, order.TaxFiat)
		}

		// XMR section
		xmrHTML := ""
		if order.TotalXMR != "" && order.TotalXMR != "0" {
			xmrVal := order.TotalXMR
			addrHTML := ""
			if order.PaymentAddress != "" {
				addrHTML = fmt.Sprintf(`<div style="font-size:10px;word-break:break-all;margin-top:2px;">%s</div>`, order.PaymentAddress)
			}
			xmrHTML = fmt.Sprintf(`
				<div style="background:#f5f5f5;padding:4px 6px;border-radius:2px;margin:4px 0;text-align:center;">
					<div style="font-size:10px;font-weight:bold;">Paid with Monero (XMR)</div>
					<div style="font-weight:bold;">%s XMR</div>
					%s
				</div>`, xmrVal, addrHTML)
		}

		// Paid at
		paidAtHTML := ""
		if order.PaidAt != nil {
			paidAtHTML = fmt.Sprintf(`<div style="text-align:center;font-size:10px;">Paid: %s</div>`, order.PaidAt.Local().Format("Jan 2, 2006 3:04 PM"))
		}

		// Note
		noteHTML := ""
		if order.Note != "" {
			noteHTML = fmt.Sprintf(`
				<div style="border-top:1px dashed #000;margin:6px 0;"></div>
				<div style="font-size:10px;">Note: %s</div>`, html.EscapeString(order.Note))
		}

		// Customer
		customerHTML := ""
		if order.CustomerName != "" {
			customerHTML = fmt.Sprintf(`<div style="font-size:10px;">Customer: %s</div>`, html.EscapeString(order.CustomerName))
		}

		receiptHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt %s</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.4;background:#fff;color:#000}
.receipt{width:80mm;padding:4mm;margin:20px auto}
@media print{body{margin:0}.receipt{margin:0;width:100%%}.no-print{display:none!important}}
</style>
</head>
<body>
<div class="receipt">
<div style="text-align:center;font-weight:bold;font-size:16px;">%s</div>
<div style="border-top:1px dashed #000;margin:6px 0;"></div>
<div style="display:flex;justify-content:space-between;padding:1px 0;">
<span style="font-size:10px;">Order %s</span>
<span style="font-size:10px;">%s</span>
</div>
%s
<div style="border-top:1px dashed #000;margin:6px 0;"></div>
%s
<div style="border-top:1px dashed #000;margin:6px 0;"></div>
%s
<div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;padding:2px 0;">
<span>TOTAL</span><span>%s%.2f</span>
</div>
%s
<div style="border-top:1px dashed #000;margin:6px 0;"></div>
<div style="text-align:center;font-size:10px;font-weight:bold;text-transform:uppercase;">%s</div>
%s
%s
<div style="border-top:1px dashed #000;margin:6px 0;"></div>
<div style="text-align:center;font-size:10px;color:#666;margin-top:8px;">Powered by Monero SuperPay</div>
<div style="text-align:center;font-size:10px;color:#666;margin-top:2px;">Thank you!</div>
</div>
<div class="no-print" style="text-align:center;margin:20px;">
<button onclick="window.print()" style="padding:10px 32px;background:#f60;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;">Print</button>
</div>
<script>window.onload=function(){window.print()}</script>
</body>
</html>`,
			orderLabel,
			html.EscapeString(businessName),
			orderLabel,
			order.CreatedAt.Local().Format("Jan 2, 2006 3:04 PM"),
			customerHTML,
			itemsHTML,
			taxHTML,
			sym, order.TotalFiat,
			xmrHTML,
			statusLabel,
			paidAtHTML,
			noteHTML,
		)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, receiptHTML)
	}
}

// PrintOrderReceipt sends a receipt to a configured network thermal printer
func PrintOrderReceipt(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orderID := chi.URLParam(r, "id")

		order, err := models.GetOrder(r.Context(), deps.DB, orderID)
		if err != nil {
			respondError(w, http.StatusNotFound, "order not found")
			return
		}

		printerIP, _ := GetSetting(deps.DB, "printer_ip")
		printerPort, _ := GetSetting(deps.DB, "printer_port")
		if printerIP == "" {
			respondError(w, http.StatusBadRequest, "no printer configured — set printer IP in Settings")
			return
		}
		if printerPort == "" {
			printerPort = "9100"
		}

		businessName, _ := GetSetting(deps.DB, "business_name")
		if businessName == "" {
			businessName = "Monero SuperPay"
		}
		currency, _ := GetSetting(deps.DB, "fiat_currency")
		if currency == "" {
			currency = "USD"
		}

		sym := "$"
		switch currency {
		case "EUR":
			sym = "€"
		case "GBP":
			sym = "£"
		}

		orderLabel := fmt.Sprintf("#%d", order.OrderNumber)
		if order.OrderNumber == 0 {
			orderLabel = order.ID[:8]
		}

		statusLabel := strings.ToUpper(order.Status)
		if order.Status == "paid" || order.Status == "delivered" {
			statusLabel = "PAID"
		} else if order.Status == "pending" {
			statusLabel = "PAYMENT PENDING"
		}

		var items []printer.ReceiptItem
		for _, item := range order.Items {
			items = append(items, printer.ReceiptItem{
				Name:     item.ProductName,
				Quantity: item.Quantity,
				Total:    item.LineTotal,
				Note:     item.Note,
			})
		}

		paidAt := ""
		if order.PaidAt != nil {
			paidAt = order.PaidAt.Local().Format("Jan 2, 2006 3:04 PM")
		}

		receiptData := printer.ReceiptData{
			BusinessName:   businessName,
			OrderNumber:    orderLabel,
			CreatedAt:      order.CreatedAt.Local().Format("Jan 2, 2006 3:04 PM"),
			CustomerName:   order.CustomerName,
			Items:          items,
			SubtotalFiat:   order.SubtotalFiat,
			TaxFiat:        order.TaxFiat,
			TotalFiat:      order.TotalFiat,
			CurrencySymbol: sym,
			TotalXMR:       order.TotalXMR,
			PaymentAddress: order.PaymentAddress,
			Status:         statusLabel,
			PaidAt:         paidAt,
			Note:           order.Note,
		}

		escposData := printer.GenerateReceipt(receiptData)

		err = printer.PrintToNetwork(printerIP, printerPort, escposData)
		if err != nil {
			respondError(w, http.StatusInternalServerError, fmt.Sprintf("print failed: %v", err))
			return
		}

		respondSuccess(w, http.StatusOK, map[string]string{"status": "printed"})
	}
}
