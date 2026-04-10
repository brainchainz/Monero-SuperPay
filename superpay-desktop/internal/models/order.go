package models

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type OrderItem struct {
	ID          string  `json:"id"`
	OrderID     string  `json:"order_id"`
	ProductID   *string `json:"product_id"`
	ProductName string  `json:"product_name"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	LineTotal   float64 `json:"line_total"`
	Note        string  `json:"note"`
}

type Order struct {
	ID             string      `json:"id"`
	OrderNumber    int         `json:"order_number"`
	DeviceID       *string     `json:"device_id"`
	DeviceName     string      `json:"device_name"` // persisted on creation; also enriched from devices table at query time
	CustomerName   string      `json:"customer_name"`
	Note           string      `json:"note"`
	SubtotalFiat   float64     `json:"subtotal_fiat"`
	TaxFiat        float64     `json:"tax_fiat"`
	TotalFiat      float64     `json:"total_fiat"`
	FiatCurrency   string      `json:"fiat_currency"`
	TotalXMR       string      `json:"total_xmr"`
	XMRRate        float64     `json:"xmr_rate"`
	PaymentID      string      `json:"payment_id"`
	PaymentAddress string      `json:"payment_address"`
	WalletName     string      `json:"wallet_name"`
	Status         string      `json:"status"` // pending, paid, confirmed, cancelled, delivered
	Items          []OrderItem `json:"items"`
	PaidAt         *time.Time  `json:"paid_at"`
	DeliveredAt    *time.Time  `json:"delivered_at"`
	CreatedAt      time.Time   `json:"created_at"`
}

type ProductSale struct {
	ProductName string  `json:"product_name"`
	Quantity    float64 `json:"quantity"`
	TotalFiat   float64 `json:"total_fiat"`
}

type DeviceSale struct {
	DeviceName string  `json:"device_name"`
	TotalFiat  float64 `json:"total_fiat"`
	OrderCount int     `json:"order_count"`
}

type OrderStats struct {
	TodaysTotal    float64       `json:"todays_total"`
	TodaysCount    int           `json:"todays_count"`
	TodaysPaidXMR  string        `json:"todays_paid_xmr"`
	WeekTotal      float64       `json:"week_total"`
	WeekCount      int           `json:"week_count"`
	MonthTotal     float64       `json:"month_total"`
	MonthCount     int           `json:"month_count"`
	SalesByProduct []ProductSale `json:"sales_by_product"`
	SalesByDevice  []DeviceSale  `json:"sales_by_device"`
}

// CreateOrder creates a new order with items
func CreateOrder(ctx context.Context, db *sql.DB, order *Order) (*Order, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	order.ID = uuid.New().String()
	order.CreatedAt = time.Now()

	// Get next order number from sequence
	var orderNumber int
	err = tx.QueryRowContext(ctx, "SELECT value FROM sequences WHERE name = 'order_number'").Scan(&orderNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to get order number sequence: %w", err)
	}

	orderNumber++
	order.OrderNumber = orderNumber

	// Update sequence
	_, err = tx.ExecContext(ctx, "UPDATE sequences SET value = ? WHERE name = 'order_number'", orderNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to update sequence: %w", err)
	}

	// Insert order
	_, err = tx.ExecContext(ctx,
		"INSERT INTO orders (id, order_number, device_id, device_name, customer_name, note, subtotal_fiat, tax_fiat, total_fiat, fiat_currency, total_xmr, xmr_rate, payment_id, payment_address, wallet_name, status, delivered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		order.ID, order.OrderNumber, order.DeviceID, order.DeviceName, order.CustomerName, order.Note,
		order.SubtotalFiat, order.TaxFiat, order.TotalFiat, order.FiatCurrency,
		order.TotalXMR, order.XMRRate, order.PaymentID, order.PaymentAddress,
		order.WalletName, order.Status, order.DeliveredAt, order.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create order: %w", err)
	}

	// Insert order items
	for _, item := range order.Items {
		item.ID = uuid.New().String()
		item.OrderID = order.ID

		_, err = tx.ExecContext(ctx,
			"INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, line_total, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			item.ID, item.OrderID, item.ProductID, item.ProductName, item.Quantity, item.UnitPrice, item.LineTotal, item.Note,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create order item: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return order, nil
}

// ListOrders returns orders with optional filtering
func ListOrders(ctx context.Context, db *sql.DB, statusFilter *string, deviceIDFilter *string, startDate *time.Time, endDate *time.Time, limit int, offset int) ([]Order, error) {
	query := "SELECT id, order_number, device_id, device_name, customer_name, note, subtotal_fiat, tax_fiat, total_fiat, fiat_currency, total_xmr, xmr_rate, payment_id, payment_address, wallet_name, status, paid_at, delivered_at, created_at FROM orders WHERE 1=1"
	var args []interface{}

	if statusFilter != nil && *statusFilter != "" {
		query += " AND status = ?"
		args = append(args, *statusFilter)
	}

	if deviceIDFilter != nil && *deviceIDFilter != "" {
		if *deviceIDFilter == "__main__" {
			// Special filter: orders created from the main dashboard (no device_id)
			query += " AND device_id IS NULL"
		} else {
			query += " AND device_id = ?"
			args = append(args, *deviceIDFilter)
		}
	}

	if startDate != nil {
		query += " AND created_at >= ?"
		args = append(args, *startDate)
	}

	if endDate != nil {
		query += " AND created_at <= ?"
		args = append(args, *endDate)
	}

	query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query orders: %w", err)
	}
	defer rows.Close()

	var orders []Order
	var orderIDs []interface{}
	for rows.Next() {
		var order Order
		err := rows.Scan(
			&order.ID, &order.OrderNumber, &order.DeviceID, &order.DeviceName, &order.CustomerName, &order.Note,
			&order.SubtotalFiat, &order.TaxFiat, &order.TotalFiat, &order.FiatCurrency,
			&order.TotalXMR, &order.XMRRate, &order.PaymentID, &order.PaymentAddress,
			&order.WalletName, &order.Status, &order.PaidAt, &order.DeliveredAt, &order.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan order: %w", err)
		}
		orders = append(orders, order)
		orderIDs = append(orderIDs, order.ID)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating orders: %w", err)
	}

	// Fetch all order items in a single query if there are any orders
	if len(orderIDs) > 0 {
		itemsByOrderID, err := getOrderItemsBatch(db, orderIDs)
		if err != nil {
			return nil, fmt.Errorf("failed to get order items: %w", err)
		}

		// Assign items to each order from the map
		for i := range orders {
			orders[i].Items = itemsByOrderID[orders[i].ID]
		}
	}

	return orders, nil
}

// GetOrder retrieves an order with all its items
func GetOrder(ctx context.Context, db *sql.DB, id string) (*Order, error) {
	order := &Order{}
	err := db.QueryRowContext(ctx,
		"SELECT id, order_number, device_id, device_name, customer_name, note, subtotal_fiat, tax_fiat, total_fiat, fiat_currency, total_xmr, xmr_rate, payment_id, payment_address, wallet_name, status, paid_at, delivered_at, created_at FROM orders WHERE id = ?",
		id,
	).Scan(
		&order.ID, &order.OrderNumber, &order.DeviceID, &order.DeviceName, &order.CustomerName, &order.Note,
		&order.SubtotalFiat, &order.TaxFiat, &order.TotalFiat, &order.FiatCurrency,
		&order.TotalXMR, &order.XMRRate, &order.PaymentID, &order.PaymentAddress,
		&order.WalletName, &order.Status, &order.PaidAt, &order.DeliveredAt, &order.CreatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("order not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query order: %w", err)
	}

	// Get order items
	items, err := getOrderItems(db, order.ID)
	if err != nil {
		return nil, err
	}
	order.Items = items

	return order, nil
}

// UpdateOrderStatus updates an order's status
func UpdateOrderStatus(db *sql.DB, id string, status string) error {
	var paidAt *time.Time
	var deliveredAt *time.Time
	now := time.Now()
	if status == "paid" {
		paidAt = &now
	}
	if status == "delivered" {
		deliveredAt = &now
	}

	result, err := db.Exec(
		"UPDATE orders SET status = ?, paid_at = COALESCE(?, paid_at), delivered_at = COALESCE(?, delivered_at) WHERE id = ?",
		status, paidAt, deliveredAt, id,
	)

	if err != nil {
		return fmt.Errorf("failed to update order status: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("order not found")
	}

	return nil
}

// GetOrderStats returns statistics about orders
func GetOrderStats(db *sql.DB) (*OrderStats, error) {
	stats := &OrderStats{}

	// Today's stats
	err := db.QueryRow(`
		SELECT
			COALESCE(SUM(total_fiat), 0),
			COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'paid' THEN CAST(total_xmr AS FLOAT) ELSE 0 END), 0)
		FROM orders
		WHERE DATE(created_at) = DATE('now')
	`).Scan(&stats.TodaysTotal, &stats.TodaysCount, &stats.TodaysPaidXMR)

	if err != nil {
		return nil, fmt.Errorf("failed to get today's stats: %w", err)
	}

	// Week stats
	err = db.QueryRow(`
		SELECT
			COALESCE(SUM(total_fiat), 0),
			COUNT(*)
		FROM orders
		WHERE datetime(created_at) >= datetime('now', '-7 days')
	`).Scan(&stats.WeekTotal, &stats.WeekCount)

	if err != nil {
		return nil, fmt.Errorf("failed to get week stats: %w", err)
	}

	// Month stats
	err = db.QueryRow(`
		SELECT
			COALESCE(SUM(total_fiat), 0),
			COUNT(*)
		FROM orders
		WHERE datetime(created_at) >= datetime('now', '-30 days')
	`).Scan(&stats.MonthTotal, &stats.MonthCount)

	if err != nil {
		return nil, fmt.Errorf("failed to get month stats: %w", err)
	}

	// Sales by Product (All time, Paid)
	productRows, err := db.Query(`
		SELECT product_name, SUM(quantity), SUM(line_total)
		FROM order_items
		JOIN orders ON orders.id = order_items.order_id
		WHERE orders.status IN ('paid', 'delivered') AND product_name IS NOT NULL
		GROUP BY product_name
		ORDER BY SUM(quantity) DESC
	`)
	if err == nil {
		defer productRows.Close()
		for productRows.Next() {
			var ps ProductSale
			if err := productRows.Scan(&ps.ProductName, &ps.Quantity, &ps.TotalFiat); err == nil {
				stats.SalesByProduct = append(stats.SalesByProduct, ps)
			}
		}
	}

	// Sales by Device (All time, Paid)
	deviceRows, err := db.Query(`
		SELECT device_name, SUM(total_fiat), COUNT(id)
		FROM orders
		WHERE status IN ('paid', 'delivered')
		GROUP BY device_name
		ORDER BY SUM(total_fiat) DESC
	`)
	if err == nil {
		defer deviceRows.Close()
		for deviceRows.Next() {
			var ds DeviceSale
			if err := deviceRows.Scan(&ds.DeviceName, &ds.TotalFiat, &ds.OrderCount); err == nil {
				stats.SalesByDevice = append(stats.SalesByDevice, ds)
			}
		}
	}

	return stats, nil
}

// Helper function to get order items
func getOrderItems(db *sql.DB, orderID string) ([]OrderItem, error) {
	rows, err := db.Query(
		"SELECT id, order_id, product_id, product_name, quantity, unit_price, line_total, note FROM order_items WHERE order_id = ? ORDER BY product_name",
		orderID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query order items: %w", err)
	}
	defer rows.Close()

	var items []OrderItem
	for rows.Next() {
		var item OrderItem
		err := rows.Scan(
			&item.ID, &item.OrderID, &item.ProductID, &item.ProductName,
			&item.Quantity, &item.UnitPrice, &item.LineTotal, &item.Note,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan order item: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating order items: %w", err)
	}

	return items, nil
}

// Helper function to fetch order items for multiple orders in a single query (N+1 optimization)
func getOrderItemsBatch(db *sql.DB, orderIDs []interface{}) (map[string][]OrderItem, error) {
	if len(orderIDs) == 0 {
		return make(map[string][]OrderItem), nil
	}

	// Build placeholders for IN clause
	placeholders := make([]string, len(orderIDs))
	for i := range placeholders {
		placeholders[i] = "?"
	}

	query := "SELECT id, order_id, product_id, product_name, quantity, unit_price, line_total, note FROM order_items WHERE order_id IN (" + strings.Join(placeholders, ",") + ") ORDER BY product_name"

	rows, err := db.Query(query, orderIDs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query order items: %w", err)
	}
	defer rows.Close()

	itemsByOrderID := make(map[string][]OrderItem)
	for rows.Next() {
		var item OrderItem
		err := rows.Scan(
			&item.ID, &item.OrderID, &item.ProductID, &item.ProductName,
			&item.Quantity, &item.UnitPrice, &item.LineTotal, &item.Note,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan order item: %w", err)
		}
		itemsByOrderID[item.OrderID] = append(itemsByOrderID[item.OrderID], item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating order items: %w", err)
	}

	return itemsByOrderID, nil
}
