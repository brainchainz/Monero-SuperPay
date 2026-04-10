# SuperPay Desktop (Mac) — Development Changes

GitHub: https://github.com/brainchainz/Monero-Superbrain/tree/main/brainchainz-monero-superpay

---

## Session 3 — March 26, 2026

### Bug Fixes

1. **Product images not displaying after upload**
   - `app.go` — Upload file server was falling back to `./data/uploads` (Docker-era path) instead of `~/Library/Application Support/MoneroSuperPay/uploads/`
   - Fixed to use `config.DataDir() + "/uploads"`

2. **API_BASE evaluated too early (all API calls broken in Wails)**
   - `frontend/src/lib/api.ts` — `const API_BASE = getApiBase()` was evaluated at module load time, before Wails could set `window.__SUPERPAY_API_BASE__`. All fetch calls resolved to `wails:///api/...` (invalid).
   - Changed to `export function getApiBase()` called at request time in every fetch
   - Fixed in: `api.ts`, `deviceApi.ts`, `Settings.tsx`

3. **Node connection test "string did not match expected pattern"**
   - Root cause was the API_BASE issue above
   - Also fixed: `Settings.tsx` response unwrapping — backend wraps in `{ data: ... }` but raw fetch wasn't unwrapping it

4. **POS pairing URL 404 (`/pos?pair=TOKEN`)**
   - `app.go` — Chi router only had `/api/*` and `/uploads/*` routes. Phones opening the pairing URL got 404.
   - Added SPA catch-all: `r.NotFound()` serves embedded `index.html`, plus `/assets/*` route for Vite bundles
   - Added `"io/fs"` import for `fs.Sub(assets, "frontend/dist")`

5. **TypeScript compile errors in Settings.tsx**
   - Removed `process.env.REACT_APP_API_URL` reference (not available in Vite/Wails)
   - Added missing fields to `Settings` interface: `monero_node_type`, `monero_node_user`, `monero_node_pass`
   - Added `target_height` to `WalletStatus` interface
   - Fixed unused `(e)` parameter on radio button onChange
   - Fixed string-to-union-type assignment for `monero_node_type`

6. **Unused imports causing Go compile errors**
   - `internal/handlers/node.go` — Removed unused `crypto/md5` and `encoding/hex` imports (those functions live in `wallet.go`, same package)

### Wallet-RPC Restart on Node Change

- `internal/handlers/deps.go` — Added `WalletRestarter` interface with `Restart(addr, user, pass string) error`
- `internal/handlers/deps.go` — Added `WalletMgr WalletRestarter` field to `Dependencies`
- `internal/handlers/node.go` — `ConnectNode` handler now calls `deps.WalletMgr.Restart()` after saving new node settings. Nil-safe check, returns `"partial"` status if restart fails.
- `app.go` — Passes `WalletMgr: a.walletMgr` to handler dependencies

### Multi-Store System (NEW FEATURE)

Allows merchants to run multiple businesses from one SuperPay instance. Each store has its own database, products, orders, wallets, uploads, and node configuration. Stores can be exported as `.superpay` files and imported on any other SuperPay instance.

