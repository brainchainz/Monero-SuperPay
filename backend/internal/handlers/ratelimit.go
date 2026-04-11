package handlers

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type rateLimiter struct {
	requests sync.Map // map[string]*ipRecord
}

type ipRecord struct {
	count    int
	resetAt  time.Time
}

var pairingLimiter = &rateLimiter{}

func init() {
	// Cleanup stale entries every 5 minutes
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			now := time.Now()
			pairingLimiter.requests.Range(func(key, value interface{}) bool {
				if rec, ok := value.(*ipRecord); ok && now.After(rec.resetAt) {
					pairingLimiter.requests.Delete(key)
				}
				return true
			})
		}
	}()
}

func RateLimitPairing(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		// Strip port
		if idx := strings.LastIndex(ip, ":"); idx != -1 {
			ip = ip[:idx]
		}

		now := time.Now()
		val, _ := pairingLimiter.requests.LoadOrStore(ip, &ipRecord{
			count:   0,
			resetAt: now.Add(1 * time.Minute),
		})
		rec := val.(*ipRecord)

		if now.After(rec.resetAt) {
			rec.count = 0
			rec.resetAt = now.Add(1 * time.Minute)
		}

		rec.count++
		if rec.count > 30 {
			http.Error(w, `{"error":"too many requests"}`, http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}
