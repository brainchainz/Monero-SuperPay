#!/bin/bash
#
# build-dmg.sh - Create a professional DMG installer for Monero SuperPay
#
# Usage:
#   ./scripts/build-dmg.sh [path-to-app-bundle] [version]
#
# Environment variables:
#   DEVELOPER_ID     - Developer ID certificate for signing (optional, e.g., "Developer ID Application: Name (ID)")
#   APPLE_ID         - Apple ID email for notarization (optional)
#   APPLE_ID_PASSWORD - Apple ID app-specific password (optional)
#   TEAM_ID          - Apple Team ID for notarization (optional)

set -e

# Configuration
APP_PATH="${1:=build/bin/MoneroSuperPay.app}"
VERSION="${2:=1.0.0}"
APP_NAME="MoneroSuperPay"
DMG_NAME="${APP_NAME}-${VERSION}.dmg"
DMG_PATH="build/${DMG_NAME}"
TEMP_DMG="build/${APP_NAME}-temp.dmg"
MOUNT_POINT="/Volumes/${APP_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verify the app bundle exists
if [ ! -d "$APP_PATH" ]; then
    log_error "App bundle not found at: $APP_PATH"
    exit 1
fi

log_info "Building DMG for ${APP_NAME} v${VERSION}..."

# Clean up any previous builds
if [ -f "$DMG_PATH" ]; then
    log_info "Removing existing DMG..."
    rm -f "$DMG_PATH"
fi

if [ -f "$TEMP_DMG" ]; then
    rm -f "$TEMP_DMG"
fi

# Unmount if already mounted
if [ -d "$MOUNT_POINT" ]; then
    log_info "Unmounting existing DMG..."
    hdiutil detach "$MOUNT_POINT" 2>/dev/null || true
fi

# Create a temporary DMG (600x400 pixels)
log_info "Creating temporary DMG..."
hdiutil create \
    -volname "${APP_NAME}" \
    -srcfolder "$APP_PATH" \
    -size 500m \
    -fs HFS+ \
    -format UDRW \
    "$TEMP_DMG" > /dev/null

# Mount the temporary DMG
log_info "Mounting DMG..."
hdiutil attach "$TEMP_DMG" > /dev/null

# Add Applications symlink
log_info "Adding Applications folder symlink..."
ln -s /Applications "$MOUNT_POINT/Applications" 2>/dev/null || true

# Try to customize the DMG appearance with AppleScript if available
if command -v osascript &> /dev/null; then
    log_info "Customizing DMG appearance..."

    # Copy background image into the DMG
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    BG_IMG="${SCRIPT_DIR}/../build/dmg-background.png"
    if [ -f "$BG_IMG" ]; then
        mkdir -p "$MOUNT_POINT/.background"
        cp "$BG_IMG" "$MOUNT_POINT/.background/background.png"
        log_info "Background image added to DMG"
    else
        log_warn "DMG background image not found at $BG_IMG"
    fi

    # Give Finder time to index the volume
    sleep 2

    # Create an AppleScript to position icons and set window properties
    osascript <<EOF
tell application "Finder"
    tell disk "$APP_NAME"
        open
        delay 1

        -- Set window properties
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false

        -- Set window position and size (600x400)
        set the bounds of container window to {100, 100, 700, 500}

        -- Configure icon view
        set viewOptions to icon view options of container window
        set icon size of viewOptions to 128
        set arrangement of viewOptions to not arranged
        set text size of viewOptions to 14

        -- Set background image if it exists
        try
            set background picture of viewOptions to file ".background:background.png"
        end try

        -- Position the app icon (left side)
        set position of item "$APP_NAME.app" of container window to {150, 185}

        delay 0.5

        -- Position the Applications symlink (right side)
        set position of item "Applications" of container window to {450, 185}

        -- Update display
        close
        open
        delay 1
        update without registering applications
    end tell
end tell
EOF
    sleep 2
else
    log_warn "osascript not available, skipping DMG customization"
fi

# Unmount the DMG
log_info "Unmounting DMG..."
hdiutil detach "$MOUNT_POINT" > /dev/null

# Convert to compressed read-only DMG
log_info "Converting to compressed read-only DMG..."
hdiutil convert \
    "$TEMP_DMG" \
    -format UDZO \
    -o "$DMG_PATH" > /dev/null

# Remove temporary DMG
rm -f "$TEMP_DMG"

# Sign the DMG if DEVELOPER_ID is set
if [ -n "$DEVELOPER_ID" ]; then
    log_info "Code signing DMG..."
    if codesign -s "$DEVELOPER_ID" "$DMG_PATH"; then
        log_info "DMG signed successfully"
    else
        log_warn "Failed to sign DMG - ensure developer certificate is installed"
    fi
else
    log_warn "DEVELOPER_ID not set, skipping code signing"
fi

# Notarize the DMG if Apple ID credentials are set
if [ -n "$APPLE_ID" ] && [ -n "$APPLE_ID_PASSWORD" ] && [ -n "$TEAM_ID" ]; then
    log_info "Notarizing DMG..."

    # Submit for notarization
    NOTARIZE_OUTPUT=$(xcrun notarytool submit \
        "$DMG_PATH" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_ID_PASSWORD" \
        --team-id "$TEAM_ID" \
        --wait 2>&1)

    if echo "$NOTARIZE_OUTPUT" | grep -q "Notarization successful"; then
        log_info "Notarization successful"

        # Staple the notarization ticket
        xcrun stapler staple "$DMG_PATH"
        log_info "Notarization ticket stapled"
    else
        log_warn "Notarization failed or timed out"
        echo "$NOTARIZE_OUTPUT"
    fi
else
    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$TEAM_ID" ]; then
        log_warn "Incomplete Apple ID credentials for notarization, skipping"
    fi
fi

log_info "DMG created successfully: $DMG_PATH"
log_info "File size: $(du -h "$DMG_PATH" | cut -f1)"
