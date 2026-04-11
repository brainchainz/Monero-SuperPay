package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type SettingsResponse struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type UpdateSettingsRequest struct {
	Settings map[string]string `json:"settings"`
}

// GetSettings returns all settings
func GetSettings(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := deps.DB.Query("SELECT key, value FROM settings ORDER BY key ASC")
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to get settings")
			return
		}
		defer rows.Close()

		settingsMap := make(map[string]string)
		for rows.Next() {
			var key, value string
			if err := rows.Scan(&key, &value); err != nil {
				respondError(w, http.StatusInternalServerError, "failed to scan settings")
				return
			}
			settingsMap[key] = value
		}

		respondSuccess(w, http.StatusOK, settingsMap)
	}
}

// UpdateSettings updates multiple settings
func UpdateSettings(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UpdateSettingsRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		tx, err := deps.DB.Begin()
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to begin transaction")
			return
		}
		defer tx.Rollback()

		// Upsert each setting
		for key, value := range req.Settings {
			// Check if setting exists
			var exists int
			err := tx.QueryRow("SELECT COUNT(*) FROM settings WHERE key = ?", key).Scan(&exists)
			if err != nil {
				respondError(w, http.StatusInternalServerError, "failed to check setting")
				return
			}

			if exists > 0 {
				_, err = tx.Exec("UPDATE settings SET value = ? WHERE key = ?", value, key)
			} else {
				_, err = tx.Exec("INSERT INTO settings (key, value) VALUES (?, ?)", key, value)
			}

			if err != nil {
				respondError(w, http.StatusInternalServerError, "failed to update setting")
				return
			}
		}

		if err := tx.Commit(); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to commit transaction")
			return
		}

		// Return updated settings
		rows, err := deps.DB.Query("SELECT key, value FROM settings ORDER BY key ASC")
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to get updated settings")
			return
		}
		defer rows.Close()

		settingsMap := make(map[string]string)
		for rows.Next() {
			var key, value string
			if err := rows.Scan(&key, &value); err != nil {
				respondError(w, http.StatusInternalServerError, "failed to scan settings")
				return
			}
			settingsMap[key] = value
		}

		respondSuccess(w, http.StatusOK, settingsMap)
	}
}

// GetSetting returns a single setting
func GetSetting(db *sql.DB, key string) (string, error) {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetSetting sets a single setting
func SetSetting(db *sql.DB, key string, value string) error {
	// Check if setting exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM settings WHERE key = ?", key).Scan(&exists)
	if err != nil {
		return err
	}

	if exists > 0 {
		_, err = db.Exec("UPDATE settings SET value = ? WHERE key = ?", value, key)
	} else {
		_, err = db.Exec("INSERT INTO settings (key, value) VALUES (?, ?)", key, value)
	}
	return err
}

// GetPosSettings returns only the settings a PoS device needs (no sensitive data)
func GetPosSettings(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allowedKeys := map[string]bool{
			"business_name":          true,
			"fiat_currency":          true,
			"tax_rate":               true,
			"confirmation_threshold": true,
			"show_prices_in_xmr":    true,
			"show_fiat_price":       true,
		}

		rows, err := deps.DB.Query("SELECT key, value FROM settings ORDER BY key ASC")
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to get settings")
			return
		}
		defer rows.Close()

		settingsMap := make(map[string]string)
		for rows.Next() {
			var key, value string
			if err := rows.Scan(&key, &value); err != nil {
				respondError(w, http.StatusInternalServerError, "failed to scan settings")
				return
			}
			if allowedKeys[key] {
				settingsMap[key] = value
			}
		}

		respondSuccess(w, http.StatusOK, settingsMap)
	}
}

// MarshalJSONToString converts a struct to JSON string for storage
func MarshalJSONToString(v interface{}) (string, error) {
	data, err := json.Marshal(v)
	return string(data), err
}

// UnmarshalJSONString converts a JSON string to a struct
func UnmarshalJSONString(data string, v interface{}) error {
	return json.Unmarshal([]byte(data), v)
}
