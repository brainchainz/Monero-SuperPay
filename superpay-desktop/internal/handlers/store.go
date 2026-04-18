package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/monero-superpay/superpay-desktop/internal/store"
)

// StoreListResponse represents the response for listing stores
type StoreListResponse struct {
	Stores        []store.StoreManifest `json:"stores"`
	ActiveStoreID string                `json:"active_store_id"`
}

// StoreCreateRequest represents the request body for creating a store
type StoreCreateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// StoreUpdateRequest represents the request body for updating a store
type StoreUpdateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// ListStores returns all stores with the active store indicator
func ListStores(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		stores := deps.StoreMgr.List()
		activeStore := deps.StoreMgr.GetActive()
		activeStoreID := ""
		if activeStore != nil {
			activeStoreID = activeStore.ID
		}

		response := StoreListResponse{
			Stores:        stores,
			ActiveStoreID: activeStoreID,
		}

		respondSuccess(w, http.StatusOK, response)
	}
}

// CreateStore creates a new store
func CreateStore(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		var req StoreCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "store name is required")
			return
		}

		newStore, err := deps.StoreMgr.Create(req.Name, req.Description)
		if err != nil {
			respondError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create store: %v", err))
			return
		}

		respondSuccess(w, http.StatusCreated, newStore)
	}
}

// SwitchStore changes the active store and triggers app-level switching
func SwitchStore(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		storeID := chi.URLParam(r, "id")
		if storeID == "" {
			respondError(w, http.StatusBadRequest, "store id is required")
			return
		}

		// Update the index to mark this store as active
		store, err := deps.StoreMgr.Switch(storeID)
		if err != nil {
			respondError(w, http.StatusNotFound, fmt.Sprintf("failed to switch store: %v", err))
			return
		}

		// Trigger app-level store switch (DB connection, wallet-rpc restart)
		if deps.StoreSwitcher != nil {
			if err := deps.StoreSwitcher.SwitchStore(storeID); err != nil {
				// Revert the index change
				currentActive := deps.StoreMgr.GetActive()
				if currentActive != nil {
					deps.StoreMgr.Switch(currentActive.ID)
				}
				respondError(w, http.StatusInternalServerError, fmt.Sprintf("failed to switch store resources: %v", err))
				return
			}
		}

		respondSuccess(w, http.StatusOK, store)
	}
}

// UpdateStore updates a store's name and description
func UpdateStore(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		storeID := chi.URLParam(r, "id")
		if storeID == "" {
			respondError(w, http.StatusBadRequest, "store id is required")
			return
		}

		var req StoreUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		updatedStore, err := deps.StoreMgr.Update(storeID, req.Name, req.Description)
		if err != nil {
			respondError(w, http.StatusNotFound, fmt.Sprintf("failed to update store: %v", err))
			return
		}

		respondSuccess(w, http.StatusOK, updatedStore)
	}
}

