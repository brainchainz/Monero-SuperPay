package payments

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/monero-superpay/monero-superpay/internal/config"
	"github.com/monero-superpay/monero-superpay/internal/ws"
)

// walletRPCClient is a reusable HTTP client for wallet RPC calls
var walletRPCClient = &http.Client{
	Timeout: 30 * time.Second,
}

// AutoOpenWallet attempts to open the previously configured wallet on startup.
// Runs in a goroutine with retries since wallet-rpc may not be ready yet.
func AutoOpenWallet(cfg *config.Config, db *sql.DB) {
	// Read wallet_filename from settings
	var filename string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'wallet_filename'").Scan(&filename)
	if err != nil || filename == "" {
		fmt.Println("[payments] No wallet configured — skipping auto-open")
		return
	}

	fmt.Printf("[payments] Auto-opening wallet: %s\n", filename)

	// Retry up to 30 times (5 minutes) waiting for wallet-rpc to be ready
	for i := 0; i < 30; i++ {
		time.Sleep(10 * time.Second)

		resp, err := callWalletRPC(cfg.WalletRPCURL, "open_wallet", map[string]interface{}{
			"filename": filename,
		})
		if err != nil {
			if strings.Contains(err.Error(), "connection refused") {
				fmt.Printf("[payments] wallet-rpc not ready yet, retrying (%d/30)...\n", i+1)
				continue
			}
			fmt.Printf("[payments] Error opening wallet: %v\n", err)
			return
		}

		if resp.Error != nil {
			// "Wallet already open" is fine — means another request already opened it
			if strings.Contains(strings.ToLower(resp.Error.Message), "already") {
				fmt.Println("[payments] Wallet already open")
				return
			}
			fmt.Printf("[payments] wallet-rpc error opening wallet: %s\n", resp.Error.Message)
			return
		}

		fmt.Printf("[payments] Wallet '%s' opened successfully\n", filename)
		return
	}

	fmt.Println("[payments] Failed to auto-open wallet after 30 retries")
}

// PaymentResult is returned when a new payment subaddress is created
type PaymentResult struct {
	Address string `json:"address"`
	URI     string `json:"payment_uri"`
}

// walletRPCRequest is the JSON-RPC request to monero-wallet-rpc
type walletRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      string      `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

// walletRPCResponse is the JSON-RPC response from monero-wallet-rpc
type walletRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// PaymentMonitor polls wallet-rpc for incoming payments and updates order status
type PaymentMonitor struct {
	cfg    *config.Config
	db     *sql.DB
	wsHub  *ws.Hub
	mu     sync.Mutex
	stopCh chan struct{}
	wg     sync.WaitGroup
}

// NewPaymentMonitor creates a new payment monitor
func NewPaymentMonitor(cfg *config.Config, db *sql.DB, wsHub *ws.Hub) *PaymentMonitor {
	return &PaymentMonitor{
		cfg:    cfg,
		db:     db,
		wsHub:  wsHub,
		stopCh: make(chan struct{}),
	}
}

// callWalletRPC sends a JSON-RPC request to monero-wallet-rpc
func callWalletRPC(walletRPCURL string, method string, params interface{}) (*walletRPCResponse, error) {
	reqBody := walletRPCRequest{
		JSONRPC: "2.0",
		ID:      "0",
		Method:  method,
		Params:  params,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := walletRPCClient.Post(walletRPCURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to call wallet RPC: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var rpcResp walletRPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &rpcResp, nil
}

// CreatePayment generates a new subaddress for a payment
func CreatePayment(cfg *config.Config, amountXMR string) (*PaymentResult, error) {
	// Create a new subaddress on account 0
	resp, err := callWalletRPC(cfg.WalletRPCURL, "create_address", map[string]interface{}{
		"account_index": 0,
		"label":         fmt.Sprintf("payment-%d", time.Now().UnixMilli()),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create subaddress: %w", err)
	}

	if resp.Error != nil {
		return nil, fmt.Errorf("wallet RPC error: %s", resp.Error.Message)
	}

	var result struct {
		Address      string `json:"address"`
		AddressIndex uint32 `json:"address_index"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("failed to decode create_address response: %w", err)
	}

	if result.Address == "" {
		return nil, fmt.Errorf("wallet returned empty address")
	}

	// Build monero: payment URI
	// Format: monero:address?tx_amount=0.001234
	uri := fmt.Sprintf("monero:%s?tx_amount=%s", result.Address, amountXMR)

	return &PaymentResult{
		Address: result.Address,
		URI:     uri,
	}, nil
}

// Start begins the payment polling loop
func (pm *PaymentMonitor) Start() {
	pm.wg.Add(1)
	go pm.pollLoop()
	fmt.Println("[payments] Payment monitor started")
}

// Stop stops the payment polling loop
func (pm *PaymentMonitor) Stop() {
	close(pm.stopCh)
	pm.wg.Wait()
}

// pollLoop checks for incoming payments every 10 seconds
func (pm *PaymentMonitor) pollLoop() {
	defer pm.wg.Done()
	// Initial delay to let wallet-rpc start up
	time.Sleep(10 * time.Second)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-pm.stopCh:
			fmt.Println("[payments] Payment monitor stopped")
			return
		case <-ticker.C:
			pm.checkPayments()
			pm.expireStaleOrders()
		}
	}
}

// expireStaleOrders marks pending orders older than 15 minutes as expired
func (pm *PaymentMonitor) expireStaleOrders() {
	cutoff := time.Now().Add(-15 * time.Minute)

	result, err := pm.db.Exec(
		"UPDATE orders SET status = 'expired' WHERE status = 'pending' AND created_at < ?",
		cutoff,
	)
	if err != nil {
		fmt.Printf("[payments] Error expiring stale orders: %v\n", err)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		fmt.Printf("[payments] Expired %d stale orders (older than 15 min)\n", rowsAffected)
		// Notify connected clients so dashboards update
		if pm.wsHub != nil {
			pm.wsHub.Broadcast("orders_expired", map[string]interface{}{
				"count": rowsAffected,
			}, "")
		}
	}
}

