package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port             string `json:"port"`
	ServerURL        string `json:"server_url"`
	DatabasePath     string `json:"database_path"`
	AppSecret        string `json:"app_secret"`
	UploadDir        string `json:"upload_dir"`
	FiatCurrency     string `json:"fiat_currency"`
	Confirmations    int    `json:"confirmations"`
	BusinessName     string `json:"business_name"`
	TaxRate          float64 `json:"tax_rate"`
	MoneroNodeIP     string `json:"monero_node_ip"`
	MoneroRPCPort    string `json:"monero_rpc_port"`
	MoneroRPCUser    string `json:"monero_rpc_user"`
	MoneroRPCPass    string `json:"monero_rpc_pass"`
	WalletRPCURL     string `json:"wallet_rpc_url"`
	SetupComplete    bool   `json:"setup_complete"`
}

// DataDir returns the path to the macOS Application Support directory for MoneroSuperPay
func DataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		// Fallback to current directory if home is unavailable
		return "./data"
	}
	return filepath.Join(home, "Library", "Application Support", "MoneroSuperPay")
}

// Load attempts to load configuration from a JSON file first, then falls back to environment variables
func Load() *Config {
	// Try to load from JSON file first
	configPath := filepath.Join(DataDir(), "config.json")
	if cfg, err := LoadFromFile(configPath); err == nil {
		return cfg
	}

	// Fall back to environment variables + defaults
	return &Config{
		Port:          getEnv("PORT", "0"),
		ServerURL:     getEnv("SERVER_URL", "http://localhost:3033"),
		DatabasePath:  filepath.Join(DataDir(), "merchant.db"),
		AppSecret:     getEnvSecret("APP_SECRET"),
		UploadDir:     filepath.Join(DataDir(), "uploads"),
		FiatCurrency:  getEnv("FIAT_CURRENCY", "USD"),
		Confirmations: getEnvInt("CONFIRMATIONS", 0),
		BusinessName:  getEnv("BUSINESS_NAME", "Monero SuperPay"),
		TaxRate:       getEnvFloat("TAX_RATE", 0.0),
		MoneroNodeIP:  getEnv("MONERO_NODE_IP", ""),
		MoneroRPCPort: getEnv("MONERO_RPC_PORT", "18081"),
		MoneroRPCUser: getEnv("MONERO_RPC_USER", "monero"),
		MoneroRPCPass: getEnv("MONERO_RPC_PASS", "monero"),
		WalletRPCURL:  getEnv("WALLET_RPC_URL", "http://127.0.0.1:18082/json_rpc"),
		SetupComplete: false,
	}
}

// LoadFromFile reads a JSON config file and returns the parsed Config
func LoadFromFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	return &cfg, nil
}

// SaveToFile writes the Config as JSON to a file
func (c *Config) SaveToFile(path string) error {
	// Ensure the directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
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
