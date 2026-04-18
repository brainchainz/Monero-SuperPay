package main

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/monero-superpay/superpay-desktop/internal/config"
	"github.com/monero-superpay/superpay-desktop/internal/db"
	"github.com/monero-superpay/superpay-desktop/internal/handlers"
	"github.com/monero-superpay/superpay-desktop/internal/payments"
	"github.com/monero-superpay/superpay-desktop/internal/store"
	"github.com/monero-superpay/superpay-desktop/internal/ws"
)

// App is the main Wails application struct. It holds all dependencies and
// exposes methods to the frontend via Wails bindings.
type App struct {
	ctx        context.Context
	server     *http.Server
	walletMgr  *WalletManager
	cfg        *config.Config
	db         *sql.DB
	wsHub      *ws.Hub
	paymentMon *payments.PaymentMonitor
	storeMgr   *store.StoreManager
	serverPort int
	deps       *handlers.Dependencies // shared handler deps — updated on store switch
}

// NewApp creates a new App instance
func NewApp() *App {
	return &App{}
}

// startup is called when the Wails app starts. It initializes the database,
// starts the internal HTTP server, WebSocket hub, wallet manager, and payment monitor.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Ensure data directory exists
	dataDir := config.DataDir()
	os.MkdirAll(dataDir, 0755)

	// Initialize store manager
	a.storeMgr = store.NewStoreManager(dataDir)
	if err := a.storeMgr.Init(); err != nil {
		log.Printf("[app] Failed to initialize store manager: %v", err)
		return
	}

	// Load configuration
	a.cfg = config.Load()

	// Get the active store's database path
	dbPath := a.storeMgr.GetActiveDBPath()
	if dbPath == "" {
		log.Printf("[app] No active store configured")
		return
	}

	// Point uploads at the active store's directory (not the global one)
	activeUploadsDir := a.storeMgr.GetActiveUploadDir()
	if activeUploadsDir != "" {
		a.cfg.UploadDir = activeUploadsDir
	}

	// Initialize database with the active store's path
	database, err := db.Init(dbPath)
	if err != nil {
		log.Printf("[app] Failed to initialize database: %v", err)
		return
	}
	a.db = database

	// Sync global node config into this store's settings DB so the frontend can display it
	a.syncNodeSettingsToDB()

	// Initialize WebSocket hub
	a.wsHub = ws.NewHub()
	go a.wsHub.Run()

	// Auto-detect network settings (Tailscale, LAN IP)
	handlers.AutoDetectNetworkSettings(a.cfg, a.db)

	// Initialize wallet manager
	a.walletMgr = NewWalletManager(config.DataDir())

	// Start wallet-rpc if Monero node is configured
	if a.cfg.MoneroNodeIP != "" {
		daemonAddr := a.cfg.MoneroNodeIP + ":" + a.cfg.MoneroRPCPort
		err := a.walletMgr.Start(daemonAddr, a.cfg.MoneroRPCUser, a.cfg.MoneroRPCPass)
		if err != nil {
			log.Printf("[app] Could not start wallet-rpc: %v (app will still work, configure node in settings)", err)
		}
	} else {
		log.Println("[app] No Monero node configured — skipping wallet-rpc start")
	}

	// Only start wallet/payment systems if a node is actually configured
	if a.cfg.MoneroNodeIP != "" {
		// Auto-open wallet if previously configured
		go payments.AutoOpenWallet(a.cfg, a.db)

		// Start payment monitor
		a.paymentMon = payments.NewPaymentMonitor(a.cfg, a.db, a.wsHub)
		a.paymentMon.Start()
	} else {
		log.Println("[app] Skipping payment monitor — no Monero node configured")
	}

	// Start internal HTTP server on a random port, accessible from the local network
	// (0.0.0.0 so PoS devices on the same WiFi / Tailscale can connect)
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		log.Printf("[app] Failed to create listener: %v", err)
		return
	}

	addr := listener.Addr().(*net.TCPAddr)
	a.serverPort = addr.Port
	log.Printf("[app] Internal HTTP server starting on port %d", a.serverPort)

	router := a.setupRouter()
	a.server = &http.Server{
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := a.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("[app] HTTP server error: %v", err)
		}
	}()

	log.Printf("[app] Monero SuperPay started (API on http://127.0.0.1:%d)", a.serverPort)
}

