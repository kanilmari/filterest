// card_visibility_commit_response_test.go
// Proves card saves withhold HTTP output until post-commit invalidation completes.
// Connects the real handler and transaction/response middleware to an in-memory SQL driver.
// Bounds blocked hooks and request completion without a database or network socket.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants/granttest"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestCardVisibilitySaveWithholdsResponseUntilPostCommitHooks(t *testing.T) {
	previousStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("card-visibility-commit-test"))
	defer func() { esessions.Store = previousStore }()
	for _, flag := range []string{`"hide_everywhere":true`, `"client_delivery_mode":"server_only"`} {
		t.Run(flag, func(t *testing.T) {
			// Each case, including its blocked hook and cleanup, has a five-second budget.
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			state := &cardStyleWriteState{}
			db := sql.OpenDB(cardVisibilityCommitConnector{state})
			defer db.Close()
			previousDB, previousAdmin := backend.Db, backend.DbAdmin
			backend.Db, backend.DbAdmin = db, db
			defer func() { backend.Db, backend.DbAdmin = previousDB, previousAdmin }()

			entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			defer func() {
				unblock()
				select {
				case <-done:
				case <-ctx.Done():
					t.Error("card save did not finish within its deadline")
				}
			}()
			handler := middlewares.WithLazyTransaction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Register before the real handler's invalidation, preventing eviction
				// after commit until the test permits all remaining hooks to run.
				if !dbutils.RegisterAfterCommitHook(r.Context(), func() {
					close(entered)
					select {
					case <-release:
					case <-ctx.Done():
					}
				}) {
					http.Error(w, "missing transaction middleware", http.StatusInternalServerError)
					return
				}
				UpdateCardVisibilityHandler(w, r)
			}))
			column := `{"column_uid":1,` + flag + `}`
			if strings.Contains(flag, "hide_everywhere") {
				column = `{"column_uid":1,"client_delivery_mode":"include",` + flag + `}`
			}
			body := `{"table_name":"style_fixture","columns":[{"column_uid":2,"client_delivery_mode":"include"},` + column + `]}`
			request := httptest.NewRequest(http.MethodPost, "/api/card-visibility/update", strings.NewReader(body))
			request = request.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(42, "admin")))
			response := &cardVisibilityCommitRecorder{ResponseRecorder: httptest.NewRecorder()}
			go func() {
				defer close(done)
				handler.ServeHTTP(response, request)
			}()
			select {
			case <-entered:
			case <-done:
				t.Fatalf("card save ended without reaching post-commit hook: %d %s", response.Code, response.Body)
			case <-ctx.Done():
				t.Fatal("post-commit hook was not reached within its deadline")
			}
			if state.columnWrites != 4 || state.commits != 1 {
				t.Fatalf("hook did not follow the committed flag write: %#v", state)
			}
			response.mu.Lock()
			statusWrites, bodyBytes := response.statusWrites, response.Body.Len()
			response.mu.Unlock()
			if statusWrites != 0 || bodyBytes != 0 {
				t.Fatalf("response escaped while invalidation was blocked: %d status writes, %d body bytes", statusWrites, bodyBytes)
			}
			unblock()
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal("card response was not released within its deadline")
			}
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ok"`) || response.statusWrites != 1 {
				t.Fatalf("released response = %d %s (status writes %d)", response.Code, response.Body, response.statusWrites)
			}
		})
	}
}

// Keep the existing card SQL fixture strict; permit only middleware setup here.
type cardVisibilityCommitConnector struct{ state *cardStyleWriteState }

func (c cardVisibilityCommitConnector) Connect(context.Context) (driver.Conn, error) {
	return &cardVisibilityCommitConn{&cardStyleWriteConn{c.state}}, nil
}
func (c cardVisibilityCommitConnector) Driver() driver.Driver {
	return &cardStyleWriteDriver{c.state}
}

type cardVisibilityCommitConn struct{ *cardStyleWriteConn }

func (c *cardVisibilityCommitConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.HasPrefix(query, fieldViewColumnGuardQuery) {
		return &cardVisibilityCommitGuards{
			cardStyleWriteRows: cardStyleWriteRows{values: []driver.Value{int64(2), "id", "", false, "include"}},
			next:               []driver.Value{int64(1), "label", "", false, "include"},
		}, nil
	}
	return c.cardStyleWriteConn.QueryContext(ctx, query, args)
}

func (c *cardVisibilityCommitConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if granttest.IsPolicyLock(query) || strings.Contains(query, "set_config('app.user_id'") {
		return driver.RowsAffected(1), nil
	}
	return c.cardStyleWriteConn.ExecContext(ctx, query, args)
}

type cardVisibilityCommitGuards struct {
	cardStyleWriteRows
	next []driver.Value
}

func (r *cardVisibilityCommitGuards) Next(values []driver.Value) error {
	if r.consumed && r.next != nil {
		r.values, r.next, r.consumed = r.next, nil, false
	}
	return r.cardStyleWriteRows.Next(values)
}

// Count actual writes: ResponseRecorder.Code defaults to 200 even before output.
type cardVisibilityCommitRecorder struct {
	*httptest.ResponseRecorder
	mu           sync.Mutex
	statusWrites int
}

func (w *cardVisibilityCommitRecorder) WriteHeader(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.statusWrites++
	w.ResponseRecorder.WriteHeader(status)
}
func (w *cardVisibilityCommitRecorder) Write(body []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ResponseRecorder.Write(body)
}
