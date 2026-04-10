# Monero SuperPay macOS Build Guide

This guide explains how to build and package the Monero SuperPay desktop application for macOS.

## Prerequisites

- **Go** 1.21 or later
- **Node.js** 18 or later (for frontend build)
- **Wails CLI** v2 ([install here](https://wails.io/docs/gettingstarted/installation))
- **Xcode Command Line Tools** (for code signing and notarization)

### Install Prerequisites

```bash
# Install Go (if not already installed)
# Visit: https://golang.org/doc/install

# Install Node.js (if not already installed)
# Visit: https://nodejs.org/

# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Install Xcode Command Line Tools
xcode-select --install
```

## Initial Setup

Run the setup target once to install dependencies:

```bash
make setup
```

This will:
1. Install the Wails CLI
2. Install frontend npm dependencies
3. Run `go mod tidy` to ensure Go dependencies are correct

## Development

Start the development server with hot reload:

```bash
make dev
```

This opens the application with live reloading enabled. Code changes in both Go and React will trigger automatic rebuilds.

## Building for Production

### Build Universal macOS Binary

Create a universal binary that works on both Intel (x86_64) and Apple Silicon (ARM64) Macs:

```bash
make build-mac
```

Output: `build/bin/MoneroSuperPay.app`

### Create DMG Installer

Build the universal binary and create a professional DMG installer:

```bash
make build-dmg
```

Output: `build/MoneroSuperPay-1.0.0.dmg`

The DMG includes:
- The MoneroSuperPay.app bundle
- A symbolic link to /Applications for easy installation
- Professional window layout with icon positioning

## Code Signing and Notarization

macOS requires code signing and notarization for distribution. Follow these steps:

### 1. Obtain Developer Certificates

- Enroll in the Apple Developer Program
- Create a "Developer ID Application" certificate in [Apple Developer](https://developer.apple.com)
- Install the certificate in your Keychain

### 2. Create App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in and navigate to "Security"
3. Generate an "App-specific password" for "notarization"

### 3. Build and Sign the DMG

Set environment variables and build:

```bash
export DEVELOPER_ID="Developer ID Application: Your Name (XXXXXXXXXX)"
export APPLE_ID="your-email@example.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # App-specific password
export TEAM_ID="XXXXXXXXXX"  # Your Apple Team ID

make build-dmg
```

The build script will:
1. Create a universal binary
2. Build the DMG
3. Code sign the DMG with your Developer ID
4. Submit for notarization and wait for approval
5. Staple the notarization ticket to the DMG

### Without Code Signing

If you're building for local testing only, you can skip signing:

```bash
make build-dmg
```

The DMG will be created without signing. Users may see a security warning when opening it, but can dismiss it.

## File Structure

```
superpay-desktop/
├── main.go                    # Application entry point
├── app.go                     # App struct and Wails hooks
├── wails.json                 # Wails configuration
├── Makefile                   # Build targets
├── scripts/
│   └── build-dmg.sh          # DMG creation script with signing/notarization
├── build/
│   ├── Info.plist            # macOS app metadata
│   ├── appicon.png           # Application icon (256x256 or larger)
│   ├── darwin/
│   │   └── Info.plist        # Darwin-specific metadata
│   └── bin/
│       ├── MoneroSuperPay.app    # Built application bundle
│       └── MoneroSuperPay-*.dmg  # DMG installer
├── frontend/                  # React frontend
├── internal/                  # Go backend packages
└── README-BUILD.md           # This file
```

## Application Icon

The DMG build requires an application icon at `build/appicon.png`. This should be:
- PNG format
- Minimum 256x256 pixels (512x512 recommended for macOS)
- Square format
- Transparent background for best appearance

Place your icon file at:
```
build/appicon.png
```

If the icon is missing, the build will proceed but won't display an icon in the Finder.

## Troubleshooting

### "Code signing identity not found"

Ensure your Developer ID certificate is installed in Keychain:

```bash
# List installed certificates
security find-identity -v -p codesigning

# Import certificate if needed
# Use Keychain Access app or certificate from Apple Developer
```

### "Notarization failed"

Check that:
1. APPLE_ID and APPLE_ID_PASSWORD are correct
2. The app-specific password is generated for notarization
3. Your Apple Developer account is in good standing
4. The DMG is code signed before notarization

### "DMG not mounting on other Macs"

This is usually a signing/notarization issue. Ensure:
1. The DMG is signed with a valid Developer ID
2. The notarization ticket is stapled
3. The app bundle inside is also signed

Test locally first:
```bash
hdiutil attach build/MoneroSuperPay-1.0.0.dmg
# Should mount without warnings
```

## Additional Make Targets

```bash
make clean          # Remove all build artifacts
make test           # Run Go tests
make fmt            # Format Go and React code
make help           # Display all available targets
```

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DEVELOPER_ID` | Developer ID Application certificate name | For code signing |
| `APPLE_ID` | Apple ID email address | For notarization |
| `APPLE_ID_PASSWORD` | App-specific password | For notarization |
| `TEAM_ID` | Apple Team ID (10-character code) | For notarization |

## Distribution

Once the DMG is built and notarized:

1. Upload `build/MoneroSuperPay-1.0.0.dmg` to your download server
2. Users can download and open the DMG
3. Drag the MoneroSuperPay app to Applications folder
4. Launch from Applications or Spotlight

The notarized DMG will open without warnings on any Mac with macOS 10.15+.

## References

- [Wails Documentation](https://wails.io/)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [hdiutil Manual](https://ss64.com/osx/hdiutil.html)
