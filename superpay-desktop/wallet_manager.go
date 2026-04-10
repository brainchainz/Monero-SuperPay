package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type WalletManager struct {
	cmd       *exec.Cmd
	rpcPort   int
	walletDir string
	logPath   string
	running   bool
	mu        sync.Mutex
}

func NewWalletManager(dataDir string) *WalletManager {
	walletDir := filepath.Join(dataDir, "wallets")
	logPath := filepath.Join(dataDir, "wallet-rpc.log")

	// Create wallet directory if it doesn't exist
	os.MkdirAll(walletDir, 0755)

	return &WalletManager{
		rpcPort:   18082,
		walletDir: walletDir,
		logPath:   logPath,
		running:   false,
	}
}

func (wm *WalletManager) Start(daemonAddress, daemonUser, daemonPass string) error {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	if wm.running {
		return nil
	}

	// Find the monero-wallet-rpc binary
	binPath, err := wm.findBinary()
	if err != nil {
		return err
	}

	log.Printf("Found monero-wallet-rpc at: %s", binPath)

	// Prepare command arguments
	args := []string{
		fmt.Sprintf("--rpc-bind-port=%d", wm.rpcPort),
		"--rpc-bind-ip=127.0.0.1",
		"--disable-rpc-login",
		fmt.Sprintf("--daemon-address=%s", daemonAddress),
		fmt.Sprintf("--wallet-dir=%s", wm.walletDir),
		fmt.Sprintf("--log-file=%s", wm.logPath),
	}

	if daemonUser != "" {
		args = append(args, fmt.Sprintf("--daemon-login=%s:%s", daemonUser, daemonPass))
	}

	wm.cmd = exec.Command(binPath, args...)
	wm.cmd.Stdout = os.Stdout
	wm.cmd.Stderr = os.Stderr

	if err := wm.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start wallet RPC: %w", err)
	}

	wm.running = true
	log.Printf("Wallet RPC started on port %d", wm.rpcPort)

	return nil
}

func (wm *WalletManager) Stop() error {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	if !wm.running || wm.cmd == nil {
		return nil
	}

	process := wm.cmd.Process
	if process == nil {
		return nil
	}

	// Send SIGTERM
	if err := process.Signal(syscall.SIGTERM); err != nil {
		log.Printf("Error sending SIGTERM: %v", err)
	}

	// Wait up to 5 seconds for graceful shutdown
	done := make(chan error, 1)
	go func() {
		_, err := wm.cmd.Process.Wait()
		done <- err
	}()

	select {
	case <-time.After(5 * time.Second):
		// Force kill if still running
		log.Printf("Wallet RPC did not stop gracefully, killing...")
		if err := process.Signal(syscall.SIGKILL); err != nil {
			log.Printf("Error sending SIGKILL: %v", err)
		}
		<-done
	case err := <-done:
		if err != nil {
			log.Printf("Wallet RPC stopped with error: %v", err)
		}
	}

	wm.running = false
	log.Printf("Wallet RPC stopped")

	return nil
}

func (wm *WalletManager) IsRunning() bool {
	wm.mu.Lock()
	defer wm.mu.Unlock()
	return wm.running
}

// Restart stops the wallet-rpc process and starts it again with new daemon settings.
// This is called when the user changes the Monero node in Settings.
func (wm *WalletManager) Restart(daemonAddress, daemonUser, daemonPass string) error {
	log.Println("[wallet-rpc] Restarting with new daemon settings...")
	if err := wm.Stop(); err != nil {
		log.Printf("[wallet-rpc] Error during stop: %v", err)
	}
	// Brief pause to let the port free up
	time.Sleep(1 * time.Second)
	return wm.Start(daemonAddress, daemonUser, daemonPass)
}

func (wm *WalletManager) RPCURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d/json_rpc", wm.rpcPort)
}

func (wm *WalletManager) findBinary() (string, error) {
	// Check in app bundle Resources (for packaged Mac app)
	bundlePath := filepath.Join(os.Getenv("HOME"), "Applications", "MoneroSuperPay.app", "Contents", "Resources", "monero-wallet-rpc")
	if _, err := os.Stat(bundlePath); err == nil {
		return bundlePath, nil
	}

	// Check in PATH
	if binPath, err := exec.LookPath("monero-wallet-rpc"); err == nil {
		return binPath, nil
	}

	// Check common Homebrew locations
	homebrewPaths := []string{
		"/usr/local/bin/monero-wallet-rpc",
		"/opt/homebrew/bin/monero-wallet-rpc",
	}

	for _, path := range homebrewPaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("monero-wallet-rpc binary not found")
}
