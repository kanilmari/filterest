// recent_email_delivery_test.go
// Drives real update-factor issuance, delivery and consumption with canary secrets.
// Connects credential/OTP services to an in-memory SQL driver and mail transport.
// Proves refusals cannot leave usable codes or expose secrets in captured logs.
package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/otp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

const recentEmailCanary = "abcdefghj"

type recentEmailTransport func(*http.Request) (*http.Response, error)

func (transport recentEmailTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

// exerciseRecentEmailDelivery never replaces the mail helper or OTP operations.
// Only entropy, database connection and HTTP transport are controlled by tests.
func exerciseRecentEmailDelivery(t *testing.T, db *sql.DB, mode string, userID int, generation int64, password string) {
	t.Helper()
	originalDB, originalTransport, originalRandom := backend.DbConfidential, http.DefaultTransport, rand.Reader
	backend.DbConfidential = db
	rand.Reader = bytes.NewReader(bytes.Repeat([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8}, 512))
	t.Cleanup(func() {
		backend.DbConfidential, http.DefaultTransport, rand.Reader = originalDB, originalTransport, originalRandom
		logging.SetOutput(os.Stderr)
	})
	var captured bytes.Buffer
	logging.SetOutput(&captured)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("POSTMARK_API_KEY", "provider-token-canary")
	t.Setenv("POSTMARK_SERVER_TOKEN", "")
	t.Setenv("EMAIL_FROM_ADDRESS", "sender@example.invalid")
	t.Setenv("POSTMARK_FROM_ADDRESS", "")
	if mode == "development fallback" || mode == "missing provider" {
		t.Setenv("POSTMARK_API_KEY", "")
	}
	if mode == "missing provider" {
		t.Setenv("ENVIRONMENT_TYPE", "production")
	}
	if mode == "missing sender" {
		t.Setenv("EMAIL_FROM_ADDRESS", "")
	}
	sends := 0
	http.DefaultTransport = recentEmailTransport(func(request *http.Request) (*http.Response, error) {
		sends++
		var payload struct{ Subject, HtmlBody, TextBody string }
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal("mail request was not JSON")
		}
		if payload.Subject != "Sovelluspäivityksen vahvistuskoodi" || !strings.Contains(payload.TextBody, otp.FormatCode(recentEmailCanary)) || !strings.Contains(payload.HtmlBody, otp.FormatCode(recentEmailCanary)) {
			t.Fatal("mail used the wrong purpose or code")
		}
		// Even while the provider holds the request, no usable challenge exists.
		var usable int
		if err := db.QueryRow(`SELECT COUNT(*) FROM restricted.verification_codes WHERE user_id=$1 AND purpose='application_update' AND expires_at>NOW()`, userID).Scan(&usable); err != nil || usable != 0 {
			t.Fatal("challenge became usable before delivery acceptance")
		}
		if err := db.QueryRow(`SELECT COUNT(*) FROM restricted.verification_codes WHERE user_id=$1 AND purpose='application_update' AND expires_at>NOW()-INTERVAL '1 hour'`, userID).Scan(&usable); err != nil || usable != 0 {
			t.Fatal("an earlier verification transaction could use the pending challenge")
		}
		if mode == "transport failure" {
			return nil, errors.New("transport echoed " + recentEmailCanary + password + "provider-token-canary")
		}
		status, body := http.StatusOK, `{"ErrorCode":0,"MessageID":"`+recentEmailCanary+`"}`
		if mode == "send failure" || mode == "cleanup failure" {
			status, body = http.StatusServiceUnavailable, `{"ErrorCode":300,"Message":"`+otp.FormatCode(recentEmailCanary)+password+`provider-token-canary"}`
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})
	required, method, err := CheckRecentCredentials(context.Background(), userID, generation, password, "")
	if mode == "success" {
		if err != nil || !required || method != "email" || sends != 1 {
			t.Fatal("provider acceptance did not issue an update challenge")
		}
		if required, _, err = CheckRecentCredentials(context.Background(), userID, generation, password, recentEmailCanary); err != nil || required {
			t.Fatal("delivered update code was not consumed")
		}
		if _, _, err = CheckRecentCredentials(context.Background(), userID, generation, password, recentEmailCanary); !errors.Is(err, ErrRecentCredentials) {
			t.Fatal("consumed update code replay succeeded")
		}
	} else {
		if !errors.Is(err, ErrRecentCredentials) || required || method != "email" {
			t.Fatal("insecure/failed delivery did not refuse issuance")
		}
		log.Printf("caller refusal: %v", err)
		var usable int
		if err = db.QueryRow(`SELECT COUNT(*) FROM restricted.verification_codes WHERE user_id=$1 AND purpose='application_update' AND expires_at>NOW()`, userID).Scan(&usable); err != nil || usable != 0 {
			t.Fatal("failed delivery left a usable update code")
		}
		if _, _, err = CheckRecentCredentials(context.Background(), userID, generation, password, recentEmailCanary); err == nil {
			t.Fatal("undelivered canary authorized reauthentication")
		}
	}
	if mode == "development fallback" || mode == "missing provider" || mode == "missing sender" {
		if sends != 0 {
			t.Fatal("missing provider settings attempted delivery")
		}
	}
	for _, secret := range []string{recentEmailCanary, otp.FormatCode(recentEmailCanary), otp.HashCode(recentEmailCanary), password, "provider-token-canary"} {
		if strings.Contains(captured.String(), secret) {
			t.Fatal("captured update log exposed a canary secret")
		}
	}
	var remaining int
	if err = db.QueryRow(`SELECT COUNT(*) FROM restricted.verification_codes WHERE user_id=$1 AND purpose='application_update'`, userID).Scan(&remaining); err != nil || mode != "cleanup failure" && remaining != 0 {
		t.Fatal("failed or consumed challenge was not deleted")
	}
}

func TestRecentEmailDelivery(t *testing.T) {
	password := "recent-password-canary"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"development fallback", "missing provider", "missing sender", "send failure", "transport failure", "cleanup failure", "activation failure", "success"} {
		t.Run(mode, func(t *testing.T) {
			state := &recentEmailDatabase{passwordHash: string(hash), codeHash: otp.HashCode("older-update-canary"), active: true, deleteFailure: mode == "cleanup failure", activateFailure: mode == "activation failure"}
			db := sql.OpenDB(state)
			t.Cleanup(func() { db.Close() })
			exerciseRecentEmailDelivery(t, db, mode, 42, 3, password)
		})
	}
}

