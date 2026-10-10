// application_update_email_test.go
// Checks update-only delivery refusals and provider echo suppression.
// Connects real Postmark serialization to an in-memory HTTP transport and logs.
// Keeps legacy sign-in development delivery covered without external services.
package email

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"
)

type updateEmailTransport func(*http.Request) (*http.Response, error)

func (transport updateEmailTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type updateEmailFailedBody struct{}

func (updateEmailFailedBody) Read([]byte) (int, error) {
	return 0, errors.New("read echoed abc def ghj")
}
func (updateEmailFailedBody) Close() error { return nil }

func TestApplicationUpdateEmailNeverExposesProviderEchoes(t *testing.T) {
	for _, mode := range []string{"development", "invalid sender", "invalid recipient", "HTTP JSON failure", "HTTP raw failure", "provider refusal", "malformed response", "missing message ID", "read failure", "transport failure", "success"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", "dev")
			t.Setenv("POSTMARK_API_KEY", "token-canary")
			t.Setenv("POSTMARK_SERVER_TOKEN", "")
			t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
			t.Setenv("POSTMARK_FROM_ADDRESS", "")
			to := "recipient@example.invalid"
			if mode == "development" {
				t.Setenv("POSTMARK_API_KEY", "")
			}
			if mode == "invalid sender" {
				t.Setenv("EMAIL_FROM_ADDRESS", "abc def ghj")
			}
			if mode == "invalid recipient" {
				to = "abc def ghj"
			}
			var captured bytes.Buffer
			previousOutput, previousClient := log.Writer(), postmarkHTTPClient
			log.SetOutput(&captured)
			t.Cleanup(func() { log.SetOutput(previousOutput); postmarkHTTPClient = previousClient })
			postmarkHTTPClient = &http.Client{Timeout: previousClient.Timeout, Transport: updateEmailTransport(func(request *http.Request) (*http.Response, error) {
				status, body := http.StatusOK, `{"ErrorCode":0,"MessageID":"abc def ghj token-canary"}`
				switch mode {
				case "HTTP JSON failure":
					status, body = 503, `{"ErrorCode":300,"Message":"abc def ghj token-canary"}`
				case "HTTP raw failure":
					status, body = 503, "abc def ghj token-canary"
				case "provider refusal":
					body = `{"ErrorCode":300,"Message":"abc def ghj token-canary"}`
				case "malformed response":
					body = "abc def ghj token-canary"
				case "missing message ID":
					body = `{"ErrorCode":0,"Message":"abc def ghj token-canary"}`
				case "transport failure":
					return nil, errors.New("abc def ghj token-canary")
				}
				var responseBody io.ReadCloser = io.NopCloser(strings.NewReader(body))
				if mode == "read failure" {
					responseBody = updateEmailFailedBody{}
				}
				return &http.Response{StatusCode: status, Body: responseBody, Request: request}, nil
			})}
			err := SendApplicationUpdateOTPEmail(to, "abc def ghj")
			if mode == "success" {
				if err != nil {
					t.Fatal("provider acceptance refused")
				}
			} else if !errors.Is(err, ErrSecureDeliveryUnavailable) {
				t.Fatal("delivery failed without fixed refusal")
			}
			log.Printf("caller: %v", err)
			for _, secret := range []string{"abc def ghj", "abcdefghj", "token-canary"} {
				if strings.Contains(captured.String(), secret) {
					t.Fatal("update log or returned error exposed a canary")
				}
			}
			// The purpose guard also protects direct use of the shared helper.
			if mode == "development" && !errors.Is(SendOTPEmail(to, "abc def ghj", applicationUpdatePurpose), ErrSecureDeliveryUnavailable) {
				t.Fatal("direct update-purpose call reached development fallback")
			}
		})
	}
}

func TestSignInEmailKeepsDevelopmentFallback(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("POSTMARK_API_KEY", "")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	var captured bytes.Buffer
	previousOutput := log.Writer()
	log.SetOutput(&captured)
	t.Cleanup(func() { log.SetOutput(previousOutput) })
	if err := SendOTPEmail("user@example.invalid", "abc def ghj", "login"); err != nil || !strings.Contains(captured.String(), "abc def ghj") {
		t.Fatal("legacy sign-in fallback changed")
	}
}
