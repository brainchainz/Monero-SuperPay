package store

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// StoreManifest represents the metadata for a single store
type StoreManifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	NodeAddress string `json:"node_address,omitempty"`
	NodeUser    string `json:"node_user,omitempty"`
	NodePass    string `json:"node_pass,omitempty"`
	NodeType    string `json:"node_type,omitempty"`
}

// StoresIndex tracks all stores and which one is currently active
type StoresIndex struct {
	ActiveStoreID string          `json:"active_store_id"`
	Stores        []StoreManifest `json:"stores"`
}

// StoreManager manages multi-store operations including creation, switching,
// importing, and exporting stores
type StoreManager struct {
	baseDir string       // ~/Library/Application Support/MoneroSuperPay
	index   *StoresIndex // in-memory index of all stores
	mu      sync.RWMutex // protects index
}

// NewStoreManager creates a new StoreManager instance
func NewStoreManager(baseDir string) *StoreManager {
	return &StoreManager{
		baseDir: baseDir,
		index:   &StoresIndex{Stores: []StoreManifest{}},
	}
}

// Init loads or creates the stores.json index. If no stores exist, creates
// a "Default" store and optionally migrates existing merchant.db/uploads/wallets
func (sm *StoreManager) Init() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	storesDir := filepath.Join(sm.baseDir, "stores")
	if err := os.MkdirAll(storesDir, 0755); err != nil {
		return fmt.Errorf("failed to create stores directory: %w", err)
	}

	indexPath := filepath.Join(storesDir, "stores.json")

	// Try to load existing index
	if data, err := os.ReadFile(indexPath); err == nil {
		if err := json.Unmarshal(data, sm.index); err == nil && sm.index.ActiveStoreID != "" && len(sm.index.Stores) > 0 {
			return nil
		}
	}

	// No valid index exists, create default store
	defaultID := uuid.New().String()
	defaultManifest := StoreManifest{
		ID:        defaultID,
		Name:      "Default",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	storeDir := filepath.Join(storesDir, defaultID)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("failed to create default store directory: %w", err)
	}

	// Create subdirectories
	for _, subdir := range []string{"uploads", "wallets"} {
		if err := os.MkdirAll(filepath.Join(storeDir, subdir), 0755); err != nil {
			return fmt.Errorf("failed to create %s subdirectory: %w", subdir, err)
		}
	}

	// Migrate existing merchant.db if it exists in the base directory
	oldDBPath := filepath.Join(sm.baseDir, "merchant.db")
	newDBPath := filepath.Join(storeDir, "merchant.db")
	if _, err := os.Stat(oldDBPath); err == nil {
		if err := copyFile(oldDBPath, newDBPath); err != nil {
			return fmt.Errorf("failed to migrate merchant.db: %w", err)
		}
	}

	// Migrate existing uploads if directory exists
	oldUploadsPath := filepath.Join(sm.baseDir, "uploads")
	newUploadsPath := filepath.Join(storeDir, "uploads")
	if info, err := os.Stat(oldUploadsPath); err == nil && info.IsDir() {
		if err := copyDir(oldUploadsPath, newUploadsPath); err != nil {
			return fmt.Errorf("failed to migrate uploads: %w", err)
		}
	}

	// Migrate existing wallets if directory exists
	oldWalletsPath := filepath.Join(sm.baseDir, "wallets")
	newWalletsPath := filepath.Join(storeDir, "wallets")
	if info, err := os.Stat(oldWalletsPath); err == nil && info.IsDir() {
		if err := copyDir(oldWalletsPath, newWalletsPath); err != nil {
			return fmt.Errorf("failed to migrate wallets: %w", err)
		}
	}

	// Save the store manifest
	if err := sm.saveManifestLocked(defaultID, &defaultManifest); err != nil {
		return fmt.Errorf("failed to save store manifest: %w", err)
	}

	// Update index
	sm.index.ActiveStoreID = defaultID
	sm.index.Stores = []StoreManifest{defaultManifest}

	// Persist the index
	if err := sm.saveIndexLocked(); err != nil {
		return fmt.Errorf("failed to save stores index: %w", err)
	}

	return nil
}