func exerciseDelayedRecentEmailDelivery(t *testing.T, db *sql.DB, lateSuccess bool) {
	t.Helper()
	originalDB, originalRandom := backend.DbConfidential, rand.Reader
	backend.DbConfidential = db
	rand.Reader = bytes.NewReader([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8})
	t.Cleanup(func() { backend.DbConfidential, rand.Reader = originalDB, originalRandom })
	err := otp.CreateOTPWithDelivery(42, otp.ProfileApplicationUpdate, "user@example.invalid", func(string) error {
		// Complete a newer resend before the first provider returns.
		rand.Reader = bytes.NewReader(bytes.Repeat([]byte{9}, otp.CodeLength))
		if err := otp.CreateOTPWithDelivery(42, otp.ProfileApplicationUpdate, "user@example.invalid", func(string) error { return nil }); err != nil {
			t.Fatal("newer resend could not activate")
		}
		if lateSuccess {
			return nil
		}
		return errors.New("late delivery failure")
	})
	if err == nil {
		t.Fatal("superseded delivery reported issuance success")
	}
	newer := strings.Repeat(string(otp.Charset[9]), otp.CodeLength)
	if result, err := otp.VerifyOTP(42, otp.ProfileApplicationUpdate, newer); err != nil || !result.IsVerified() {
		t.Fatal("delayed delivery activated or removed a newer resend")
	}
}