// DeleteStore removes a store. Cannot delete the active store.
func DeleteStore(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		storeID := chi.URLParam(r, "id")
		if storeID == "" {
			respondError(w, http.StatusBadRequest, "store id is required")
			return
		}

		if err := deps.StoreMgr.Delete(storeID); err != nil {
			statusCode := http.StatusInternalServerError
			if err.Error() == "cannot delete active store" {
				statusCode = http.StatusConflict
			} else if err.Error() == "store not found: "+storeID {
				statusCode = http.StatusNotFound
			}

			respondError(w, statusCode, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ExportStore exports a store as a .superpay zip file
func ExportStore(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		storeID := chi.URLParam(r, "id")
		if storeID == "" {
			respondError(w, http.StatusBadRequest, "store id is required")
			return
		}

		// If exporting the active store, ensure product images are in the
		// store's uploads dir (they may still be in the legacy global dir),
		// capture wallet credentials, and flush the WAL so the .db file is complete.
		activeStore := deps.StoreMgr.GetActive()
		if activeStore != nil && activeStore.ID == storeID {
			EnsureProductImagesInStoreDir(deps.DB, deps.Cfg.UploadDir, deps.StoreMgr.GetStoreDir(storeID))

			// Capture wallet credentials so the wallet can be restored on import
			walletConfigured := getSettingFromDB(deps.DB, "wallet_configured")
			if walletConfigured == "true" && deps.Cfg.WalletRPCURL != "" {
				if err := CaptureWalletInfo(deps.Cfg.WalletRPCURL, deps.StoreMgr.GetStoreDir(storeID), deps.DB); err != nil {
					log.Printf("[store-export] Warning: could not capture wallet info: %v", err)
				}
			}

			deps.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
		}

		// Get the base directory for temporary exports
		tempDir := os.TempDir()
		exportDir := filepath.Join(tempDir, "monero-superpay-exports")
		if err := os.MkdirAll(exportDir, 0755); err != nil {
			respondError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create export directory: %v", err))
			return
		}

		// Export the store
		zipPath, err := deps.StoreMgr.Export(storeID, exportDir)
		if err != nil {
			statusCode := http.StatusInternalServerError
			if err.Error() == "store not found: "+storeID {
				statusCode = http.StatusNotFound
			}

			respondError(w, statusCode, fmt.Sprintf("failed to export store: %v", err))
			return
		}

		// Serve the zip file as a download
		filename := filepath.Base(zipPath)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		w.Header().Set("Content-Type", "application/zip")

		file, err := os.Open(zipPath)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to open export file")
			return
		}
		defer file.Close()

		if _, err := io.Copy(w, file); err != nil {
			// Response already started, can't send error JSON
			return
		}
	}
}

// ImportStore imports a .superpay file as a new store
func ImportStore(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.StoreMgr == nil {
			respondError(w, http.StatusInternalServerError, "store manager not initialized")
			return
		}

		// Parse the multipart form
		if err := r.ParseMultipartForm(100 * 1024 * 1024); err != nil { // 100MB limit
			respondError(w, http.StatusBadRequest, "failed to parse form")
			return
		}

		// Get the uploaded file
		file, header, err := r.FormFile("file")
		if err != nil {
			respondError(w, http.StatusBadRequest, "failed to get uploaded file")
			return
		}
		defer file.Close()

		// Save the uploaded file to a temporary location
		tempDir := os.TempDir()
		tempFile := filepath.Join(tempDir, header.Filename)
		dst, err := os.Create(tempFile)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create temp file")
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to save uploaded file")
			return
		}

		// Import the store
		importedStore, err := deps.StoreMgr.Import(tempFile)
		if err != nil {
			os.Remove(tempFile)
			respondError(w, http.StatusInternalServerError, fmt.Sprintf("failed to import store: %v", err))
			return
		}

		// Clean up the temporary file
		os.Remove(tempFile)

		respondJSON(w, http.StatusCreated, importedStore)
	}
}

// WalletInfo holds the wallet credentials needed to recreate a view-only wallet.
// Saved as wallets/wallet-info.json inside the store directory during export.
type WalletInfo struct {
	PrimaryAddress string `json:"primary_address"`
	SecretViewKey  string `json:"secret_view_key"`
	RestoreHeight  int64  `json:"restore_height"`
	Filename       string `json:"filename,omitempty"`
}

