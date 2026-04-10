package handlers

import (
	"database/sql"
	"fmt"
	"net"

	"github.com/monero-superpay/superpay-desktop/internal/config"
)

// AutoDetectNetworkSettings reads Tailscale IP and LAN IP on startup
// and pre-fills settings if they haven't been manually configured yet.
func AutoDetectNetworkSettings(cfg *config.Config, db *sql.DB) {
	autoDetectTailscale(db)
	autoDetectLANIP(db)
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

// autoDetectLANIP finds the machine's LAN IP (192.168.x.x or 10.x.x.x)
// and saves it to the "lan_ip" setting if not already set.
func autoDetectLANIP(db *sql.DB) {
	ip := findLANIP()
	if ip == "" {
		fmt.Println("[autodetect] No LAN IP found (check network configuration)")
		return
	}

	// Only set if the user hasn't already configured a lan_ip
	existing, _ := GetSetting(db, "lan_ip")
	if existing != "" {
		fmt.Printf("[autodetect] LAN IP already configured: %s\n", existing)
		return
	}

	if err := SetSetting(db, "lan_ip", ip); err != nil {
		fmt.Printf("[autodetect] Failed to save LAN IP: %v\n", err)
		return
	}

	fmt.Printf("[autodetect] LAN IP auto-detected: %s\n", ip)
}

// findLANIP scans network interfaces for a private/LAN address.
// Returns the first private IP found (192.168.x.x or 10.x.x.x).
func findLANIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	for _, iface := range ifaces {
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

			// Check for private IP addresses
			ip4 := ip.To4()
			if ip4 != nil {
				// 192.168.x.x
				if ip4[0] == 192 && ip4[1] == 168 {
					return ip4.String()
				}
				// 10.x.x.x
				if ip4[0] == 10 {
					return ip4.String()
				}
				// 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
				if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
					return ip4.String()
				}
			}
		}
	}

	return ""
}