// List returns all stores in the index
func (sm *StoreManager) List() []StoreManifest {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	stores := make([]StoreManifest, len(sm.index.Stores))
	copy(stores, sm.index.Stores)
	return stores
}

// GetActive returns the currently active store manifest
func (sm *StoreManager) GetActive() *StoreManifest {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if sm.index.ActiveStoreID == "" {
		return nil
	}

	for _, store := range sm.index.Stores {
		if store.ID == sm.index.ActiveStoreID {
			return &store
		}
	}
	return nil
}

// Create creates a new store with the given name and description
func (sm *StoreManager) Create(name, description string) (*StoreManifest, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if len(name) > 255 {
		return nil, fmt.Errorf("store name must not exceed 255 characters")
	}

	if len(description) > 5000 {
		return nil, fmt.Errorf("store description must not exceed 5000 characters")
	}

	storeID := uuid.New().String()
	manifest := StoreManifest{
		ID:          storeID,
		Name:        name,
		Description: description,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	storeDir := filepath.Join(sm.baseDir, "stores", storeID)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create store directory: %w", err)
	}

	// Create subdirectories
	for _, subdir := range []string{"uploads", "wallets"} {
		if err := os.MkdirAll(filepath.Join(storeDir, subdir), 0755); err != nil {
			return nil, fmt.Errorf("failed to create %s subdirectory: %w", subdir, err)
		}
	}

	// Save the manifest within the store
	if err := sm.saveManifestLocked(storeID, &manifest); err != nil {
		return nil, fmt.Errorf("failed to save store manifest: %w", err)
	}

	// Add to index
	sm.index.Stores = append(sm.index.Stores, manifest)

	// Persist the index
	if err := sm.saveIndexLocked(); err != nil {
		return nil, fmt.Errorf("failed to save stores index: %w", err)
	}

	return &manifest, nil
}

// Switch changes the active store by ID and updates the index
func (sm *StoreManager) Switch(storeID string) (*StoreManifest, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Find the store
	var store *StoreManifest
	for i := range sm.index.Stores {
		if sm.index.Stores[i].ID == storeID {
			store = &sm.index.Stores[i]
			break
		}
	}

	if store == nil {
		return nil, fmt.Errorf("store not found: %s", storeID)
	}

	sm.index.ActiveStoreID = storeID

	if err := sm.saveIndexLocked(); err != nil {
		return nil, fmt.Errorf("failed to save stores index: %w", err)
	}

	return store, nil
}

// Delete removes a store by ID. Cannot delete the active store.
func (sm *StoreManager) Delete(storeID string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.index.ActiveStoreID == storeID {
		return fmt.Errorf("cannot delete active store")
	}

	// Find and remove the store from the index
	idx := -1
	for i, store := range sm.index.Stores {
		if store.ID == storeID {
			idx = i
			break
		}
	}

	if idx < 0 {
		return fmt.Errorf("store not found: %s", storeID)
	}

	sm.index.Stores = append(sm.index.Stores[:idx], sm.index.Stores[idx+1:]...)

	// Delete the store directory
	storeDir := filepath.Join(sm.baseDir, "stores", storeID)
	if err := os.RemoveAll(storeDir); err != nil {
		return fmt.Errorf("failed to delete store directory: %w", err)
	}

	// Persist the index
	if err := sm.saveIndexLocked(); err != nil {
		return fmt.Errorf("failed to save stores index: %w", err)
	}

	return nil
}

