.PHONY: dev build build-mac build-dmg build-universal clean setup download-wallet-rpc package-dmg test fmt

# Development mode with hot reload
dev:
	wails dev

# Production build (default platform)
build:
	wails build -clean

# Build for macOS (Universal binary: Intel + Apple Silicon)
build-mac:
	@echo "Building for macOS (Universal: Intel + Apple Silicon)..."
	wails build -platform darwin/universal -clean
	@echo "Build complete: build/bin/MoneroSuperPay.app"

# Create DMG installer (requires build-mac first)
build-dmg: build-mac
	@echo "Creating DMG installer..."
	@test -d "build/bin/MoneroSuperPay.app" || (echo "Error: MoneroSuperPay.app not found" && exit 1)
	@./scripts/build-dmg.sh build/bin/MoneroSuperPay.app 1.2.1
	@echo "DMG ready at build/MoneroSuperPay-1.2.1.dmg"

# Build for both Intel and Apple Silicon
build-universal:
	wails build -clean -platform darwin/universal

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf build/bin
	rm -rf build/*.dmg
	rm -rf frontend/dist
	rm -rf frontend/node_modules

# First-time setup
setup:
	@echo "Installing Wails CLI..."
	go install github.com/wailsapp/wails/v2/cmd/wails@latest
	@echo "Installing frontend dependencies..."
	cd frontend && npm install
	@echo "Running go mod tidy..."
	go mod tidy
	@echo ""
	@echo "Setup complete! Run 'make dev' to start development."

# Download monero-wallet-rpc binaries for bundling
download-wallet-rpc:
	@echo "Downloading monero-wallet-rpc..."
	@mkdir -p build/bin
	@echo "Download the official Monero CLI from https://getmonero.org/downloads/"
	@echo "Extract monero-wallet-rpc and place it in build/bin/"
	@echo ""
	@echo "For Apple Silicon: monero-wallet-rpc (arm64)"
	@echo "For Intel Mac: monero-wallet-rpc (x86_64)"

# Legacy DMG target (prefer build-dmg)
package-dmg: build-dmg

# Run Go tests
test:
	go test ./...

# Format code
fmt:
	go fmt ./...
	cd frontend && npx prettier --write src/

.PHONY: help
help:
	@echo "Monero SuperPay - macOS Build Targets"
	@echo ""
	@echo "  make dev              - Start development server with hot reload"
	@echo "  make build            - Build for default platform"
	@echo "  make build-mac        - Build universal macOS binary (Intel + Apple Silicon)"
	@echo "  make build-dmg        - Build DMG installer (includes build-mac)"
	@echo "  make clean            - Remove all build artifacts"
	@echo "  make setup            - Install dependencies and prepare environment"
	@echo "  make test             - Run Go tests"
	@echo "  make fmt              - Format code"
	@echo ""
	@echo "For signing and notarization, set environment variables:"
	@echo "  export DEVELOPER_ID='Developer ID Application: Name (ID)'"
	@echo "  export APPLE_ID='you@example.com'"
	@echo "  export APPLE_ID_PASSWORD='app-specific-password'"
	@echo "  export TEAM_ID='XXXXXXXXXX'"
	@echo "  make build-dmg"
