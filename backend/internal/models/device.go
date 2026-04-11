package models

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Device struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	DeviceType string     `json:"device_type"` // "pos" or "order_monitor"
	PairedAt   time.Time  `json:"paired_at"`
	LastSeen   *time.Time `json:"last_seen"`
	IsActive   bool       `json:"is_active"`
	Config     string     `json:"config"`
	APIKeyHash string     `json:"-"` // Never expose in JSON
}

type PairingToken struct {
	Token      string
	DeviceName string
	DeviceType string
	ExpiresAt  time.Time
	Used       bool
}

// CreatePairingToken generates a one-time pairing token
func CreatePairingToken(db *sql.DB, deviceName string, deviceType string) (string, error) {
	token, err := generateRandomToken(32)
	if err != nil {
		return "", fmt.Errorf("failed to generate pairing token: %w", err)
	}
	expiresAt := time.Now().Add(15 * time.Minute)

	if deviceType == "" {
		deviceType = "pos"
	}

	_, err = db.Exec(
		"INSERT INTO pairing_tokens (token, device_name, device_type, expires_at, used) VALUES (?, ?, ?, ?, ?)",
		token, deviceName, deviceType, expiresAt, false,
	)

	if err != nil {
		return "", fmt.Errorf("failed to create pairing token: %w", err)
	}

	return token, nil
}

// PairDevice uses a pairing token to create a new device
func PairDevice(db *sql.DB, token string) (*Device, string, error) {
	// Verify token exists and is not used/expired
	var pairingToken PairingToken
	err := db.QueryRow(
		"SELECT token, device_name, COALESCE(device_type, 'pos'), expires_at, used FROM pairing_tokens WHERE token = ?",
		token,
	).Scan(&pairingToken.Token, &pairingToken.DeviceName, &pairingToken.DeviceType, &pairingToken.ExpiresAt, &pairingToken.Used)

	if err == sql.ErrNoRows {
		return nil, "", fmt.Errorf("invalid pairing token")
	}
	if err != nil {
		return nil, "", fmt.Errorf("failed to query pairing token: %w", err)
	}

	if pairingToken.Used {
		return nil, "", fmt.Errorf("pairing token already used")
	}

	if time.Now().After(pairingToken.ExpiresAt) {
		return nil, "", fmt.Errorf("pairing token expired")
	}

	// Generate device ID and API key
	deviceID := uuid.New().String()
	apiKey, err := generateRandomToken(32)
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate API key: %w", err)
	}
	apiKeyHash := hashAPIKey(apiKey)

	// Create device
	device := &Device{
		ID:         deviceID,
		Name:       pairingToken.DeviceName,
		DeviceType: pairingToken.DeviceType,
		PairedAt:   time.Now(),
		IsActive:   true,
		Config:     "{}",
		APIKeyHash: apiKeyHash,
	}

	// Insert device
	err = db.QueryRow(
		"INSERT INTO devices (id, name, device_type, api_key_hash, paired_at, is_active, config) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
		device.ID, device.Name, device.DeviceType, device.APIKeyHash, device.PairedAt, device.IsActive, device.Config,
	).Scan(&device.ID)

	if err != nil {
		return nil, "", fmt.Errorf("failed to create device: %w", err)
	}

	// Mark pairing token as used
	_, err = db.Exec("UPDATE pairing_tokens SET used = 1 WHERE token = ?", token)
	if err != nil {
		// Log but don't fail - device is already created
		fmt.Printf("Warning: failed to mark pairing token as used: %v\n", err)
	}

	return device, apiKey, nil
}

// ListDevices returns all devices
func ListDevices(db *sql.DB) ([]Device, error) {
	rows, err := db.Query(
		"SELECT id, name, COALESCE(device_type, 'pos'), paired_at, last_seen, is_active, config FROM devices ORDER BY paired_at DESC",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query devices: %w", err)
	}
	defer rows.Close()

	var devices []Device
	for rows.Next() {
		var device Device
		err := rows.Scan(&device.ID, &device.Name, &device.DeviceType, &device.PairedAt, &device.LastSeen, &device.IsActive, &device.Config)
		if err != nil {
			return nil, fmt.Errorf("failed to scan device: %w", err)
		}
		devices = append(devices, device)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating devices: %w", err)
	}

	return devices, nil
}

// GetDevice retrieves a device by ID
func GetDevice(db *sql.DB, id string) (*Device, error) {
	device := &Device{}
	err := db.QueryRow(
		"SELECT id, name, COALESCE(device_type, 'pos'), paired_at, last_seen, is_active, config FROM devices WHERE id = ?",
		id,
	).Scan(&device.ID, &device.Name, &device.DeviceType, &device.PairedAt, &device.LastSeen, &device.IsActive, &device.Config)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("device not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query device: %w", err)
	}

	return device, nil
}

// UpdateDevice updates a device's information
func UpdateDevice(db *sql.DB, id string, name string, config string) (*Device, error) {
	_, err := db.Exec(
		"UPDATE devices SET name = ?, config = ? WHERE id = ?",
		name, config, id,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update device: %w", err)
	}

	return GetDevice(db, id)
}

// DeleteDevice deletes a device
func DeleteDevice(db *sql.DB, id string) error {
	result, err := db.Exec("DELETE FROM devices WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete device: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("device not found")
	}

	return nil
}

// UpdateHeartbeat updates a device's last_seen timestamp
func UpdateHeartbeat(db *sql.DB, id string) error {
	_, err := db.Exec(
		"UPDATE devices SET last_seen = datetime('now') WHERE id = ?",
		id,
	)
	if err != nil {
		return fmt.Errorf("failed to update heartbeat: %w", err)
	}
	return nil
}

// ValidateAPIKey verifies an API key and returns the associated device
func ValidateAPIKey(db *sql.DB, apiKey string) (*Device, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("empty api key")
	}

	keyHash := hashAPIKey(apiKey)
	device := &Device{}

	err := db.QueryRow(
		"SELECT id, name, COALESCE(device_type, 'pos'), paired_at, last_seen, is_active, config FROM devices WHERE api_key_hash = ? AND is_active = 1",
		keyHash,
	).Scan(&device.ID, &device.Name, &device.DeviceType, &device.PairedAt, &device.LastSeen, &device.IsActive, &device.Config)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("invalid api key")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to validate api key: %w", err)
	}

	return device, nil
}

// Helper functions

func generateRandomToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to read random bytes: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func hashAPIKey(apiKey string) string {
	hash := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(hash[:])
}