// Update updates the name and description of a store
func (sm *StoreManager) Update(storeID string, name, description string) (*StoreManifest, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if len(name) > 255 {
		return nil, fmt.Errorf("store name must not exceed 255 characters")
	}

	if len(description) > 5000 {
		return nil, fmt.Errorf("store description must not exceed 5000 characters")
	}

	// Find and update the store in the index
	found := false
	for i := range sm.index.Stores {
		if sm.index.Stores[i].ID == storeID {
			sm.index.Stores[i].Name = name
			sm.index.Stores[i].Description = description
			sm.index.Stores[i].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			found = true

			// Save the updated manifest within the store
			if err := sm.saveManifestLocked(storeID, &sm.index.Stores[i]); err != nil {
				return nil, fmt.Errorf("failed to save store manifest: %w", err)
			}

			break
		}
	}

	if !found {
		return nil, fmt.Errorf("store not found: %s", storeID)
	}

	// Persist the index
	if err := sm.saveIndexLocked(); err != nil {
		return nil, fmt.Errorf("failed to save stores index: %w", err)
	}

	store := sm.index.Stores[0]
	for _, s := range sm.index.Stores {
		if s.ID == storeID {
			store = s
			break
		}
	}

	return &store, nil
}

// Export creates a .superpay zip file from the store directory
func (sm *StoreManager) Export(storeID string, destPath string) (string, error) {
	sm.mu.RLock()

	// Verify store exists
	found := false
	for _, store := range sm.index.Stores {
		if store.ID == storeID {
			found = true
			break
		}
	}
	sm.mu.RUnlock()

	if !found {
		return "", fmt.Errorf("store not found: %s", storeID)
	}

	storeDir := filepath.Join(sm.baseDir, "stores", storeID)
	outputPath := filepath.Join(destPath, storeID+".superpay")

	// Ensure output directory exists
	if err := os.MkdirAll(destPath, 0755); err != nil {
		return "", fmt.Errorf("failed to create export directory: %w", err)
	}

	// Create the zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		return "", fmt.Errorf("failed to create zip file: %w", err)
	}
	defer zipFile.Close()

	writer := zip.NewWriter(zipFile)
	defer writer.Close()

	// Walk the store directory and add all files to the zip
	if err := filepath.Walk(storeDir, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		// Get relative path from store directory
		relPath, err := filepath.Rel(storeDir, filePath)
		if err != nil {
			return err
		}

		// Add file to zip
		file, err := os.Open(filePath)
		if err != nil {
			return err
		}
		defer file.Close()

		header := &zip.FileHeader{
			Name: relPath,
		}
		header.SetMode(info.Mode())

		w, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}

		_, err = io.Copy(w, file)
		return err
	}); err != nil {
		os.Remove(outputPath)
		return "", fmt.Errorf("failed to add files to zip: %w", err)
	}

	return outputPath, nil
}