**Backend:**
- `internal/store/manager.go` (NEW) — StoreManager with full lifecycle:
  - `Init()` — Creates stores directory, migrates existing merchant.db/uploads/wallets into a "Default" store on first run
  - `Create(name, description)` — New store with empty DB
  - `List()` / `GetActive()` — Query stores
  - `Switch(storeID)` — Update active store in index
  - `Delete(storeID)` — Remove store (can't delete active)
  - `Update(storeID, name, description)` — Edit metadata
  - `Export(storeID, destPath)` — Zip store directory into `.superpay` file
  - `Import(zipPath)` — Unzip `.superpay` file as new store
  - Node config (address, user, pass, type) saved per-store in `store.json` manifest
  - Thread-safe with `sync.RWMutex`
  - Data stored in `~/Library/Application Support/MoneroSuperPay/stores/{uuid}/`

- `internal/handlers/store.go` (NEW) — 7 REST endpoints:
  - `GET /api/stores` — List all stores with active indicator
  - `POST /api/stores` — Create new store
  - `POST /api/stores/{id}/switch` — Switch active store
  - `PUT /api/stores/{id}` — Update store metadata
  - `DELETE /api/stores/{id}` — Delete store
  - `POST /api/stores/{id}/export` — Download `.superpay` zip
  - `POST /api/stores/import` — Upload and import `.superpay` file

- `internal/handlers/deps.go` — Added `StoreSwitcher` interface and `StoreMgr`/`StoreSwitcher` fields
- `app.go` — `SwitchStore()` method closes current DB, opens new store's DB, restarts wallet-rpc with store's node config. StoreManager initialized before DB in startup sequence.

**Frontend:**
- `frontend/src/components/StoreSwitcher.tsx` (NEW) — Compact dropdown in sidebar between logo and nav. Shows active store, click to switch, "+" to create new store.
- `frontend/src/lib/api.ts` — Added `stores` export with list/create/switch/update/delete/export methods
- `frontend/src/lib/types.ts` — Added `Store` interface
- `frontend/src/pages/Settings.tsx` — Added "Stores" management section (create, edit, delete, export)

### Password Protection + Lock Screen (NEW FEATURE)

PIN-based lock that blocks UI visibility while keeping the backend running (payments still process).

- `frontend/src/components/LockScreen.tsx` (NEW) — Full-screen overlay with PIN input, visual dots, shake animation on wrong PIN
- `frontend/src/context/LockContext.tsx` (NEW) — React context provider with `useLock()` hook, SHA-256 hashed PIN stored in localStorage
- `frontend/src/components/Sidebar.tsx` — Added Lock button in footer, integrated StoreSwitcher
- `frontend/src/App.tsx` — Wrapped in `<LockProvider>` for app-wide lock state

### Files Changed (Complete List)

```
MODIFIED:
  app.go                                    — Store manager init, SwitchStore(), store routes, SPA fallback, image path fix
  main.go                                   — (no changes this session)
  internal/handlers/deps.go                 — WalletRestarter, StoreSwitcher interfaces, new fields
  internal/handlers/node.go                 — Wallet restart on connect, removed unused imports
  frontend/src/lib/api.ts                   — getApiBase() lazy eval, stores API, dynamic URLs
  frontend/src/lib/types.ts                 — Store interface, lock_pin, target_height, node fields
  frontend/src/lib/deviceApi.ts             — Use getApiBase() instead of hardcoded '/api'
  frontend/src/pages/Settings.tsx           — Node connection fix, store management section
  frontend/src/components/Sidebar.tsx        — StoreSwitcher, Lock button
  frontend/src/App.tsx                      — LockProvider wrapper

CREATED:
  internal/store/manager.go                 — Multi-store manager (create, switch, export, import)
  internal/handlers/store.go                — Store REST API handlers
  frontend/src/components/StoreSwitcher.tsx  — Store switcher dropdown
  frontend/src/components/LockScreen.tsx     — PIN lock screen overlay
  frontend/src/context/LockContext.tsx       — Lock state context provider
```

### Notes

- Custom item in POS already existed (calculator keypad via `$` icon in top bar)
- All changes mirrored to Umbrel codebase (see `/CHANGES.md` in project root)
- GitHub repo: https://github.com/brainchainz/Monero-Superbrain/tree/main/brainchainz-monero-superpay

---

## Session 4 — March 28, 2026

### Bug Fixes

1. **Settings.tsx treating StoreListResponse as array (TypeScript errors)**
   - `stores.list()` returns `{ stores: [...], active_store_id: "..." }` but Settings.tsx was using `.length`, `.map`, `[0]` directly on the response object
   - Changed query binding from `data: stores` to `data: storesData`, extracted `storeList = storesData?.stores || []` and `activeStoreId = storesData?.active_store_id`
   - Active store badge now uses `activeStoreId === store.id` instead of `stores[0]?.id === store.id`
   - Fixed `store.description` possibly-undefined assignment to `setEditStoreDescription` (added `|| ''` fallback)

### Mirrored to Umbrel

2. **Added store management UI to Umbrel Settings.tsx**
   - Umbrel frontend `Settings.tsx` was missing the entire Stores section that was built in the desktop app
   - Added: imports (`storesApi`, `Store` type, lucide icons), store state variables, stores query with correct `storesData`/`storeList`/`activeStoreId` destructuring, CRUD mutations, store list UI, create store modal
   - Uses `storesApi.export()` (Umbrel naming) instead of `storesApi.exportStore()` (desktop naming)

3. **Fixed unused `settingsData` in Umbrel LockContext.tsx**
   - Changed `const { data: settingsData } = useQuery(...)` to `useQuery(...)` (result not needed, query kept for cache priming)

### Files Changed

```
MODIFIED:
  superpay-desktop/frontend/src/pages/Settings.tsx  — StoreListResponse type fix
  frontend/src/pages/Settings.tsx                   — Added store management section (mirrored from desktop)
  frontend/src/context/LockContext.tsx               — Removed unused settingsData binding
```
