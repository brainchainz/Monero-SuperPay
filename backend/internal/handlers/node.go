package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NodeStatusResponse tells the frontend about the auto-configured node connection
type NodeStatusResponse struct {
	Connected    bool   `json:"connected"`
	NodeAddress  string `json:"node_address"`
	Height       int64  `json:"height"`
	TargetHeight int64  `json:"target_height"`
	Version      string `json:"version,omitempty"`
	Network      string `json:"network,omitempty"`
	Syncing      bool   `json:"syncing"`
	AutoConfig   bool   `json:"auto_config"` // true = node was auto-configured (Umbrel)
}

// GetNodeStatus checks connectivity to the configured Monero daemon and returns its status.
// On Umbrel, the node is auto-configured via docker-compose env vars.
// On desktop, the user configures it manually via /node/connect.
func GetNodeStatus(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := NodeStatusResponse{
			NodeAddress: fmt.Sprintf("%s:%s", deps.Cfg.MoneroNodeIP, deps.Cfg.MoneroRPCPort),
			AutoConfig:  true, // Server version is always auto-configured
		}

		// Call get_info on the daemon via digest auth
		resp, err := callDaemonRPC(deps.Cfg, "get_info", nil)
		if err != nil {
			fmt.Printf("[node-status] Error connecting to daemon: %v\n", err)
			respondSuccess(w, http.StatusOK, status)
			return
		}

		if resp.Error != nil {
			fmt.Printf("[node-status] Daemon RPC error: %s\n", resp.Error.Message)
			respondSuccess(w, http.StatusOK, status)
			return
		}

		// Parse the daemon info
		var info struct {
			Height       int64  `json:"height"`
			TargetHeight int64  `json:"target_height"`
			Version      string `json:"version"`
			Nettype      string `json:"nettype"`
		}
		if err := json.Unmarshal(resp.Result, &info); err == nil {
			status.Connected = true
			status.Height = info.Height
			status.TargetHeight = info.TargetHeight
			status.Version = info.Version
			status.Network = info.Nettype
			status.Syncing = info.TargetHeight > 0 && info.TargetHeight > info.Height
		}

		respondSuccess(w, http.StatusOK, status)
	}
}