// Import imports a .superpay zip file as a new store
func (sm *StoreManager) Import(zipPath string) (*StoreManifest, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Verify the zip file exists
	if _, err := os.Stat(zipPath); err != nil {
		return nil, fmt.Errorf("zip file not found: %w", err)
	}

	// Generate a new store ID
	newStoreID := uuid.New().String()
	storeDir := filepath.Join(sm.baseDir, "stores", newStoreID)

	// Create the store directory
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create store directory: %w", err)
	}

	// Open the zip file
	zipReader, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open zip file: %w", err)
	}
	defer zipReader.Close()

	// Extract all files from the zip
	for _, file := range zipReader.File {
		targetPath := filepath.Join(storeDir, file.Name)

		// Validate path doesn't escape the store directory
		absTargetPath, err := filepath.Abs(targetPath)
		if err != nil {
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("failed to resolve path: %w", err)
		}

		absStoreDir, err := filepath.Abs(storeDir)
		if err != nil {
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("failed to resolve store directory: %w", err)
		}

		// Check if the extracted file path is within the store directory
		if !filepath.HasPrefix(absTargetPath, absStoreDir) {
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("path traversal detected in zip file: %s", file.Name)
		}

		// Create directories as needed
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, 0755); err != nil {
				os.RemoveAll(storeDir)
				return nil, fmt.Errorf("failed to create directory: %w", err)
			}
			continue
		}

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("failed to create directory: %w", err)
		}

		// Open the file in the zip
		rc, err := file.Open()
		if err != nil {
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("failed to open file in zip: %w", err)
		}

		// Create the target file
		targetFile, err := os.Create(targetPath)
		if err != nil {
			rc.Close()
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("failed to create target file: %w", err)
		}

		// Copy file contents
		if _, err := io.Copy(targetFile, rc); err != nil {
			rc.Close()
			targetFile.Close()
			os.RemoveAll(storeDir)
			return nil, fmt.Errorf("failed to copy file: %w", err)
		}

		rc.Close()
		targetFile.Close()
	}

	// Read the store.json manifest to get the original store info
	manifestPath := filepath.Join(storeDir, "store.json")
	var manifest StoreManifest

	if data, err := os.ReadFile(manifestPath); err == nil {
		if err := json.Unmarshal(data, &manifest); err == nil {
			// Update the ID to the new one
			manifest.ID = newStoreID
			manifest.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		} else {
			// Couldn't parse, create default manifest
			manifest = StoreManifest{
				ID:        newStoreID,
				Name:      "Imported Store",
				CreatedAt: manifest.CreatedAt,
				UpdatedAt: time.Now().UTC().Format(time.RFC3339),
			}
		}
	} else {
		// No store.json, create default manifest
		manifest = StoreManifest{
			ID:        newStoreID,
			Name:      "Imported Store",
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		}
	}

	// Save the updated manifest
	if err := sm.saveManifestLocked(newStoreID, &manifest); err != nil {
		os.RemoveAll(storeDir)
		return nil, fmt.Errorf("failed to save store manifest: %w", err)
	}

	// Add to index
	sm.index.Stores = append(sm.index.Stores, manifest)

	// Persist the index
	if err := sm.saveIndexLocked(); err != nil {
		os.RemoveAll(storeDir)
		return nil, fmt.Errorf("failed to save stores index: %w", err)
	}

	return &manifest, nil
}

// GetStoreDir returns the directory path for a given store ID
func (sm *StoreManager) GetStoreDir(storeID string) string {
	return filepath.Join(sm.baseDir, "stores", storeID)
}

// GetActiveDBPath returns the path to the active store's merchant.db
func (sm *StoreManager) GetActiveDBPath() string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if sm.index.ActiveStoreID == "" {
		return ""
	}

	return filepath.Join(sm.baseDir, "stores", sm.index.ActiveStoreID, "merchant.db")
}

// GetActiveUploadDir returns the path to the active store's uploads directory
func (sm *StoreManager) GetActiveUploadDir() string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if sm.index.ActiveStoreID == "" {
		return ""
	}

	return filepath.Join(sm.baseDir, "stores", sm.index.ActiveStoreID, "uploads")
}

// SaveIndex persists the stores index to stores.json
func (sm *StoreManager) SaveIndex() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	return sm.saveIndexLocked()
}

// SaveManifest persists a store's manifest to store.json within its directory
func (sm *StoreManager) SaveManifest(storeID string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for _, store := range sm.index.Stores {
		if store.ID == storeID {
			return sm.saveManifestLocked(storeID, &store)
		}
	}

	return fmt.Errorf("store not found: %s", storeID)
}

// saveIndexLocked persists the index to stores.json (must be called with lock held)
func (sm *StoreManager) saveIndexLocked() error {
	storesDir := filepath.Join(sm.baseDir, "stores")
	if err := os.MkdirAll(storesDir, 0755); err != nil {
		return fmt.Errorf("failed to create stores directory: %w", err)
	}

	indexPath := filepath.Join(storesDir, "stores.json")
	data, err := json.MarshalIndent(sm.index, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal index: %w", err)
	}

	if err := os.WriteFile(indexPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write stores index: %w", err)
	}

	return nil
}

// saveManifestLocked persists a store's manifest to store.json (must be called with lock held)
func (sm *StoreManager) saveManifestLocked(storeID string, manifest *StoreManifest) error {
	storeDir := filepath.Join(sm.baseDir, "stores", storeID)
	manifestPath := filepath.Join(storeDir, "store.json")

	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal manifest: %w", err)
	}

	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write store manifest: %w", err)
	}

	return nil
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}

// copyDir recursively copies a directory from src to dst
func copyDir(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}