// domReady is called when the frontend DOM is ready
func (a *App) domReady(ctx context.Context) {
	// No-op for now — could redirect to /setup if !SetupComplete
}

// shutdown is called when the Wails app is closing
func (a *App) shutdown(ctx context.Context) {
	log.Println("[app] Shutting down...")

	if a.paymentMon != nil {
		a.paymentMon.Stop()
	}

	if a.server != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		a.server.Shutdown(shutdownCtx)
	}

	if a.walletMgr != nil {
		a.walletMgr.Stop()
	}

	if a.db != nil {
		a.db.Close()
	}

	log.Println("[app] Shutdown complete")
}

// GetServerPort returns the port the internal HTTP server is listening on.
// Exposed to frontend via Wails bindings.
func (a *App) GetServerPort() int {
	return a.serverPort
}

// GetServerURL returns the full URL of the internal HTTP server.
// Exposed to frontend via Wails bindings.
func (a *App) GetServerURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", a.serverPort)
}

// SwitchStore implements the StoreSwitcher interface. It handles switching the active store
// by closing the current database, opening the new store's database, and restarting wallet-rpc
// with the new store's node configuration if applicable.
func (a *App) SwitchStore(storeID string) error {
	if a.storeMgr == nil {
		return fmt.Errorf("store manager not initialized")
	}

	// Get the target store
	stores := a.storeMgr.List()
	var targetStore *store.StoreManifest
	for i := range stores {
		if stores[i].ID == storeID {
			targetStore = &stores[i]
			break
		}
	}

	if targetStore == nil {
		return fmt.Errorf("store not found: %s", storeID)
	}

	// Close the current database
	if a.db != nil {
		if err := a.db.Close(); err != nil {
			log.Printf("[app] Warning: failed to close current database: %v", err)
		}
	}

	// Open the new store's database
	newDBPath := a.storeMgr.GetStoreDir(storeID)
	newDBPath = filepath.Join(newDBPath, "merchant.db")
	newDB, err := db.Init(newDBPath)
	if err != nil {
		return fmt.Errorf("failed to initialize new store database: %w", err)
	}
	a.db = newDB

	// Update the shared handler dependencies so all API handlers use the new DB
	if a.deps != nil {
		a.deps.DB = newDB
	}

	// Update uploads directory to point to the new store
	newUploadsDir := filepath.Join(a.storeMgr.GetStoreDir(storeID), "uploads")
	os.MkdirAll(newUploadsDir, 0755)
	a.cfg.UploadDir = newUploadsDir

	// Sync global node config into the new store's settings DB for the UI
	a.syncNodeSettingsToDB()

	// Stop the old payment monitor (it holds the old DB) and start a new one
	if a.paymentMon != nil {
		a.paymentMon.Stop()
		a.paymentMon = nil
	}

	// Restart wallet-rpc with the new store's node configuration
	if a.walletMgr != nil && targetStore.NodeAddress != "" {
		daemonAddr := targetStore.NodeAddress
		if err := a.walletMgr.Start(daemonAddr, targetStore.NodeUser, targetStore.NodePass); err != nil {
			log.Printf("[app] Warning: failed to restart wallet-rpc with new store config: %v", err)
		}
	}

	// If the new store has wallet-info.json (from an imported store), restore the wallet
	storeDir := a.storeMgr.GetStoreDir(storeID)
	if a.cfg.WalletRPCURL != "" {
		if err := handlers.RestoreWalletFromInfo(a.cfg.WalletRPCURL, storeDir, newDB); err != nil {
			log.Printf("[app] Warning: failed to restore wallet from store: %v", err)
		}
	}

	// Re-open wallet and restart payment monitor for the new store
	if a.cfg.MoneroNodeIP != "" {
		go payments.AutoOpenWallet(a.cfg, newDB)
		a.paymentMon = payments.NewPaymentMonitor(a.cfg, newDB, a.wsHub)
		a.paymentMon.Start()
	}

	log.Printf("[app] Successfully switched to store: %s (%s)", storeID, targetStore.Name)
	return nil
}

