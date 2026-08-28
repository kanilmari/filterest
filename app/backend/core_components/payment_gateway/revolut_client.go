// revolut_client.go
// HTTP client wrapper for the Revolut payment API. Provides authenticated request helpers for
// creating, retrieving, and cancelling Revolut payment orders.
// Exists to isolate Revolut request construction, timeouts, and response parsing.
package payment_gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RevolutClient handles communication with Revolut Merchant API
type RevolutClient struct {
	SecretKey  string
	PublicKey  string
	BaseURL    string
	APIVersion string
	HTTPClient *http.Client
}

// RevolutOrder represents an order in Revolut
type RevolutOrder struct {
	ID                string    `json:"id"`
	Token             string    `json:"token"`
	Type              string    `json:"type"`
	State             string    `json:"state"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
	Amount            int       `json:"amount"`
	Currency          string    `json:"currency"`
	OutstandingAmount int       `json:"outstanding_amount"`
	CaptureMode       string    `json:"capture_mode"`
	Description       string    `json:"description"`
	CheckoutURL       string    `json:"checkout_url"`
	CustomerEmail     string    `json:"customer_email,omitempty"`
	MerchantOrderRef  string    `json:"merchant_order_ext_ref,omitempty"`
}

// CreateOrderRequest represents the request body for creating an order
type CreateOrderRequest struct {
	Amount           int               `json:"amount"`
	Currency         string            `json:"currency"`
	Description      string            `json:"description,omitempty"`
	CustomerEmail    string            `json:"customer_email,omitempty"`
	MerchantOrderRef string            `json:"merchant_order_ext_ref,omitempty"`
	Metadata         map[string]string `json:"metadata,omitempty"`
	RedirectURL      string            `json:"redirect_url,omitempty"`
	Locale           string            `json:"locale,omitempty"`
}

// WebhookPayload represents incoming webhook data from Revolut
type WebhookPayload struct {
	Event   string `json:"event"`
	OrderID string `json:"order_id"`
}

// NewRevolutClient creates a new Revolut client, loading config from revolut.env
// or falling back to already-set environment variables (for Docker deployments).
func NewRevolutClient() (*RevolutClient, error) {
	// Try loading from revolut.env file (for local dev)
	envPath := filepath.Join(filepath.Dir(os.Args[0]), "backend/core_components/payment_gateway/revolut.env")
	if err := loadEnvFile(envPath); err != nil {
		envPath = "backend/core_components/payment_gateway/revolut.env"
		if err := loadEnvFile(envPath); err != nil {
			// No env file found — that's OK if env vars are already set (Docker)
			log.Printf("[payment-gateway] revolut.env not found, using environment variables")
		}
	}

	secretKey := os.Getenv("REVOLUT_MERCHANT_API_SECRET_KEY")
	publicKey := os.Getenv("REVOLUT_MERCHANT_API_PUBLIC_KEY")
	sandboxMode := os.Getenv("SANDBOX_MODE")

	if secretKey == "" {
		return nil, fmt.Errorf("REVOLUT_MERCHANT_API_SECRET_KEY not set")
	}

	baseURL := "https://merchant.revolut.com/api"
	if strings.ToLower(sandboxMode) == "true" {
		baseURL = "https://sandbox-merchant.revolut.com/api"
	}

	return &RevolutClient{
		SecretKey:  secretKey,
		PublicKey:  publicKey,
		BaseURL:    baseURL,
		APIVersion: "2024-09-01",
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// loadEnvFile loads environment variables from a file
func loadEnvFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.TrimSpace(parts[1])
			os.Setenv(key, value)
		}
	}
	return nil
}

// CreateOrder creates a new order in Revolut and returns checkout URL
func (c *RevolutClient) CreateOrder(req CreateOrderRequest) (*RevolutOrder, error) {
	url := c.BaseURL + "/orders"

	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.SecretKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Revolut-Api-Version", c.APIVersion)

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("revolut API error (status %d): %s", resp.StatusCode, string(body))
	}

	var order RevolutOrder
	if err := json.Unmarshal(body, &order); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &order, nil
}

// GetOrder retrieves an order by ID
func (c *RevolutClient) GetOrder(orderID string) (*RevolutOrder, error) {
	url := c.BaseURL + "/orders/" + orderID

	httpReq, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.SecretKey)
	httpReq.Header.Set("Revolut-Api-Version", c.APIVersion)

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("revolut API error (status %d): %s", resp.StatusCode, string(body))
	}

	var order RevolutOrder
	if err := json.Unmarshal(body, &order); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &order, nil
}

// IsSandbox returns true if client is configured for sandbox
func (c *RevolutClient) IsSandbox() bool {
	return strings.Contains(c.BaseURL, "sandbox")
}
