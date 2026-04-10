package handlers

import (
	"database/sql"

	"github.com/monero-superpay/superpay-desktop/internal/config"
	"github.com/monero-superpay/superpay-desktop/internal/store"
	"github.com/monero-superpay/superpay-desktop/internal/ws"
)

// WalletRestarter is implemented by WalletManager in the main package.
// It allows handlers to restart the wallet-rpc process when the user
// changes the Monero node in Settings without creating a circular import.
type WalletRestarter interface {
	Restart(daemonAddress, daemonUser, daemonPass string) error
}

// StoreSwitcher is implemented by the App struct in the main package.
// It allows the store handlers to trigger app-level operations when switching stores,
// such as closing the current database connection and opening the new store's database.
type StoreSwitcher interface {
	SwitchStore(storeID string) error
}

type Dependencies struct {
	DB            *sql.DB
	Cfg           *config.Config
	WSHub         *ws.Hub
	WalletMgr     WalletRestarter // nil-safe: handlers check before calling
	StoreMgr      *store.StoreManager
	StoreSwitcher StoreSwitcher // nil-safe: handlers check before calling
	ActualPort    int // The real port the HTTP server bound to (0.0.0.0:0 → random)
}