// ExportStoreToFile opens a native Save dialog and exports the store as a .superpay file.
// This is called from the frontend because Wails WebKit doesn't support blob downloads.
func (a *App) ExportStoreToFile(storeID string, storeName string) (string, error) {
	if a.storeMgr == nil {
		return "", fmt.Errorf("store manager not initialized")
	}

	// Open native Save dialog
	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		DefaultFilename: storeName + ".superpay",
		Title:           "Export Store",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "SuperPay Store", Pattern: "*.superpay"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("save dialog error: %w", err)
	}
	if savePath == "" {
		return "", nil // User cancelled
	}

	// Ensure product images are in the store's uploads dir before exporting
	// (they may still be in the legacy global uploads dir)
	activeStore := a.storeMgr.GetActive()
	if activeStore != nil && activeStore.ID == storeID && a.db != nil {
		handlers.EnsureProductImagesInStoreDir(a.db, a.cfg.UploadDir, a.storeMgr.GetStoreDir(storeID))

		// Capture wallet credentials so the wallet can be restored on import
		walletConfigured := handlers.GetSettingFromDB(a.db, "wallet_configured")
		if walletConfigured == "true" && a.cfg.WalletRPCURL != "" {
			if err := handlers.CaptureWalletInfo(a.cfg.WalletRPCURL, a.storeMgr.GetStoreDir(storeID), a.db); err != nil {
				log.Printf("[app-export] Warning: could not capture wallet info: %v", err)
			}
		}

		a.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	}

	// storeMgr.Export expects a directory and creates storeID.superpay inside it.
	// The save dialog gives us a full file path, so use its parent directory
	// and rename the output to match what the user chose.
	destDir := filepath.Dir(savePath)
	exportedPath, err := a.storeMgr.Export(storeID, destDir)
	if err != nil {
		return "", fmt.Errorf("export failed: %w", err)
	}

	// Rename from storeID.superpay to the user's chosen filename
	if exportedPath != savePath {
		if err := os.Rename(exportedPath, savePath); err != nil {
			// If rename fails, the file still exists at exportedPath
			return exportedPath, nil
		}
	}

	return savePath, nil
}

// syncNodeSettingsToDB writes the global node config (from config.json) into the
// active store's settings DB so the Settings UI can read and display it.
func (a *App) syncNodeSettingsToDB() {
	if a.db == nil || a.cfg == nil {
		return
	}
	nodeURL := ""
	if a.cfg.MoneroNodeIP != "" {
		nodeURL = a.cfg.MoneroNodeIP + ":" + a.cfg.MoneroRPCPort
	}
	handlers.SetSetting(a.db, "monero_node_url", nodeURL)
	handlers.SetSetting(a.db, "monero_node_user", a.cfg.MoneroRPCUser)
	handlers.SetSetting(a.db, "monero_node_pass", a.cfg.MoneroRPCPass)
}

