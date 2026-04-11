package handlers

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/monero-superpay/monero-superpay/internal/config"
)

// walletClient is a reusable HTTP client for wallet RPC calls
var walletClient = &http.Client{
	Timeout: 30 * time.Second,
}

// daemonClient is a reusable HTTP client for daemon RPC calls
var daemonClient = &http.Client{
	Timeout: 5 * time.Second,
}

// isLookupError checks if the error is a DNS lookup failure
func isLookupError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such host") || strings.Contains(err.Error(), "lookup")
}

// WalletSetupRequest is what the user submits from the Settings page
type WalletSetupRequest struct {
	PrimaryAddress   string `json:"primary_address"`
	SecretViewKey    string `json:"secret_view_key"`
	RestoreHeight    int64  `json:"restore_height"` // 0 = scan from beginning
	WalletName       string `json:"wallet_name"`    // optional
	ConfirmOverwrite bool   `json:"confirm_overwrite"` // required if wallet already configured
}

// WalletStatusResponse tells the frontend if a wallet is loaded
type WalletStatusResponse struct {
	Configured      bool   `json:"configured"`
	Address         string `json:"address,omitempty"` // first few + last few chars
	Syncing         bool   `json:"syncing"`
	Height          int64  `json:"height"`
	DaemonHeight    int64  `json:"daemon_height"`
	DaemonConnected bool   `json:"daemon_connected"`
	BlocksToSync    int64  `json:"blocks_to_sync"`
	Filename        string `json:"filename,omitempty"`
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

	resp, err := walletClient.Post(walletRPCURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		// Provide a more helpful error for DNS failures
		if isLookupError(err) {
			return nil, fmt.Errorf("wallet RPC container is not running. Check that the Monero node and wallet-rpc Docker containers are started")
		}
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

// SetupWallet creates a view-only wallet in monero-wallet-rpc
func SetupWallet(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req WalletSetupRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		// Check if wallet is already configured and require confirmation
		walletConfigured := getSettingFromDB(deps.DB, "wallet_configured")
		if walletConfigured == "true" && !req.ConfirmOverwrite {
			respondError(w, http.StatusConflict, "wallet is already configured. Include \"confirm_overwrite\": true in the request body to reconfigure")
			return
		}

		// Validate primary address (Monero addresses are 95 chars for mainnet, 106 for integrated)
		if len(req.PrimaryAddress) < 90 {
			respondError(w, http.StatusBadRequest, "invalid Monero primary address")
			return
		}

		// Validate view key (64 hex characters)
		viewKeyRegex := regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
		if !viewKeyRegex.MatchString(req.SecretViewKey) {
			respondError(w, http.StatusBadRequest, "invalid secret view key (must be 64 hex characters)")
			return
		}

		// Try to close any currently open wallet first (ignore errors)
		callWalletRPC(deps.Cfg.WalletRPCURL, "close_wallet", nil)

		// Determine filename
		filename := "merchant_wallet"
		if req.WalletName != "" {
			filename = req.WalletName
		}

		// Create view-only wallet via generate_from_keys
		params := map[string]interface{}{
			"filename":       filename,
			"address":        req.PrimaryAddress,
			"viewkey":        req.SecretViewKey,
			"password":       "",
			"restore_height": req.RestoreHeight,
		}

		// If REUSED marker, just try to open
		var resp *walletRPCResponse
		var err error
		if req.PrimaryAddress == "REUSED" {
			params = map[string]interface{}{
				"filename": filename,
				"password": "",
			}
			resp, err = callWalletRPC(deps.Cfg.WalletRPCURL, "open_wallet", params)
		} else {
			resp, err = callWalletRPC(deps.Cfg.WalletRPCURL, "generate_from_keys", params)
		}

		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to connect to wallet RPC: "+err.Error())
			return
		}

		if resp.Error != nil {
			// If wallet already exists, try to open it instead
			if resp.Error.Code == -21 || (strings.Contains(strings.ToLower(resp.Error.Message), "wallet") && strings.Contains(strings.ToLower(resp.Error.Message), "already exists")) {
				openResp, openErr := callWalletRPC(deps.Cfg.WalletRPCURL, "open_wallet", map[string]interface{}{
					"filename": filename,
					"password": "",
				})
				if openErr != nil || (openResp != nil && openResp.Error != nil) {
					msg := "wallet file exists but couldn't open it"
					if openResp != nil && openResp.Error != nil {
						msg += ": " + openResp.Error.Message
					}
					respondError(w, http.StatusInternalServerError, msg)
					return
				}
			} else {
				respondError(w, http.StatusBadRequest, "wallet RPC error: "+resp.Error.Message)
				return
			}
		}

		// Store the address in settings for display
		// Always fetch the actual address from the wallet after setup/open
		walletAddr := req.PrimaryAddress
		addrResp, _ := callWalletRPC(deps.Cfg.WalletRPCURL, "get_address", map[string]interface{}{"account_index": 0})
		if addrResp != nil && addrResp.Error == nil {
			var addrResult struct {
				Address string `json:"address"`
			}
			json.Unmarshal(addrResp.Result, &addrResult)
			if addrResult.Address != "" {
				walletAddr = addrResult.Address
			}
		}

		maskedAddr := ""
		if len(walletAddr) > 16 {
			maskedAddr = walletAddr[:8] + "..." + walletAddr[len(walletAddr)-8:]
		} else {
			maskedAddr = walletAddr
		}

		SetSetting(deps.DB, "wallet_address", maskedAddr)
		SetSetting(deps.DB, "wallet_configured", "true")
		SetSetting(deps.DB, "wallet_filename", filename)

		respondSuccess(w, http.StatusOK, map[string]interface{}{
			"status":  "ok",
			"message": "Wallet loaded successfully.",
			"address": maskedAddr,
		})
	}
}

