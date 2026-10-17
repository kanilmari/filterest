// declared_language_contract_test.go
// Verifies each account-mail status is both produced and explicitly declared.
// Connects the in-memory mail transport to the browser-visible status contract.
// Keeps this proof independent of a database or network listener.
package email

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"easelect/backend/core_components/lang_key_naming"
)

func TestDeclaredAccountMailStatusesMatchProducer(t *testing.T) {
	raw, err := os.ReadFile("account_email.go")
	if err != nil {
		t.Fatal(err)
	}
	declared := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, lang_key_naming.DeclarationMarker) {
			continue
		}
		d, err := lang_key_naming.ParseDeclaration("account_email.go", line)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range d.Names() {
			declared[key] = true
		}
	}
	old := postmarkHTTPClient
	t.Cleanup(func() { postmarkHTTPClient = old })
	for _, welcome := range []bool{true, false} {
		for _, status := range []string{"not_configured", "failed", "sent"} {
			t.Setenv("POSTMARK_API_KEY", "fixture")
			t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
			if status == "not_configured" {
				t.Setenv("POSTMARK_API_KEY", "")
				t.Setenv("POSTMARK_SERVER_TOKEN", "")
			}
			postmarkHTTPClient = &http.Client{Transport: accountMailRoundTrip(func(*http.Request) (*http.Response, error) {
				body := `{"ErrorCode":0,"MessageID":"fixture"}`
				code := 200
				if status == "failed" {
					code = 422
				}
				return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			got := SendAccountNotice(context.Background(), nil, "reader@example.invalid", "", welcome)
			prefix := "notice_email_"
			if welcome {
				prefix = "registration_email_"
			}
			if got != prefix+status || !declared[got] {
				t.Fatalf("status %q is not the declared producer result", got)
			}
			delete(declared, got)
		}
	}
	if len(declared) != 0 {
		t.Fatal("declaration includes unproduced statuses", declared)
	}
}
