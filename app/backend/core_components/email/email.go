// email.go
// Sends transactional emails via Postmark API; falls back to console logging only in explicit dev mode.
// Bridges the OTP and authentication flows and the Postmark HTTP API.
// Exists to isolate all outbound email logic so callers never reference the transport provider directly.

package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"
)

type postmarkRequest struct {
	From     string           `json:"From"`
	To       string           `json:"To"`
	Subject  string           `json:"Subject"`
	HtmlBody string           `json:"HtmlBody"`
	TextBody string           `json:"TextBody,omitempty"`
	Headers  []postmarkHeader `json:"Headers,omitempty"`
}

type postmarkResponse struct {
	To        string `json:"To"`
	MessageID string `json:"MessageID"`
	ErrorCode int    `json:"ErrorCode"`
	Message   string `json:"Message"`
}

type postmarkHeader struct {
	Name  string `json:"Name"`
	Value string `json:"Value"`
}

// postmarkURL is the Postmark API endpoint. Package-level var to allow test overrides.
var postmarkURL = "https://api.postmarkapp.com/email"

// postmarkHTTPClient is package-scoped so tests can inject transport behavior.
var postmarkHTTPClient = &http.Client{Timeout: 15 * time.Second}

// purposeSubjects maps OTP purpose to email subject line.
var purposeSubjects = map[string]string{
	"login":           "Kirjautumisen vahvistuskoodi",
	"email_change":    "Sähköpostiosoitteen vaihdon vahvistus",
	"password_change": "Salasanan vaihdon vahvistus",
	"password_reset":  "Salasanan palautuksen vahvistuskoodi",
}

// firstConfiguredEnv resolves the first non-empty env value from a migration-safe key list.
func firstConfiguredEnv(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

// SendOTPEmail sends a verification code email for the given purpose.
// In dev-mode (POSTMARK_API_KEY empty), the code is logged to console.
func SendOTPEmail(to, formattedCode, purpose string) error {
	apiKey := firstConfiguredEnv("POSTMARK_API_KEY", "POSTMARK_SERVER_TOKEN")
	if apiKey == "" && isExplicitDevEmailMode() {
		log.Printf("\033[33m[email] DEV-MODE: OTP for %s → %s: %s\033[0m", purpose, to, formattedCode)
		return nil
	}
	if apiKey == "" {
		return fmt.Errorf("POSTMARK_API_KEY not configured (legacy POSTMARK_SERVER_TOKEN is also accepted)")
	}

	fromAddress := firstConfiguredEnv("EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS")
	if fromAddress == "" {
		return fmt.Errorf("EMAIL_FROM_ADDRESS not configured (legacy POSTMARK_FROM_ADDRESS is also accepted)")
	}
	if err := validateMailboxAddress("from address", fromAddress); err != nil {
		return err
	}
	if err := validateMailboxAddress("recipient address", to); err != nil {
		return err
	}

	subject, ok := purposeSubjects[purpose]
	if !ok {
		subject = "Vahvistuskoodi"
	}

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:20px;">
<p>Vahvistuskoodisi on:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:2px;padding:16px;background:#f4f4f4;display:inline-block;border-radius:8px;">%s</p>
<p>Koodi vanhenee 5 minuutissa.</p>
<p style="color:#888;font-size:12px;">Jos et pyytänyt tätä koodia, voit jättää tämän viestin huomiotta.</p>
</body></html>`, formattedCode)
	textBody := fmt.Sprintf("Vahvistuskoodisi on: %s\n\nKoodi vanhenee 5 minuutissa.\nJos et pyytänyt tätä koodia, voit jättää tämän viestin huomiotta.", formattedCode)

	reqBody := postmarkRequest{
		From:     fromAddress,
		To:       strings.TrimSpace(to),
		Subject:  subject,
		HtmlBody: htmlBody,
		TextBody: textBody,
		Headers: []postmarkHeader{
			{Name: "Auto-Submitted", Value: "auto-generated"},
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal email request: %w", err)
	}

	req, err := http.NewRequest("POST", postmarkURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create email request: %w", err)
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Postmark-Server-Token", apiKey)

	resp, err := postmarkHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read postmark response: %w", err)
	}

	var pmResp postmarkResponse
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		if err := json.Unmarshal(responseBody, &pmResp); err == nil {
			return fmt.Errorf("postmark request failed with status %d (error %d): %s", resp.StatusCode, pmResp.ErrorCode, strings.TrimSpace(pmResp.Message))
		}
		return fmt.Errorf("postmark request failed with status %d: %s", resp.StatusCode, summarizePostmarkResponseBody(responseBody))
	}

	if err := json.Unmarshal(responseBody, &pmResp); err != nil {
		return fmt.Errorf("failed to decode postmark response: %w", err)
	}

	if pmResp.ErrorCode != 0 {
		return fmt.Errorf("postmark error %d: %s", pmResp.ErrorCode, pmResp.Message)
	}
	if strings.TrimSpace(pmResp.MessageID) == "" {
		return fmt.Errorf("postmark response missing MessageID")
	}

	log.Printf("[email] OTP email sent to %s (purpose=%s, messageID=%s)", to, purpose, pmResp.MessageID)
	return nil
}

func isExplicitDevEmailMode() bool {
	return strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")) == "dev"
}

func validateMailboxAddress(label, address string) error {
	trimmed := strings.TrimSpace(address)
	if trimmed == "" {
		return fmt.Errorf("%s is required", label)
	}
	if _, err := mail.ParseAddress(trimmed); err != nil {
		return fmt.Errorf("invalid %s %q: %w", label, address, err)
	}
	return nil
}

func summarizePostmarkResponseBody(body []byte) string {
	trimmed := strings.Join(strings.Fields(strings.TrimSpace(string(body))), " ")
	if trimmed == "" {
		return "empty response body"
	}
	if len(trimmed) > 200 {
		return trimmed[:200] + "..."
	}
	return trimmed
}