// DeleteWallet disconnects the current wallet
func DeleteWallet(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Tell wallet-rpc to close the wallet
		callWalletRPC(deps.Cfg.WalletRPCURL, "close_wallet", nil)

		// 2. Clear settings in DB
		SetSetting(deps.DB, "wallet_configured", "false")
		SetSetting(deps.DB, "wallet_address", "")
		SetSetting(deps.DB, "wallet_filename", "")

		respondSuccess(w, http.StatusOK, map[string]interface{}{
			"status":  "ok",
			"message": "Wallet disconnected. Files remain on disk for safety.",
		})
	}
}

// ListWallets returns a list of .keys files in the wallet directory
func ListWallets(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// The wallet volume is mounted to /wallet in the docker container
		walletDir := "/wallet"
		files, err := os.ReadDir(walletDir)
		if err != nil {
			// If directory doesn't exist, just return empty list
			respondSuccess(w, http.StatusOK, []interface{}{})
			return
		}

		walletFiles := []map[string]string{}
		for _, file := range files {
			if !file.IsDir() && strings.HasSuffix(file.Name(), ".keys") {
				name := strings.TrimSuffix(file.Name(), ".keys")
				walletFiles = append(walletFiles, map[string]string{
					"name": name,
				})
			}
		}

		respondSuccess(w, http.StatusOK, walletFiles)
	}
}

// md5Hash returns the hex-encoded MD5 hash of a string
func md5Hash(s string) string {
	h := md5.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}

// parseDigestChallenge extracts fields from a WWW-Authenticate: Digest header
func parseDigestChallenge(header string) map[string]string {
	result := make(map[string]string)
	// Remove "Digest " prefix
	header = strings.TrimPrefix(header, "Digest ")
	// Parse key=value pairs
	re := regexp.MustCompile(`(\w+)=(?:"([^"]+)"|([^\s,]+))`)
	matches := re.FindAllStringSubmatch(header, -1)
	for _, m := range matches {
		if m[2] != "" {
			result[m[1]] = m[2]
		} else {
			result[m[1]] = m[3]
		}
	}
	return result
}

