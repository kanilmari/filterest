// update_row_commit_test.go
// Runs the ordinary row-update handler through its real transaction middleware.
// Uses an in-memory SQL driver to force commit failure after a successful UPDATE.
// Proves no success body or operation-owned headers escape before the actual commit.
package dtt_1_row_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
)

type rowCommitDriver struct {
	response           *httptest.ResponseRecorder
	t                  *testing.T
	fail               bool
	updated, committed bool
}
type rowCommitConn struct{ state *rowCommitDriver }
type rowCommitTx struct{ state *rowCommitDriver }

func (d *rowCommitDriver) Open(string) (driver.Conn, error)             { return &rowCommitConn{d}, nil }
func (d *rowCommitDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d *rowCommitDriver) Driver() driver.Driver                        { return d }
func (*rowCommitConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*rowCommitConn) Close() error                { return nil }
func (c *rowCommitConn) Begin() (driver.Tx, error) { return rowCommitTx{c.state}, nil }
func (tx rowCommitTx) Commit() error {
	tx.state.committed = true
	if tx.state.response.Body.Len() != 0 || len(tx.state.response.Header().Values("Set-Cookie")) != 0 || tx.state.response.Header().Get("Location") != "" {
		tx.state.t.Error("ordinary row success escaped before commit")
	}
	if tx.state.fail {
		return errors.New("injected row commit failure")
	}
	return nil
}
func (rowCommitTx) Rollback() error { return nil }
func (c *rowCommitConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if strings.HasPrefix(query, `UPDATE "plain_rows" SET "title"`) {
		c.state.updated = true
	}
	return driver.RowsAffected(1), nil
}
func (*rowCommitConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	rows := &updRowRows{cols: []string{"value"}}
	switch {
	case strings.Contains(query, "multi_lang_embeddings"):
		rows.cols, rows.rows = []string{"general", "multilingual"}, [][]driver.Value{{false, false}}
	case strings.Contains(query, "SELECT table_uid"):
		rows.rows = [][]driver.Value{{int64(42)}}
	case strings.Contains(query, `SELECT "plain_rows"."id"`):
		rows.rows = [][]driver.Value{{int64(7)}}
	case strings.Contains(query, "SELECT editable_in_ui"):
		rows.rows = [][]driver.Value{{true}}
	case strings.Contains(query, "SELECT data_type"):
		rows.rows = [][]driver.Value{{"text"}}
	}
	return rows, nil
}

func TestOrdinaryRowUpdateReportsSuccessOnlyAfterCommit(t *testing.T) {
	for _, failure := range []bool{false, true} {
		t.Run(map[bool]string{false: "committed", true: "commit failed"}[failure], func(t *testing.T) {
			response := httptest.NewRecorder()
			state := &rowCommitDriver{response: response, t: t, fail: failure}
			db := sql.OpenDB(state)
			defer db.Close()
			oldDB, oldAdmin := backend.Db, backend.DbAdmin
			backend.Db, backend.DbAdmin = db, db
			defer func() { backend.Db, backend.DbAdmin = oldDB, oldAdmin }()
			request := buildUpdateRowSessionRequest(t, http.MethodPost, "/api/update-row?dataset=plain_rows", `{"id":7,"column":"title","value":"changed"}`)
			request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// These sentinel success headers also prove replacement discards all
				// output owned by the unsuccessful operation, including cookies.
				w.Header().Set("Location", "/saved-row")
				w.Header().Set("Content-Length", "999")
				http.SetCookie(w, &http.Cookie{Name: "row_saved", Value: "yes"})
				UpdateRowHandlerWrapper(w, r)
			})
			middlewares.WithLazyTransaction(handler).ServeHTTP(response, request)
			if !state.updated || !state.committed {
				t.Fatal("did not reach ordinary UPDATE and commit", state, response.Body.String())
			}
			if failure {
				if response.Code != 500 || !strings.Contains(response.Body.String(), "transaction commit failed") || strings.Contains(response.Body.String(), "Row updated successfully") || response.Header().Get("Location") != "" || response.Header().Get("Content-Length") != "" || len(response.Result().Cookies()) != 0 {
					t.Fatal("uncommitted row success escaped", response)
				}
			} else if response.Code != 200 || !strings.Contains(response.Body.String(), "Row updated successfully") || response.Header().Get("Location") != "/saved-row" {
				t.Fatal(response)
			}
		})
	}
}