func TestRecentEmailDeliveryPreservesNewerResend(t *testing.T) {
	for _, lateSuccess := range []bool{false, true} {
		t.Run(fmt.Sprint(lateSuccess), func(t *testing.T) {
			db := sql.OpenDB(&recentEmailDatabase{})
			t.Cleanup(func() { db.Close() })
			exerciseDelayedRecentEmailDelivery(t, db, lateSuccess)
		})
	}
}

type recentEmailDatabase struct {
	passwordHash    string
	codeHash        string
	active          bool
	deleteFailure   bool
	activateFailure bool
}
type recentEmailConnection struct{ state *recentEmailDatabase }
type recentEmailTransaction struct {
	state  *recentEmailDatabase
	hash   string
	active bool
}

func (state *recentEmailDatabase) Connect(context.Context) (driver.Conn, error) {
	return &recentEmailConnection{state}, nil
}
func (state *recentEmailDatabase) Driver() driver.Driver { return state }
func (state *recentEmailDatabase) Open(string) (driver.Conn, error) {
	return state.Connect(context.Background())
}
func (*recentEmailConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*recentEmailConnection) Close() error { return nil }
func (conn *recentEmailConnection) Begin() (driver.Tx, error) {
	return &recentEmailTransaction{conn.state, conn.state.codeHash, conn.state.active}, nil
}
func (*recentEmailTransaction) Commit() error { return nil }
func (tx *recentEmailTransaction) Rollback() error {
	tx.state.codeHash, tx.state.active = tx.hash, tx.active
	return nil
}
func (conn *recentEmailConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	state := conn.state
	switch {
	case strings.Contains(query, "SELECT password"):
		return &credentialMockRows{cols: []string{"password", "method", "pin", "totp", "email", "generation", "api_only"}, vals: []driver.Value{state.passwordHash, "email", "", "", "user@example.invalid", int64(3), false}}, nil
	case strings.Contains(query, "SELECT COUNT(*) FROM restricted.verification_codes"):
		count := int64(0)
		if state.codeHash != "" && (!strings.Contains(query, "expires_at>NOW()") || state.active) {
			count = 1
		}
		return &credentialMockRows{cols: []string{"count"}, vals: []driver.Value{count}}, nil
	case strings.Contains(query, "SELECT COUNT(*)"):
		return &credentialMockRows{cols: []string{"count", "retry"}, vals: []driver.Value{int64(0), float64(0)}}, nil
	case strings.Contains(query, "SELECT id, code_hash"):
		return &credentialMockRows{cols: []string{"id", "hash", "email", "attempts", "max_attempts", "expired"}, vals: []driver.Value{int64(1), state.codeHash, "user@example.invalid", int64(0), int64(5), !state.active}, done: state.codeHash == ""}, nil
	default:
		return nil, fmt.Errorf("unexpected query")
	}
}
func (conn *recentEmailConnection) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	state := conn.state
	switch {
	case strings.Contains(query, "INSERT INTO restricted.verification_codes"):
		if args[1].Value != "application_update" {
			return nil, errors.New("wrong purpose")
		}
		state.codeHash, state.active = args[2].Value.(string), args[5].Value.(int64) > 0
	case strings.Contains(query, "SET created_at = NOW()"):
		if state.activateFailure {
			return nil, errors.New("activation failed")
		}
		if state.codeHash != args[2].Value || state.active {
			return driver.RowsAffected(0), nil
		}
		state.active = true
	case strings.Contains(query, "DELETE FROM restricted.verification_codes"):
		if state.deleteFailure {
			return nil, errors.New("cleanup failed")
		}
		if len(args) == 3 && state.codeHash != args[2].Value {
			return driver.RowsAffected(0), nil
		}
		state.codeHash, state.active = "", false
	}
	return driver.RowsAffected(1), nil
}
