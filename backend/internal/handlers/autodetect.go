package handlers

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/monero-superpay/monero-superpay/internal/config"
)

// AutoDetectNetworkSettings reads Tor hostname and Tailscale IP on startup
// and pre-fills settings if they haven't been manually configured yet.
func AutoDetectNetworkSettings(cfg *config.Config, db *sql.DB) {
	autoDetectTor(cfg, db)
	autoDetectTailscale(db)
}

// autoDetectTor reads the Tor hidden service hostname file (provided by Umbrel)
// and saves it to the tor_address setting if not already set.
func autoDetectTor(cfg *config.Config, db *sql.DB) {
	if cfg.TorHostnameFile == "" {
		return
	}

	data, err := os.ReadFile(cfg.TorHostnameFile)
	if err != nil {
		// File doesn't exist — not running on Umbrel or Tor not configured; skip silently
		fmt.Printf("[autodetect] Tor hostname file not found at %s (this is normal if not on Umbrel)\n", cfg.TorHostnameFile)
		return
	}

	onion := strings.TrimSpace(string(data))
	if onion == "" {
		return
	}

	// Only set if the user hasn't already configured a tor_address
	existing, _ := GetSetting(db, "tor_address")
	if existing != "" {
		fmt.Printf("[autodetect] Tor address already configured: %s\n", existing)
		return
	}

	if err := SetSetting(db, "tor_address", onion); err != nil {
		fmt.Printf("[autodetect] Failed to save Tor address: %v\n", err)
		return
	}

	fmt.Printf("[autodetect] Tor address auto-detected: %s\n", onion)
}

// autoDetectTailscale looks for a Tailscale interface (typically "tailscale0")
// and saves its IP to the tailscale_ip setting if not already set.
func autoDetectTailscale(db *sql.DB) {
	ip := findTailscaleIP()
	if ip == "" {
		fmt.Println("[autodetect] No Tailscale interface found (this is normal if Tailscale is not installed)")
		return
	}

	// Only set if the user hasn't already configured a tailscale_ip
	existing, _ := GetSetting(db, "tailscale_ip")
	if existing != "" {
		fmt.Printf("[autodetect] Tailscale IP already configured: %s\n", existing)
		return
	}

	if err := SetSetting(db, "tailscale_ip", ip); err != nil {
		fmt.Printf("[autodetect] Failed to save Tailscale IP: %v\n", err)
		return
	}

	fmt.Printf("[autodetect] Tailscale IP auto-detected: %s\n", ip)
}

// findTailscaleIP scans network interfaces for a Tailscale address.
// Tailscale uses the 100.x.x.x CGNAT range.
func findTailscaleIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	for _, iface := range ifaces {
		// Check for tailscale0 or any interface in the 100.x.x.x range
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil || ip.IsLoopback() {
				continue
			}

			// Tailscale uses 100.64.0.0/10 (CGNAT range)
			ip4 := ip.To4()
			if ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
				return ip4.String()
			}
		}
	}

	return ""
}