// NodeTestRequest is the JSON body for POST /api/node/test
type NodeTestRequest struct {
	Address  string `json:"address"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// NodeTestResponse is the response for a node connectivity test
type NodeTestResponse struct {
	Connected      bool   `json:"connected"`
	Height         int64  `json:"height,omitempty"`
	Version        string `json:"version,omitempty"`
	Network        string `json:"network,omitempty"`
	ResponseTimeMs int64  `json:"response_time_ms,omitempty"`
	Error          string `json:"error,omitempty"`
}

// NodeConnectRequest is the JSON body for POST /api/node/connect
type NodeConnectRequest struct {
	Address  string `json:"address"`
	Username string `json:"username"`
	Password string `json:"password"`
	Type     string `json:"type"` // "public", "custom", "umbrel", "tor"
}

// testDaemonConnection tests connectivity to a Monero daemon at the given address
// Uses digest authentication if credentials are provided
func testDaemonConnection(address, username, password string) (*NodeTestResponse, error) {
	parts := strings.Split(address, ":")
	if len(parts) != 2 {
		return &NodeTestResponse{
			Connected: false,
			Error:     "invalid address format, expected host:port",
		}, nil
	}

	host := parts[0]
	port := parts[1]

	// Step 1: Test basic TCP connectivity with timeout
	startTime := time.Now()
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.Dial("tcp", address)
	if err != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     "connection refused",
		}, nil
	}
	conn.Close()

	// Step 2: Create HTTP client with optional SOCKS5 proxy for .onion addresses
	client := &http.Client{Timeout: 5 * time.Second}
	if strings.HasSuffix(host, ".onion") {
		proxyURL, _ := url.Parse("socks5://localhost:9050")
		transport := &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		}
		client.Transport = transport
	}

	// Step 3: Build the JSON-RPC get_info request
	daemonURL := fmt.Sprintf("http://%s:%s/json_rpc", host, port)

	reqBody := walletRPCRequest{
		JSONRPC: "2.0",
		ID:      "0",
		Method:  "get_info",
		Params:  nil,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     "failed to marshal request",
		}, nil
	}

	// Step 4: Make initial request to get the digest challenge (if needed)
	req1, err := http.NewRequest("POST", daemonURL, bytes.NewBuffer(body))
	if err != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     "failed to create request",
		}, nil
	}
	req1.Header.Set("Content-Type", "application/json")

	resp1, err := client.Do(req1)
	if err != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     "failed to connect to daemon",
		}, nil
	}
	defer resp1.Body.Close()
	io.ReadAll(resp1.Body) // drain body

	// If status is 401 and auth headers provided, handle digest auth
	if resp1.StatusCode == 401 && username != "" {
		authHeader := resp1.Header.Get("WWW-Authenticate")
		if authHeader != "" && strings.HasPrefix(authHeader, "Digest ") {
			challenge := parseDigestChallenge(authHeader)
			realm := challenge["realm"]
			nonce := challenge["nonce"]
			qop := challenge["qop"]

			if nonce != "" {
				ha1 := md5Hash(fmt.Sprintf("%s:%s:%s", username, realm, password))
				ha2 := md5Hash("POST:/json_rpc")

				nc := "00000001"
				cnonce := fmt.Sprintf("%08x", rand.Uint32())

				var response string
				if strings.Contains(qop, "auth") {
					response = md5Hash(fmt.Sprintf("%s:%s:%s:%s:%s:%s", ha1, nonce, nc, cnonce, "auth", ha2))
				} else {
					response = md5Hash(fmt.Sprintf("%s:%s:%s", ha1, nonce, ha2))
				}

				authValue := fmt.Sprintf(
					`Digest username="%s", realm="%s", nonce="%s", uri="/json_rpc", response="%s"`,
					username, realm, nonce, response,
				)
				if strings.Contains(qop, "auth") {
					authValue += fmt.Sprintf(`, qop=auth, nc=%s, cnonce="%s"`, nc, cnonce)
				}

				req2, err := http.NewRequest("POST", daemonURL, bytes.NewBuffer(body))
				if err != nil {
					return &NodeTestResponse{
						Connected: false,
						Error:     "failed to create authenticated request",
					}, nil
				}
				req2.Header.Set("Content-Type", "application/json")
				req2.Header.Set("Authorization", authValue)

				resp2, err := client.Do(req2)
				if err != nil {
					return &NodeTestResponse{
						Connected: false,
						Error:     "failed to send authenticated request",
					}, nil
				}
				defer resp2.Body.Close()

				respBody, _ := io.ReadAll(resp2.Body)
				responseTimeMs := time.Since(startTime).Milliseconds()
				return parseNodeTestResponse(respBody, responseTimeMs)
			}
		}
	}

	// If not a 401, handle the response directly
	if resp1.StatusCode != 401 {
		req, _ := http.NewRequest("POST", daemonURL, bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return &NodeTestResponse{
				Connected: false,
				Error:     "failed to send request",
			}, nil
		}
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		responseTimeMs := time.Since(startTime).Milliseconds()
		return parseNodeTestResponse(respBody, responseTimeMs)
	}

	return &NodeTestResponse{
		Connected: false,
		Error:     "node requires authentication",
	}, nil
}

// parseNodeTestResponse parses the JSON-RPC response from get_info
func parseNodeTestResponse(respBody []byte, responseTimeMs int64) (*NodeTestResponse, error) {
	var rpcResp walletRPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     "failed to decode response",
		}, nil
	}

	if rpcResp.Error != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     rpcResp.Error.Message,
		}, nil
	}

	var result struct {
		Height           int64  `json:"height"`
		Version          string `json:"version"`
		Nettype          string `json:"nettype"`
		OutgoingConnsCnt int    `json:"outgoing_connections_count"`
		IncomingConnsCnt int    `json:"incoming_connections_count"`
	}

	if err := json.Unmarshal(rpcResp.Result, &result); err != nil {
		return &NodeTestResponse{
			Connected: false,
			Error:     "failed to parse daemon response",
		}, nil
	}

	network := "mainnet"
	if result.Nettype == "stagenet" {
		network = "stagenet"
	} else if result.Nettype == "testnet" {
		network = "testnet"
	}

	return &NodeTestResponse{
		Connected:      true,
		Height:         result.Height,
		Version:        result.Version,
		Network:        network,
		ResponseTimeMs: responseTimeMs,
	}, nil
}

// TestNodeConnection tests connectivity to a Monero node
// POST /api/node/test
func TestNodeConnection(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req NodeTestRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		if req.Address == "" {
			respondError(w, http.StatusBadRequest, "address is required")
			return
		}

		result, _ := testDaemonConnection(req.Address, req.Username, req.Password)
		respondSuccess(w, http.StatusOK, result)
	}
}

// ConnectNode saves node settings and updates the in-memory configuration.
// POST /api/node/connect
func ConnectNode(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req NodeConnectRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		if req.Address == "" {
			respondError(w, http.StatusBadRequest, "address is required")
			return
		}

		parts := strings.Split(req.Address, ":")
		if len(parts) != 2 {
			respondError(w, http.StatusBadRequest, "invalid address format, expected host:port")
			return
		}

		host := parts[0]
		port := parts[1]

		// Update the in-memory config
		deps.Cfg.MoneroNodeIP = host
		deps.Cfg.MoneroRPCPort = port
		deps.Cfg.MoneroRPCUser = req.Username
		deps.Cfg.MoneroRPCPass = req.Password

		// Save to the current store's settings DB for display in the UI
		SetSetting(deps.DB, "monero_node_url", req.Address)
		SetSetting(deps.DB, "monero_node_user", req.Username)
		SetSetting(deps.DB, "monero_node_pass", req.Password)
		SetSetting(deps.DB, "monero_node_type", req.Type)

		// Restart wallet-rpc with the new daemon address
		walletRestarted := false
		if deps.WalletMgr != nil {
			daemonAddr := req.Address
			if err := deps.WalletMgr.Restart(daemonAddr, req.Username, req.Password); err != nil {
				respondSuccess(w, http.StatusOK, map[string]interface{}{
					"status":           "partial",
					"message":          "Node settings saved, but wallet-rpc failed to restart",
					"wallet_rpc_error": err.Error(),
				})
				return
			}
			walletRestarted = true
		}

		respondSuccess(w, http.StatusOK, map[string]interface{}{
			"status":           "ok",
			"message":          "Node settings saved successfully",
			"wallet_restarted": walletRestarted,
		})
	}
}
