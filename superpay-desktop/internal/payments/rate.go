package payments

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// httpClient is a reusable HTTP client for external API calls
var httpClient = &http.Client{
	Timeout: 10 * time.Second,
}

// RateCache caches the exchange rate to avoid hammering CoinGecko
type RateCache struct {
	mu        sync.RWMutex
	rate      float64
	currency  string
	updatedAt time.Time
	ttl       time.Duration
}

var globalRateCache = &RateCache{
	ttl: 30 * time.Second,
}

// GetXMRRate returns the current XMR price in the given fiat currency.
// Uses CoinGecko's free API with a 30-second cache.
func GetXMRRate(currency string) (float64, error) {
	currency = strings.ToLower(currency)

	globalRateCache.mu.RLock()
	if globalRateCache.currency == currency &&
		time.Since(globalRateCache.updatedAt) < globalRateCache.ttl &&
		globalRateCache.rate > 0 {
		rate := globalRateCache.rate
		globalRateCache.mu.RUnlock()
		return rate, nil
	}
	globalRateCache.mu.RUnlock()

	// Fetch fresh rate from CoinGecko
	rate, err := fetchCoinGeckoRate(currency)
	if err != nil {
		// Try Kraken as fallback for USD
		if currency == "usd" {
			rate, err = fetchKrakenRate()
			if err != nil {
				return 0, fmt.Errorf("failed to fetch XMR rate: %w", err)
			}
		} else {
			return 0, err
		}
	}

	// Cache the result
	globalRateCache.mu.Lock()
	globalRateCache.rate = rate
	globalRateCache.currency = currency
	globalRateCache.updatedAt = time.Now()
	globalRateCache.mu.Unlock()

	return rate, nil
}

// fetchCoinGeckoRate fetches XMR price from CoinGecko free API
func fetchCoinGeckoRate(currency string) (float64, error) {
	url := fmt.Sprintf(
		"https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=%s",
		currency,
	)

	resp, err := httpClient.Get(url)
	if err != nil {
		return 0, fmt.Errorf("CoinGecko request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("CoinGecko returned status %d: %s", resp.StatusCode, string(body))
	}

	// Response format: {"monero":{"usd":150.23}}
	var result map[string]map[string]float64
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("failed to decode CoinGecko response: %w", err)
	}

	monero, ok := result["monero"]
	if !ok {
		return 0, fmt.Errorf("CoinGecko response missing 'monero' key")
	}

	rate, ok := monero[currency]
	if !ok {
		return 0, fmt.Errorf("CoinGecko response missing '%s' rate", currency)
	}

	if rate <= 0 {
		return 0, fmt.Errorf("CoinGecko returned invalid rate: %f", rate)
	}

	return rate, nil
}

// fetchKrakenRate fetches XMR/USD from Kraken as a fallback
func fetchKrakenRate() (float64, error) {
	url := "https://api.kraken.com/0/public/Ticker?pair=XMRUSD"

	resp, err := httpClient.Get(url)
	if err != nil {
		return 0, fmt.Errorf("Kraken request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("Kraken returned status %d", resp.StatusCode)
	}

	var result struct {
		Error  []string `json:"error"`
		Result map[string]struct {
			C []string `json:"c"` // c = last trade closed [price, lot-volume]
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("failed to decode Kraken response: %w", err)
	}

	if len(result.Error) > 0 {
		return 0, fmt.Errorf("Kraken error: %s", result.Error[0])
	}

	for _, ticker := range result.Result {
		if len(ticker.C) > 0 {
			var rate float64
			fmt.Sscanf(ticker.C[0], "%f", &rate)
			if rate > 0 {
				return rate, nil
			}
		}
	}

	return 0, fmt.Errorf("Kraken returned no valid ticker data")
}
