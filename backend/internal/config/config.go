package config

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Path to Umbrel's Monero app .env (mounted read-only in docker-compose)
const umbrelMoneroEnvPath = "/home/umbrel/umbrel/app-data/monero/.env"

type Config struct {
	Port          string
	ServerURL     string
	DatabasePath  string
	AppSecret     string
	UploadDir     string
	FiatCurrency  string
	Confirmations int
	BusinessName  string
	TaxRate       float64

	// Monero node connection (for health/status display)
	MoneroNodeIP  string
	MoneroRPCPort string
	MoneroRPCUser string
	MoneroRPCPass string
	WalletRPCURL  string

	// Auto-detection paths (Umbrel)
	TorHostnameFile string // Path to Tor hidden service hostname file
}

func Load() *Config {
	// Try to load Monero RPC credentials directly from Umbrel's Monero app .env
	// This is a runtime fallback in case exports.sh didn't extract them properly
	loadUmbrelMoneroCredentials()

	return &Config{
		Port:          getEnv("PORT", "3033"),
		ServerURL:     getEnv("SERVER_URL", "http://localhost:3033"),
		DatabasePath:  getEnv("DATABASE_PATH", "./data/merchant.db"),
		AppSecret:     getEnvSecret("APP_SECRET"),
		UploadDir:     getEnv("UPLOAD_DIR", "./data/uploads"),
		FiatCurrency:  getEnv("FIAT_CURRENCY", "USD"),
		Confirmations: getEnvInt("CONFIRMATIONS", 0),
		BusinessName:  getEnv("BUSINESS_NAME", "Monero SuperPay"),
		TaxRate:       getEnvFloat("TAX_RATE", 0.0),
		MoneroNodeIP:  getEnv("MONERO_NODE_IP", "monero_monerod_1"),
		MoneroRPCPort: getEnv("MONERO_RPC_PORT", "18081"),
		MoneroRPCUser: getEnv("MONERO_RPC_USER", "monero"),
		MoneroRPCPass: getEnv("MONERO_RPC_PASS", "monero"),
		WalletRPCURL:  getEnv("WALLET_RPC_URL", "http://monero-wallet-rpc:18082/json_rpc"),

		TorHostnameFile: getEnv("TOR_HOSTNAME_FILE", "/tor/hostname"),
	}
}

// loadUmbrelMoneroCredentials reads Umbrel's Monero app .env file and sets
// MONERO_RPC_USER and MONERO_RPC_PASS if they are still at the default "monero" value.
// This mirrors what SuperBrain's server.js does at startup — a runtime fallback
// so the app can discover credentials even if exports.sh failed.
func loadUmbrelMoneroCredentials() {
	// Only override if credentials are still the default fallback
	currentUser := os.Getenv("MONERO_RPC_USER")
	currentPass := os.Getenv("MONERO_RPC_PASS")
	if currentUser != "" && currentUser != "monero" && currentPass != "" && currentPass != "monero" {
		// Already have real credentials from exports.sh, skip
		return
	}

	file, err := os.Open(umbrelMoneroEnvPath)
	if err != nil {
		// File not found — not running on Umbrel, or Monero app not installed
		return
	}
	defer file.Close()

	fmt.Printf("[config] Reading Monero credentials from %s\n", umbrelMoneroEnvPath)

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip comments and empty lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Strip 'export ' prefix if present
		line = strings.TrimPrefix(line, "export ")

		// Parse KEY=VALUE
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		// Strip surrounding quotes
		value = strings.Trim(value, "\"'")

		switch key {
		case "APP_MONERO_RPC_USER":
			if value != "" {
				os.Setenv("MONERO_RPC_USER", value)
				fmt.Printf("[config] Loaded MONERO_RPC_USER from Umbrel Monero app\n")
			}
		case "APP_MONERO_RPC_PASS":
			if value != "" {
				os.Setenv("MONERO_RPC_PASS", value)
				fmt.Printf("[config] Loaded MONERO_RPC_PASS from Umbrel Monero app\n")
			}
		}
	}
}

func getEnv(key, defaultValue string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value, ok := os.LookupEnv(key); ok {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvFloat(key string, defaultValue float64) float64 {
	if value, ok := os.LookupEnv(key); ok {
		if floatVal, err := strconv.ParseFloat(value, 64); err == nil {
			return floatVal
		}
	}
	return defaultValue
}

func getEnvSecret(key string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	// Generate a random secret if not provided
	secret := make([]byte, 32)
	rand.Read(secret)
	return hex.EncodeToString(secret)
}
