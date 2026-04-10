package handlers

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/monero-superpay/superpay-desktop/internal/payments"
)

// RateResponse represents the exchange rate response
type RateResponse struct {
	Currency  string    `json:"currency"`
	Rate      float64   `json:"rate"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetRate handles GET /api/rate and /api/rate/{currency}
func GetRate(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currency := chi.URLParam(r, "currency")
		if currency == "" {
			currency = deps.Cfg.FiatCurrency
		}
		if currency == "" {
			currency = "USD"
		}

		rate, err := payments.GetXMRRate(currency)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to fetch exchange rate: "+err.Error())
			return
		}

		response := RateResponse{
			Currency:  currency,
			Rate:      rate,
			UpdatedAt: time.Now(),
		}

		respondSuccess(w, http.StatusOK, response)
	}
}