// setupRouter creates the chi router with all API routes.
// This mirrors the original Umbrel server's route structure but simplified
// for localhost-only access (no Umbrel auth proxy needed).
func (a *App) setupRouter() *chi.Mux {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	// Limit request body size to 50 MB to prevent memory exhaustion attacks
	r.Use(limitRequestBody(50 * 1024 * 1024))

	// CORS — permissive for localhost (Wails webview connects from wails:// or localhost)
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			return true // Localhost-only server, all origins allowed
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-API-Key"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Handler dependencies — same pattern as the original Umbrel app
	// Stored on the App struct so SwitchStore can update the DB pointer.
	a.deps = &handlers.Dependencies{
		DB:            a.db,
		Cfg:           a.cfg,
		WSHub:         a.wsHub,
		WalletMgr:     a.walletMgr,
		StoreMgr:      a.storeMgr,
		StoreSwitcher: a,
		ActualPort:    a.serverPort,
	}
	handlerDeps := a.deps

	// API Routes — exact same structure as the Umbrel version
	r.Route("/api", func(r chi.Router) {
		// --- Store management endpoints ---
		r.Get("/stores", handlers.ListStores(handlerDeps))
		r.Post("/stores", handlers.CreateStore(handlerDeps))
		r.Post("/stores/{id}/switch", handlers.SwitchStore(handlerDeps))
		r.Put("/stores/{id}", handlers.UpdateStore(handlerDeps))
		r.Delete("/stores/{id}", handlers.DeleteStore(handlerDeps))
		r.Get("/stores/{id}/export", handlers.ExportStore(handlerDeps))
		r.Post("/stores/import", handlers.ImportStore(handlerDeps))

		// --- Public endpoints (no auth) ---
		// Pairing endpoints with rate limiting (create + pair only; status poll is read-only)
		r.With(handlers.RateLimitPairing).Post("/devices/pairing-token", handlers.CreatePairingToken(handlerDeps))
		r.With(handlers.RateLimitPairing).Post("/devices/pair", handlers.PairDevice(handlerDeps))
		r.Get("/devices/pairing-token/{token}", handlers.GetPairingTokenStatus(handlerDeps))

		// --- Dashboard endpoints (no auth needed on local Mac app) ---
		// Devices
		r.Get("/devices", handlers.ListDevices(handlerDeps))
		r.Get("/devices/{id}", handlers.GetDevice(handlerDeps))
		r.Put("/devices/{id}", handlers.UpdateDevice(handlerDeps))
		r.Delete("/devices/{id}", handlers.DeleteDevice(handlerDeps))

		// Products
		r.Get("/products", handlers.ListProducts(handlerDeps))
		r.Get("/products/{id}", handlers.GetProduct(handlerDeps))
		r.Post("/products", handlers.CreateProduct(handlerDeps))
		r.Put("/products/{id}", handlers.UpdateProduct(handlerDeps))
		r.Delete("/products/{id}", handlers.DeleteProduct(handlerDeps))
		r.Post("/products/{id}/image", handlers.UploadProductImage(handlerDeps))

		// Categories
		r.Get("/categories", handlers.ListCategories(handlerDeps))
		r.Post("/categories", handlers.CreateCategory(handlerDeps))
		r.Put("/categories/{id}", handlers.UpdateCategory(handlerDeps))
		r.Delete("/categories/{id}", handlers.DeleteCategory(handlerDeps))

		// Orders & Analytics
		r.Get("/orders", handlers.ListOrders(handlerDeps))
		r.Get("/orders/export/csv", handlers.ExportOrdersCSV(handlerDeps))
		r.Get("/orders/stats", handlers.GetOrderStats(handlerDeps))
		r.Get("/orders/{id}", handlers.GetOrder(handlerDeps))
		r.Post("/orders", handlers.CreateOrder(handlerDeps))
		r.Post("/orders/{id}/cancel", handlers.UpdateOrderStatus(handlerDeps))
		r.Get("/orders/{id}/receipt", handlers.OrderReceipt(handlerDeps))
		r.Post("/orders/{id}/print", handlers.PrintOrderReceipt(handlerDeps))
		r.Post("/orders/{id}/deliver", handlers.MarkOrderDelivered(handlerDeps))
		r.Get("/orders/{id}/status", handlers.GetOrder(handlerDeps))

		// Stats + Rate
		r.Get("/stats/dashboard", handlers.GetDashboardStats(handlerDeps))
		r.Get("/rate", handlers.GetRate(handlerDeps))
		r.Get("/rate/{currency}", handlers.GetRate(handlerDeps))

		// Settings
		r.Get("/settings", handlers.GetSettings(handlerDeps))
		r.Put("/settings", handlers.UpdateSettings(handlerDeps))

		// Wallet setup
		r.Get("/wallet/status", handlers.GetWalletStatus(handlerDeps))
		r.Post("/wallet/setup", handlers.SetupWallet(handlerDeps))
		r.Get("/wallet/list", handlers.ListWallets(handlerDeps))
		r.Post("/wallet/delete", handlers.DeleteWallet(handlerDeps))
		r.Post("/wallet/delete-file", handlers.DeleteWalletFile(handlerDeps))

		// Node connection management (Mac app only)
		r.Post("/node/test", handlers.TestNodeConnection(handlerDeps))
		r.Post("/node/connect", handlers.ConnectNode(handlerDeps))

		// WebSocket (real-time order + payment updates)
		r.Get("/ws", handlers.WebSocketHandler(handlerDeps))

		// --- Device-authenticated endpoints (PoS devices use X-API-Key) ---
		r.Group(func(r chi.Router) {
			r.Use(handlers.APIKeyAuth(handlerDeps))
			r.Post("/devices/{id}/heartbeat", handlers.UpdateHeartbeat(handlerDeps))

			// PoS device endpoints
			r.Get("/pos/products", handlers.ListProducts(handlerDeps))
			r.Get("/pos/categories", handlers.ListCategories(handlerDeps))
			r.Get("/pos/settings", handlers.GetPosSettings(handlerDeps))
			r.Get("/pos/rate/{currency}", handlers.GetRate(handlerDeps))
			r.Post("/pos/orders", handlers.CreateOrder(handlerDeps))
			r.Get("/pos/orders", handlers.ListDeviceOrders(handlerDeps))
			r.Get("/pos/orders/{id}", handlers.GetOrder(handlerDeps))
			r.Post("/pos/orders/{id}/deliver", handlers.MarkOrderDelivered(handlerDeps))
			r.Post("/pos/orders/{id}/cancel", handlers.UpdateOrderStatus(handlerDeps))
			r.Get("/pos/orders/{id}/receipt", handlers.OrderReceipt(handlerDeps))
			r.Post("/pos/orders/{id}/print", handlers.PrintOrderReceipt(handlerDeps))
			r.Get("/pos/ws", handlers.WebSocketHandler(handlerDeps))
		})
	})

	// Serve uploaded product images — reads cfg.UploadDir dynamically so store
	// switches take effect without restarting the app.
	os.MkdirAll(a.cfg.UploadDir, 0755)
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.FileServer(http.Dir(a.cfg.UploadDir)).ServeHTTP(w, r)
	})))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	// Serve the embedded frontend SPA for device pairing and non-API routes.
	// Phones open http://HOST:PORT/pos?pair=TOKEN and need React to load.
	frontendFS, fsErr := fs.Sub(assets, "frontend/dist")
	if fsErr == nil {
		fileServer := http.FileServer(http.FS(frontendFS))
		// Serve Vite-built JS/CSS bundles
		r.Handle("/assets/*", fileServer)
		// Serve static public files
		r.Handle("/favicon.ico", fileServer)
		r.Handle("/logo.png", fileServer)
		r.Handle("/donate-qr.png", fileServer)
	}

	// SPA catch-all: serve index.html for navigation routes so React Router works.
	// Requests for files with extensions (e.g. .json, .webm, .png) that weren't
	// matched above get a proper 404 — this prevents the splash screen detector
	// from mistaking index.html for actual asset files.
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		// If the path has a file extension, it's a missing static asset — 404 it
		path := req.URL.Path
		for i := len(path) - 1; i >= 0 && path[i] != '/'; i-- {
			if path[i] == '.' {
				http.Error(w, "Not Found", 404)
				return
			}
		}

		indexHTML, err := assets.ReadFile("frontend/dist/index.html")
		if err != nil {
			http.Error(w, "Not Found", 404)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(200)
		w.Write(indexHTML)
	})

	return r
}

// limitRequestBody is a middleware that limits the size of incoming request bodies
// to prevent memory exhaustion attacks. Returns 413 Payload Too Large if exceeded.
func limitRequestBody(maxBytes int64) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