// CaptureWalletInfo queries wallet-rpc for the full address and private view key,
// reads the original restore height from the DB, then saves them as
// wallets/wallet-info.json in the store dir so the wallet can be recreated on import.
func CaptureWalletInfo(walletRPCURL string, storeDir string, database *sql.DB) error {
	walletsDir := filepath.Join(storeDir, "wallets")
	os.MkdirAll(walletsDir, 0755)

	// Get primary address
	addrResp, err := callWalletRPC(walletRPCURL, "get_address", map[string]interface{}{"account_index": 0})
	if err != nil {
		return fmt.Errorf("failed to get address: %w", err)
	}
	if addrResp.Error != nil {
		return fmt.Errorf("wallet-rpc error (get_address): %s", addrResp.Error.Message)
	}
	var addrResult struct {
		Address string `json:"address"`
	}
	if err := json.Unmarshal(addrResp.Result, &addrResult); err != nil || addrResult.Address == "" {
		return fmt.Errorf("failed to parse address from wallet-rpc")
	}

	// Get private view key
	keyResp, err := callWalletRPC(walletRPCURL, "query_key", map[string]interface{}{"key_type": "view_key"})
	if err != nil {
		return fmt.Errorf("failed to get view key: %w", err)
	}
	if keyResp.Error != nil {
		return fmt.Errorf("wallet-rpc error (query_key): %s", keyResp.Error.Message)
	}
	var keyResult struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(keyResp.Result, &keyResult); err != nil || keyResult.Key == "" {
		return fmt.Errorf("failed to parse view key from wallet-rpc")
	}

	// Read the original restore height and wallet filename from the DB
	var restoreHeight int64
	var walletFilename string
	if database != nil {
		heightStr := getSettingFromDB(database, "wallet_restore_height")
		if heightStr != "" {
			fmt.Sscanf(heightStr, "%d", &restoreHeight)
		}
		walletFilename = getSettingFromDB(database, "wallet_filename")
	}

	// If restore height wasn't saved (wallets set up before this feature),
	// fall back to current wallet height — not the birthday, but better than 0
	if restoreHeight == 0 {
		heightResp, hErr := callWalletRPC(walletRPCURL, "get_height", nil)
		if hErr == nil && heightResp.Error == nil {
			var heightResult struct {
				Height int64 `json:"height"`
			}
			json.Unmarshal(heightResp.Result, &heightResult)
			restoreHeight = heightResult.Height
			log.Printf("[store-export] wallet_restore_height not in DB, using current height %d as fallback", restoreHeight)
		}
	}

	info := WalletInfo{
		PrimaryAddress: addrResult.Address,
		SecretViewKey:  keyResult.Key,
		RestoreHeight:  restoreHeight,
		Filename:       walletFilename,
	}

	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal wallet info: %w", err)
	}

	infoPath := filepath.Join(walletsDir, "wallet-info.json")
	if err := os.WriteFile(infoPath, data, 0600); err != nil {
		return fmt.Errorf("failed to write wallet-info.json: %w", err)
	}

	log.Printf("[store-export] Captured wallet credentials to wallet-info.json")
	return nil
}

