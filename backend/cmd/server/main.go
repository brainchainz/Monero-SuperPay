package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/monero-superpay/monero-superpay/internal/config"
	"github.com/monero-superpay/monero-superpay/internal/db"
	"github.com/monero-superpay/monero-superpay/internal/handlers"
	"github.com/monero-superpay/monero-superpay/internal/payments"
	"github.com/monero-superpay/monero-superpay/internal/store"
	"github.com/monero-superpay/monero-superpay/internal/ws"
)

func main() {
	// Load configuration from environment
	cfg := config.Load()

	// Initialize database
	database, err := db.Init(cfg.DatabasePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize database: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	// Create chi router
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	// Limit request body size to 50 MB to prevent memory exhaustion attacks
	r.Use(limitRequestBody(50 * 1024 * 1024))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			// Allow same-host requests (Umbrel app proxy, local network)
			host := r.Host
			if origin == "http://"+host || origin == "https://"+host {
				return true
			}
			// Allow dev origins
			if origin == "http://localhost:3033" || origin == "http://localhost:5173" {
				return true
			}
			// Allow requests with no origin (non-browser clients, PoS devices)
			if origin == "" {
				return true
			}
			return false
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-API-Key"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Initialize WebSocket hub
	wsHub := ws.NewHub()
	go wsHub.Run()

	// Initialize StoreManager with /data directory
	dataDir := "/data"
	if dataDir == "" {
		dataDir = "./data"
	}
	storeMgr := store.NewStoreManager(dataDir)
	if err := storeMgr.Init(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize store manager: %v\n", err)
		os.Exit(1)
	}

	// Auto-detect Tor address and Tailscale IP from the host environment
	handlers.AutoDetectNetworkSettings(cfg, database)

	// Auto-open wallet if one was previously configured
	go payments.AutoOpenWallet(cfg, database)

	// Start native payment monitor (polls wallet-rpc for incoming payments)
	paymentMonitor := payments.NewPaymentMonitor(cfg, database, wsHub)
	paymentMonitor.Start()
	defer paymentMonitor.Stop()

	// Initialize handler dependencies
	handlerDeps := &handlers.Dependencies{
		DB:       database,
		Cfg:      cfg,
		WSHub:    wsHub,
		StoreMgr: storeMgr,
	}

	// API Routes
	r.Route("/api", func(r chi.Router) {
		// --- Public endpoints (no auth) ---
		// Pairing endpoints with rate limiting (create + pair only; status poll is read-only)
		r.With(handlers.RateLimitPairing).Post("/devices/pairing-token", handlers.CreatePairingToken(handlerDeps))
		r.With(handlers.RateLimitPairing).Post("/devices/pair", handlers.PairDevice(handlerDeps))
		r.Get("/devices/pairing-token/{token}", handlers.GetPairingTokenStatus(handlerDeps))

		// --- Dashboard endpoints (Umbrel handles auth via app proxy) ---
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
		r.Get("/orders/export/csv", handlers.ExportOrdersCSV(handlerDeps)) // Export to CSV
		r.Get("/orders/stats", handlers.GetOrderStats(handlerDeps))        // Complete Analytics Data
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

		// Stores
		r.Get("/stores", handlers.ListStores(handlerDeps))
		r.Post("/stores", handlers.CreateStore(handlerDeps))
		r.Put("/stores/{id}", handlers.UpdateStore(handlerDeps))
		r.Post("/stores/{id}/switch", handlers.SwitchStore(handlerDeps))
		r.Delete("/stores/{id}", handlers.DeleteStore(handlerDeps))
		r.Get("/stores/{id}/export", handlers.ExportStore(handlerDeps))
		r.Post("/stores/import", handlers.ImportStore(handlerDeps))

		// Settings
		r.Get("/settings", handlers.GetSettings(handlerDeps))
		r.Put("/settings", handlers.UpdateSettings(handlerDeps))

		// Node status (auto-configured on Umbrel) + manual test/connect
		r.Get("/node/status", handlers.GetNodeStatus(handlerDeps))
		r.Post("/node/test", handlers.TestNodeConnection(handlerDeps))
		r.Post("/node/connect", handlers.ConnectNode(handlerDeps))

		// Wallet setup
		r.Get("/wallet/status", handlers.GetWalletStatus(handlerDeps))
		r.Post("/wallet/setup", handlers.SetupWallet(handlerDeps))
		r.Get("/wallet/list", handlers.ListWallets(handlerDeps))
		r.Post("/wallet/delete", handlers.DeleteWallet(handlerDeps))
		r.Post("/wallet/delete-file", handlers.DeleteWalletFile(handlerDeps))

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

	// Serve uploaded product images from the uploads directory
	uploadsDir := cfg.UploadDir
	if uploadsDir == "" {
		uploadsDir = "./data/uploads"
	}
	os.MkdirAll(uploadsDir, 0755)
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadsDir))))

	// Serve static frontend files
	serveStaticFiles(r)

	// Health check endpoint (no auth required)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	// Create HTTP server
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		fmt.Printf("Starting server on port %s\n", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	fmt.Println("\nShutting down server...")

	// Create shutdown context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "Server shutdown error: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Server stopped")
}

func serveStaticFiles(r *chi.Mux) {
	// Serve static files from ./web directory
	// In production, files would be embedded
	workDir, _ := os.Getwd()
	filesDir := http.Dir(workDir + "/web")

	// Serve index.html for SPA routing
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(workDir + "/web" + r.RequestURI); os.IsNotExist(err) {
			// Serve index.html for route-not-found (SPA routing)
			http.ServeFile(w, r, workDir+"/web/index.html")
			return
		}
		http.FileServer(filesDir).ServeHTTP(w, r)
	})
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
