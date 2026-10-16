// sec4_read_boundary_test.go
// Keeps the payment-status GET a pure local read for every state.
// Uses a recording SQL driver and provider transport without network calls.
// Only a verified webhook may persist provider transitions or deliver callbacks.
package payment_gateway

import (
	"database/sql/driver"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type sec4PaymentTransport func(*http.Request) (*http.Response, error)

func (f sec4PaymentTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSEC4PaymentStatusGETHasNoSideEffects(t *testing.T) {
	calls := 0
	previous := revolutClient
	revolutClient = &RevolutClient{BaseURL: "https://provider.invalid", HTTPClient: &http.Client{Transport: sec4PaymentTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"state":"completed"}`)), Header: make(http.Header)}, nil
	})}}
	t.Cleanup(func() { revolutClient = previous })
	withPaymentCallbackDeliverer(t, func(string) (bool, error) { calls++; return true, nil })
	for _, state := range []string{"pending", "authorised", "completed"} {
		db, record := newWebhookTestDBWithQueryRow(1, []string{"id", "payment_token", "status", "amount_cents", "currency", "paid_at", "revolut_order_id", "created_at"}, []driver.Value{int64(1), "fixture", state, int64(100), "EUR", nil, "order-1", time.Now()})
		withDB(t, db)
		defer db.Close()
		rec := httptest.NewRecorder()
		GetPaymentStatusHandler(rec, httptest.NewRequest("GET", "/api/payments/fixture/status", nil))
		if rec.Code != 200 || calls != 0 || len(record.execQueries) != 0 {
			t.Errorf("%s: status=%d external=%d writes=%d", state, rec.Code, calls, len(record.execQueries))
		}
	}
}
