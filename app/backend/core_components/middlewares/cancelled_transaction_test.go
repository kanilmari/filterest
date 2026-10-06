// cancelled_transaction_test.go
// Proves a request its client abandons rolls back without an error log line.
// database/sql ends the context-bound transaction itself, so the middleware sees ErrTxDone.
// A handler that ends the request transaction on a live request is still logged.
package middlewares

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/logging"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

// waitForTxDone returns once database/sql has rolled back the cancelled transaction.
func waitForTxDone(t *testing.T, tx *sql.Tx) {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := tx.Exec("SELECT 1"); errors.Is(err, sql.ErrTxDone) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Error("database/sql did not roll back the cancelled request transaction")
}

func TestCancelledRequestTransactionIsNotLoggedAsFailure(t *testing.T) {
	cases := []struct {
		name    string
		handle  func(t *testing.T, w http.ResponseWriter, tx *sql.Tx, cancel context.CancelFunc)
		wantLog string
	}{
		{"client left before an error response", func(t *testing.T, w http.ResponseWriter, tx *sql.Tx, cancel context.CancelFunc) {
			cancel()
			waitForTxDone(t, tx)
			http.Error(w, "client left", http.StatusInternalServerError)
		}, ""},
		{"client left before commit", func(t *testing.T, w http.ResponseWriter, tx *sql.Tx, cancel context.CancelFunc) {
			cancel()
			w.WriteHeader(http.StatusNoContent)
		}, ""},
		{"handler ended a live transaction", func(t *testing.T, w http.ResponseWriter, tx *sql.Tx, cancel context.CancelFunc) {
			_ = tx.Rollback()
			http.Error(w, "handler error", http.StatusInternalServerError)
		}, "transaction rollback failed"},
	}
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("cancelled-request-test-key"))
	defer func() { esessions.Store = oldStore }()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var output bytes.Buffer
			logging.SetOutput(&output)
			defer logging.SetOutput(os.Stderr)
			admin := sql.OpenDB(loadDriver{})
			defer admin.Close()
			oldDB, oldAdmin := backend.Db, backend.DbAdmin
			backend.Db, backend.DbAdmin = admin, admin
			defer func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin }()

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			handler := WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tx, err := dbutils.RequireTxWithError(r.Context())
				if err != nil {
					t.Fatal(err)
				}
				c.handle(t, w, tx, cancel)
			}))
			request := httptest.NewRequest("POST", "/api/update-oids", nil)
			request = request.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(2, "admin")))
			handler.ServeHTTP(httptest.NewRecorder(), request)

			// The stub driver cannot answer txlog's function lookup; only the
			// transaction outcome lines are under test here.
			logged := output.String()
			if c.wantLog == "" && (strings.Contains(logged, "transaction rollback failed") || strings.Contains(logged, "transaction commit failed")) {
				t.Fatalf("cancelled request logged a transaction failure:\n%s", logged)
			}
			if c.wantLog != "" && !strings.Contains(logged, c.wantLog) {
				t.Fatalf("missing %q in:\n%s", c.wantLog, logged)
			}
			if admin.Stats().InUse != 0 {
				t.Fatal("request transaction leaked its connection")
			}
		})
	}
}
