// account_email_test.go
// Verifies private mail content, HTML escaping and content-free delivery errors.
// Bridges the account mail transport and a local in-memory HTTP RoundTripper.
// Exists to check reset mail without opening a network socket or logging its login name.
package email

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"
)

type accountMailRoundTrip func(*http.Request) (*http.Response, error)

func (transport accountMailRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) {
	return transport(r)
}

func TestOTPRecipientLogsAreMasked(t *testing.T) {
	var output bytes.Buffer
	oldOutput := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(oldOutput) })
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	t.Setenv("POSTMARK_API_KEY", "")
	const address = "privatecanary@example.invalid"
	if err := SendOTPEmail(address, "abc def ghi", "login"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("POSTMARK_API_KEY", "fixture-token")
	t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
	oldClient := postmarkHTTPClient
	t.Cleanup(func() { postmarkHTTPClient = oldClient })
	postmarkHTTPClient = &http.Client{Transport: accountMailRoundTrip(func(r *http.Request) (*http.Response, error) {
		var delivered postmarkRequest
		if err := json.NewDecoder(r.Body).Decode(&delivered); err != nil || delivered.To != address {
			t.Fatal("recipient changed", err)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ErrorCode":0,"MessageID":"fixture"}`))}, nil
	})}
	if err := SendOTPEmail(address, "abc def ghi", "login"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "privatecanary") || strings.Count(output.String(), "p***@example.invalid") != 2 {
		t.Fatal("recipient address leaked in OTP logs")
	}
}

func TestAccountResetMailContainsPrivateNameAndHidesProviderEcho(t *testing.T) {
	t.Setenv("POSTMARK_API_KEY", "fixture-token")
	t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
	old := postmarkHTTPClient
	t.Cleanup(func() { postmarkHTTPClient = old })
	status := 200
	postmarkHTTPClient = &http.Client{Transport: accountMailRoundTrip(func(r *http.Request) (*http.Response, error) {
		var mail postmarkRequest
		if err := json.NewDecoder(r.Body).Decode(&mail); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(mail.TextBody, "private<canary>") || !strings.Contains(mail.HtmlBody, "private&lt;canary&gt;") || !strings.Contains(mail.TextBody, "abc def ghj") {
			t.Fatal("reset mail content missing or unescaped")
		}
		body := `{"ErrorCode":0,"MessageID":"fixture"}`
		if status != 200 {
			body = `{"Message":"private<canary>","ErrorCode":400}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	if err := SendPasswordResetEmail("owner@example.invalid", "abc def ghj", "private<canary>", "Reset", "Login name", "Code"); err != nil {
		t.Fatal(err)
	}
	status = 422
	err := SendPasswordResetEmail("owner@example.invalid", "abc def ghj", "private<canary>", "Reset", "Login name", "Code")
	if err == nil || strings.Contains(err.Error(), "canary") {
		t.Fatalf("unsafe provider error: %v", err)
	}
}
