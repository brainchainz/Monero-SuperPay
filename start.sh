#!/bin/bash
# Start script for Monero SuperPay
# Runs init-config if .env doesn't exist, then starts docker compose

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "First run detected — running auto-configuration..."
    bash init-config.sh
else
    # Auto-migrate legacy port 3000 entries
    if grep -q "APP_MONERO_SUPERPAY_PORT=3000" .env; then
        echo "Updating legacy port 3000 to 3033 in .env..."
        # BSD sed (macOS) and GNU sed (Linux) compatibility
        sed -i '' 's/APP_MONERO_SUPERPAY_PORT=3000/APP_MONERO_SUPERPAY_PORT=3033/g' .env 2>/dev/null || sed -i 's/APP_MONERO_SUPERPAY_PORT=3000/APP_MONERO_SUPERPAY_PORT=3033/g' .env
    fi
fi

echo "Starting Monero SuperPay..."
docker compose --env-file .env up -d

echo ""
echo "Monero SuperPay is running!"
echo "Dashboard: http://umbrel.local:3033"