// callDaemonRPC sends a JSON-RPC request directly to the Monero daemon
// Uses HTTP Digest Authentication (which monerod requires)
func callDaemonRPC(cfg *config.Config, method string, params interface{}) (*walletRPCResponse, error) {
	daemonURL := fmt.Sprintf("http://%s:%s/json_rpc", cfg.MoneroNodeIP, cfg.MoneroRPCPort)

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

	fmt.Printf("[daemon-rpc] Calling %s at %s\n", method, daemonURL)

	// Step 1: Make initial request to get the digest challenge
	req1, err := http.NewRequest("POST", daemonURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	req1.Header.Set("Content-Type", "application/json")

	resp1, err := daemonClient.Do(req1)
	if err != nil {
		fmt.Printf("[daemon-rpc] Error connecting to daemon: %v\n", err)
		return nil, fmt.Errorf("failed to call daemon RPC: %w", err)
	}
	defer resp1.Body.Close()
	io.ReadAll(resp1.Body) // drain the body

	fmt.Printf("[daemon-rpc] Initial response status: %d\n", resp1.StatusCode)

	// If no auth required, or not a 401, handle directly
	if resp1.StatusCode != 401 {
		// Not a digest auth challenge — maybe no auth needed
		// Re-do the request cleanly
		req, _ := http.NewRequest("POST", daemonURL, bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := daemonClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to call daemon RPC: %w", err)
		}
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		var rpcResp walletRPCResponse
		if err := json.Unmarshal(respBody, &rpcResp); err != nil {
			return nil, fmt.Errorf("failed to decode response: %w", err)
		}
		return &rpcResp, nil
	}

	// Step 2: Parse the WWW-Authenticate digest challenge
	authHeader := resp1.Header.Get("WWW-Authenticate")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Digest ") {
		return nil, fmt.Errorf("daemon returned 401 but no Digest challenge")
	}

	challenge := parseDigestChallenge(authHeader)
	realm := challenge["realm"]
	nonce := challenge["nonce"]
	qop := challenge["qop"]

	if nonce == "" {
		return nil, fmt.Errorf("daemon digest challenge missing nonce")
	}

	// Step 3: Compute the digest response
	ha1 := md5Hash(fmt.Sprintf("%s:%s:%s", cfg.MoneroRPCUser, realm, cfg.MoneroRPCPass))
	ha2 := md5Hash("POST:/json_rpc")

	nc := "00000001"
	cnonce := fmt.Sprintf("%08x", rand.Uint32())

	var response string
	if strings.Contains(qop, "auth") {
		response = md5Hash(fmt.Sprintf("%s:%s:%s:%s:%s:%s", ha1, nonce, nc, cnonce, "auth", ha2))
	} else {
		response = md5Hash(fmt.Sprintf("%s:%s:%s", ha1, nonce, ha2))
	}

	// Step 4: Build the Authorization header and retry
	authValue := fmt.Sprintf(
		`Digest username="%s", realm="%s", nonce="%s", uri="/json_rpc", response="%s"`,
		cfg.MoneroRPCUser, realm, nonce, response,
	)
	if strings.Contains(qop, "auth") {
		authValue += fmt.Sprintf(`, qop=auth, nc=%s, cnonce="%s"`, nc, cnonce)
	}

	req2, err := http.NewRequest("POST", daemonURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", authValue)

	resp2, err := daemonClient.Do(req2)
	if err != nil {
		return nil, fmt.Errorf("failed to call daemon RPC (retry): %w", err)
	}
	defer resp2.Body.Close()

	fmt.Printf("[daemon-rpc] Digest auth response status: %d\n", resp2.StatusCode)

	respBody, err := io.ReadAll(resp2.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp2.StatusCode != 200 {
		fmt.Printf("[daemon-rpc] Non-200 after digest auth: %s\n", string(respBody))
		return nil, fmt.Errorf("daemon returned status %d after digest auth", resp2.StatusCode)
	}

	var rpcResp walletRPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		fmt.Printf("[daemon-rpc] Failed to decode response: %s\n", string(respBody))
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &rpcResp, nil
}

// GetWalletStatus returns the current wallet state
func GetWalletStatus(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := WalletStatusResponse{
			DaemonConnected: false,
			Syncing:         false,
		}

		// Check if wallet is configured in settings
		configured := getSettingFromDB(deps.DB, "wallet_configured")
		if configured != "true" {
			respondSuccess(w, http.StatusOK, status)
			return
		}

		status.Configured = true
		status.Address = getSettingFromDB(deps.DB, "wallet_address")
		status.Filename = getSettingFromDB(deps.DB, "wallet_filename")

		// 1. Get wallet height
		heightResp, err := callWalletRPC(deps.Cfg.WalletRPCURL, "get_height", nil)
		if err == nil && heightResp.Error == nil {
			var heightResult struct {
				Height int64 `json:"height"`
			}
			if json.Unmarshal(heightResp.Result, &heightResult) == nil {
				status.Height = heightResult.Height
			}
		}

		// 2. Get Daemon height and status
		daemonResp, err := callDaemonRPC(deps.Cfg, "get_info", nil)
		if err == nil && daemonResp != nil && daemonResp.Error == nil {
			status.DaemonConnected = true

			var daemonResult struct {
				Height       int64 `json:"height"`
				TargetHeight int64 `json:"target_height"`
			}
			if json.Unmarshal(daemonResp.Result, &daemonResult) == nil {
				// Use the actual height or the target height if syncing
				status.DaemonHeight = daemonResult.Height
				if daemonResult.TargetHeight > daemonResult.Height {
					status.DaemonHeight = daemonResult.TargetHeight
				}

				// Determine sync status and generic blocks left
				if status.Height < status.DaemonHeight {
					status.Syncing = true
					status.BlocksToSync = status.DaemonHeight - status.Height
					// Avoid negative blocks under edge conditions
					if status.BlocksToSync < 0 {
						status.BlocksToSync = 0
					}
				}
			}
		}

		respondSuccess(w, http.StatusOK, status)
	}
}
