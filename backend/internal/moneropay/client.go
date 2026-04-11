package moneropay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the MoneroPay HTTP client
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// PaymentRequest is the request body for creating a payment
type PaymentRequest struct {
	Amount      string `json:"amount"`
	Description string `json:"description"`
}

// PaymentResponse is the response from creating a payment
type PaymentResponse struct {
	PaymentID string `json:"payment_id"`
	Address   string `json:"address"`
	Amount    string `json:"amount"`
	Status    string `json:"status"`
}

// PaymentStatusResponse is the response for payment status
type PaymentStatusResponse struct {
	Status string `json:"status"`
}

// HealthResponse is the response from health check
type HealthResponse struct {
	Status string `json:"status"`
}

// NewClient creates a new MoneroPay client
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreatePayment creates a new payment request
func (c *Client) CreatePayment(amount string, description string) (*PaymentResponse, error) {
	if amount == "" {
		return nil, fmt.Errorf("amount is required")
	}

	req := PaymentRequest{
		Amount:      amount,
		Description: description,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", fmt.Sprintf("%s/receive", c.baseURL), bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var paymentResp PaymentResponse
	if err := json.NewDecoder(resp.Body).Decode(&paymentResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &paymentResp, nil
}

// GetPaymentStatus gets the status of a payment
func (c *Client) GetPaymentStatus(paymentID string) (string, error) {
	if paymentID == "" {
		return "", fmt.Errorf("payment_id is required")
	}

	httpReq, err := http.NewRequest("GET", fmt.Sprintf("%s/status/%s", c.baseURL, paymentID), nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var statusResp PaymentStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&statusResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return statusResp.Status, nil
}

// GetHealth checks the health of the MoneroPay service
func (c *Client) GetHealth() error {
	httpReq, err := http.NewRequest("GET", fmt.Sprintf("%s/health", c.baseURL), nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// GetRate gets the current XMR/fiat exchange rate
// This method assumes MoneroPay has a /rate endpoint
func (c *Client) GetRate() (float64, error) {
	httpReq, err := http.NewRequest("GET", fmt.Sprintf("%s/rate", c.baseURL), nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return 0, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var rateResp struct {
		Rate float64 `json:"rate"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rateResp); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}

	return rateResp.Rate, nil
}