// pendingOrder represents an order awaiting payment
type pendingOrder struct {
	ID      string
	Address string
	Amount  string
	Status  string
}

// checkPayments queries wallet-rpc for incoming transfers and matches them to pending orders
func (pm *PaymentMonitor) checkPayments() {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Get all pending orders that have a payment address
	rows, err := pm.db.Query(
		"SELECT id, payment_address, total_xmr, status FROM orders WHERE status = 'pending' AND payment_address != '' ORDER BY created_at DESC LIMIT 100",
	)
	if err != nil {
		fmt.Printf("[payments] Error querying pending orders: %v\n", err)
		return
	}
	defer rows.Close()

	var pending []pendingOrder
	for rows.Next() {
		var o pendingOrder
		if err := rows.Scan(&o.ID, &o.Address, &o.Amount, &o.Status); err != nil {
			continue
		}
		pending = append(pending, o)
	}

	if len(pending) == 0 {
		return
	}

	// Build a map of address -> order for quick lookup
	addrMap := make(map[string]*pendingOrder)
	for i := range pending {
		addrMap[pending[i].Address] = &pending[i]
	}

	// Query wallet-rpc for incoming transfers (both confirmed and mempool)
	// Check confirmed transfers (pool = false, in = true)
	pm.checkTransferType(addrMap, false)
	// Check mempool/unconfirmed (pool = true)
	pm.checkTransferType(addrMap, true)
}

func (pm *PaymentMonitor) checkTransferType(addrMap map[string]*pendingOrder, pool bool) {
	params := map[string]interface{}{
		"account_index": 0,
		"subaddr_indices": []int{}, // all subaddresses
	}
	if pool {
		params["pool"] = true
		params["in"] = false
	} else {
		params["in"] = true
		params["pool"] = false
	}

	resp, err := callWalletRPC(pm.cfg.WalletRPCURL, "get_transfers", params)
	if err != nil {
		// Don't spam logs if wallet-rpc is just not ready
		if !strings.Contains(err.Error(), "connection refused") {
			fmt.Printf("[payments] Error calling get_transfers: %v\n", err)
		}
		return
	}

	if resp.Error != nil {
		return
	}

	var transfers struct {
		In   []transfer `json:"in"`
		Pool []transfer `json:"pool"`
	}
	if err := json.Unmarshal(resp.Result, &transfers); err != nil {
		fmt.Printf("[payments] Error decoding transfers: %v\n", err)
		return
	}

	// Combine both types
	all := append(transfers.In, transfers.Pool...)

	for _, tx := range all {
		order, exists := addrMap[tx.Address]
		if !exists {
			continue
		}

		// Verify payment amount matches or exceeds the required amount
		// Convert order.Amount (string, in XMR) to atomic units for comparison
		requiredAmount, err := parseXMRAmount(order.Amount)
		if err != nil {
			fmt.Printf("[payments] Error parsing amount for order %s: %v\n", order.ID, err)
			continue
		}

		// tx.Amount is in atomic units (1 XMR = 1e12 atomic units)
		// Only process if received amount >= required amount
		if tx.Amount < requiredAmount {
			continue
		}

		// Found a payment for a pending order with correct amount
		confirmations := tx.Confirmations
		requiredConfs := pm.cfg.Confirmations

		var newStatus string
		if confirmations >= uint64(requiredConfs) {
			newStatus = "paid"
		} else if confirmations == 0 {
			// Seen in mempool but not confirmed yet — we can still mark as paid
			// if the merchant accepts 0-conf (Confirmations setting = 0)
			if requiredConfs == 0 {
				newStatus = "paid"
			} else {
				continue // wait for confirmations
			}
		} else {
			// Has some confirmations but not enough
			continue
		}

		// Update order status
		now := time.Now()
		_, err = pm.db.Exec(
			"UPDATE orders SET status = ?, paid_at = ? WHERE id = ? AND status = 'pending'",
			newStatus, now, order.ID,
		)
		if err != nil {
			fmt.Printf("[payments] Error updating order %s: %v\n", order.ID, err)
			continue
		}

		fmt.Printf("[payments] Order %s marked as %s (tx: %s, confirmations: %d)\n",
			order.ID, newStatus, tx.TxHash[:16], confirmations)

		// Broadcast via WebSocket so the frontend updates immediately
		if pm.wsHub != nil {
			pm.wsHub.Broadcast("order_paid", map[string]interface{}{
				"id":            order.ID,
				"status":        newStatus,
				"tx_hash":       tx.TxHash,
				"confirmations": confirmations,
			}, "")
		}

		// Remove from map so we don't process again this cycle
		delete(addrMap, tx.Address)
	}
}

type transfer struct {
	Address       string `json:"address"`
	Amount        uint64 `json:"amount"`
	Confirmations uint64 `json:"confirmations"`
	Height        uint64 `json:"height"`
	TxHash        string `json:"txid"`
}

// parseXMRAmount converts an XMR amount string (e.g., "1.5") to atomic units (uint64)
// 1 XMR = 1e12 atomic units
func parseXMRAmount(xmrStr string) (uint64, error) {
	var amount float64
	_, err := fmt.Sscanf(xmrStr, "%f", &amount)
	if err != nil {
		return 0, fmt.Errorf("invalid XMR amount format: %w", err)
	}
	// Convert to atomic units (1 XMR = 1e12 atomic units)
	atomicAmount := uint64(amount * 1e12)
	return atomicAmount, nil
}

