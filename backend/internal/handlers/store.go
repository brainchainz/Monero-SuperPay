package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/monero-superpay/monero-superpay/internal/store"
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
