# Monero SuperPay — Desktop App

A standalone macOS point-of-sale application for accepting Monero payments.

## Prerequisites

- Go 1.22+
- Node.js 20+
- Wails CLI v2 (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

## Quick Start

```bash
# First-time setup
make setup

# Development (hot reload)
make dev

# Production build
make build
```

## Bundling monero-wallet-rpc

For the app to manage wallets, you need to bundle `monero-wallet-rpc`:

1. Download from https://getmonero.org/downloads/
2. Extract `monero-wallet-rpc` binary
3. Place in `build/bin/monero-wallet-rpc`

The app will also look for `monero-wallet-rpc` in your system PATH.

## Build for Distribution

```bash
# Build universal binary (Intel + Apple Silicon)
make build-universal

# Create DMG installer
make package-dmg
```
