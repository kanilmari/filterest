// payment_callback_deliverer.go
// Delivers signed payment-completion callbacks through a bounded HTTP request.
// Bridges completed gateway orders with the registered downstream application endpoint.
// Exists to isolate callback transport from payment request and webhook orchestration.
package payment_gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// triggerCallback signs and sends one bounded callback request without
// following redirects, then accepts only a successful HTTP response.
func triggerCallback(url, orderID, status string) error {
	payload := map[string]string{
		"revolut_order_id": orderID,
		"status":           status,
	}
	jsonData, _ := json.Marshal(payload)
	signature, err := SignPaymentCallbackPayload(jsonData)
	if err != nil {
		return fmt.Errorf("sign payment callback: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(jsonData))
	if err != nil {
		return fmt.Errorf("create payment callback request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(PaymentCallbackSignatureHeader, signature)

	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send payment callback to %s: %w", url, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("payment callback %s returned status %d", url, resp.StatusCode)
	}
	log.Printf("[payment-gateway] Triggered callback %s: status=%d", url, resp.StatusCode)
	return nil
}