// RestoreWalletFromInfo reads wallets/wallet-info.json from a store directory
// and sets up the wallet in wallet-rpc using generate_from_keys.
// Only acts on freshly imported stores — skips if wallet-info.json doesn't exist,
// and deletes wallet-info.json after a successful restore so it won't fire again.
func RestoreWalletFromInfo(walletRPCURL string, storeDir string, database *sql.DB) error {
	infoPath := filepath.Join(storeDir, "wallets", "wallet-info.json")
	data, err := os.ReadFile(infoPath)
	if err != nil {
		return nil // No wallet-info.json — nothing to restore
	}

	var info WalletInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return fmt.Errorf("failed to parse wallet-info.json: %w", err)
	}

	if info.PrimaryAddress == "" || info.SecretViewKey == "" {
		return fmt.Errorf("wallet-info.json is missing address or view key")
	}

	log.Printf("[store-switch] Found wallet-info.json, restoring wallet...")

	// Close any currently open wallet
	callWalletRPC(walletRPCURL, "close_wallet", nil)

	// Use a unique filename based on the store directory to guarantee a fresh
	// wallet file with the correct restore height. monero-wallet-rpc silently
	// opens an existing file when generate_from_keys is called with a name
	// that already exists (no error returned), so we can never reuse names.
	baseName := info.Filename
	if baseName == "" {
		baseName = "merchant_wallet"
	}
	storeIDShort := filepath.Base(storeDir)
	if len(storeIDShort) > 8 {
		storeIDShort = storeIDShort[:8]
	}
	filename := baseName + "_" + storeIDShort

	log.Printf("[store-switch] Creating wallet %q with restore_height=%d", filename, info.RestoreHeight)

	params := map[string]interface{}{
		"filename":       filename,
		"address":        info.PrimaryAddress,
		"viewkey":        info.SecretViewKey,
		"password":       "",
		"restore_height": info.RestoreHeight,
	}

	resp, err := callWalletRPC(walletRPCURL, "generate_from_keys", params)
	if err != nil {
		return fmt.Errorf("failed to call wallet-rpc: %w", err)
	}

	if resp.Error != nil {
		// If this unique name somehow already exists (same store re-imported),
		// just open it — it was created with the correct restore height previously.
		if resp.Error.Code == -21 || strings.Contains(strings.ToLower(resp.Error.Message), "already exists") {
			log.Printf("[store-switch] Wallet %q already exists, opening it", filename)
			openResp, openErr := callWalletRPC(walletRPCURL, "open_wallet", map[string]interface{}{
				"filename": filename,
				"password": "",
			})
			if openErr != nil || (openResp != nil && openResp.Error != nil) {
				return fmt.Errorf("wallet exists but couldn't open: %v", resp.Error.Message)
			}
		} else {
			return fmt.Errorf("wallet-rpc error: %s", resp.Error.Message)
		}
	}

	// Update settings in DB
	if database != nil {
		maskedAddr := info.PrimaryAddress
		if len(maskedAddr) > 16 {
			maskedAddr = maskedAddr[:8] + "..." + maskedAddr[len(maskedAddr)-8:]
		}
		SetSetting(database, "wallet_configured", "true")
		SetSetting(database, "wallet_address", maskedAddr)
		SetSetting(database, "wallet_filename", filename)
		SetSetting(database, "wallet_restore_height", fmt.Sprintf("%d", info.RestoreHeight))
	}

	// Delete wallet-info.json so this doesn't fire again on subsequent switches
	os.Remove(infoPath)

	log.Printf("[store-switch] Restored wallet from wallet-info.json (restore_height=%d)", info.RestoreHeight)
	return nil
}

// ensureProductImagesInStoreDir copies product images referenced in the DB
// into the store's uploads/ directory if they aren't already there. This
// handles the migration from the legacy global uploads dir so that exports
// include all images.
func EnsureProductImagesInStoreDir(database *sql.DB, currentUploadDir string, storeDir string) {
	storeUploads := filepath.Join(storeDir, "uploads")
	os.MkdirAll(storeUploads, 0755)

	rows, err := database.Query("SELECT image_path FROM products WHERE image_path != '' AND image_path IS NOT NULL")
	if err != nil {
		log.Printf("[store-export] Failed to query product images: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var imagePath string
		if err := rows.Scan(&imagePath); err != nil {
			continue
		}

		// image_path is like "/uploads/uuid.jpg" — extract the filename
		filename := strings.TrimPrefix(imagePath, "/uploads/")
		if filename == "" || filename == imagePath {
			continue
		}

		destPath := filepath.Join(storeUploads, filename)
		if _, err := os.Stat(destPath); err == nil {
			continue // already in store dir
		}

		// Try to find the file in the current upload dir
		srcPath := filepath.Join(currentUploadDir, filename)
		if _, err := os.Stat(srcPath); err != nil {
			// Not in current dir — scan common legacy locations
			// On Umbrel: /data/uploads, on Mac: DataDir/uploads
			legacyDirs := []string{
				filepath.Join(filepath.Dir(filepath.Dir(storeDir)), "uploads"), // baseDir/uploads
			}
			found := false
			for _, dir := range legacyDirs {
				candidate := filepath.Join(dir, filename)
				if _, err := os.Stat(candidate); err == nil {
					srcPath = candidate
					found = true
					break
				}
			}
			if !found {
				log.Printf("[store-export] Image not found for product: %s", filename)
				continue
			}
		}

		// Copy the file into the store's uploads dir
		src, err := os.Open(srcPath)
		if err != nil {
			continue
		}
		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			continue
		}
		io.Copy(dst, src)
		src.Close()
		dst.Close()
		log.Printf("[store-export] Migrated image to store dir: %s", filename)
	}
}
