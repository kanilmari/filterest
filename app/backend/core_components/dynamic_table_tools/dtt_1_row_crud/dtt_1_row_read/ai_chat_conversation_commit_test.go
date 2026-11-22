// ai_chat_conversation_commit_test.go
// Exercises large histories through the real conversation handler and pool saver.
// Connects in-memory SQL persistence with request-transaction response delivery.
// Preserves full echoes and makes the independent pool-write boundary explicit.
package dtt_1_row_read

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/middlewares"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

type conversationCommitDriver struct {
	t              *testing.T
	response       *httptest.ResponseRecorder
	fail           bool
	commits, saves int
	messages       string
	updatedAt      time.Time
}
type conversationCommitConn struct {
	state *conversationCommitDriver
	inTx  bool
}
type conversationCommitTx struct{ conn *conversationCommitConn }
type conversationCommitRows struct{ values []driver.Value }

func (d *conversationCommitDriver) Open(string) (driver.Conn, error) {
	return &conversationCommitConn{state: d}, nil
}
func (d *conversationCommitDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d *conversationCommitDriver) Driver() driver.Driver                        { return d }
func (*conversationCommitConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*conversationCommitConn) Close() error { return nil }
func (c *conversationCommitConn) Begin() (driver.Tx, error) {
	c.inTx = true
	return conversationCommitTx{c}, nil
}
func (tx conversationCommitTx) Commit() error {
	tx.conn.inTx = false
	state := tx.conn.state
	state.commits++
	if state.response.Body.Len() != 0 {
		state.t.Error("conversation response escaped before request commit")
	}
	if state.fail {
		return errors.New("injected conversation request commit failure")
	}
	return nil
}
func (tx conversationCommitTx) Rollback() error { tx.conn.inTx = false; return nil }
func (*conversationCommitConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (c *conversationCommitConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rows := &conversationCommitRows{}
	if strings.Contains(query, "INSERT INTO ai_chat_conversations") {
		if c.inTx {
			c.state.t.Error("pool save unexpectedly joined the request transaction")
		}
		if args[0].Value != int64(2) || args[1].Value != "app_service_catalog" {
			c.state.t.Error("wrong conversation identity")
		}
		c.state.saves++
		c.state.messages = args[3].Value.(string)
		rows.values = []driver.Value{c.state.updatedAt}
	}
	return rows, nil
}
func (*conversationCommitRows) Columns() []string { return []string{"value"} }
func (*conversationCommitRows) Close() error      { return nil }
func (r *conversationCommitRows) Next(dest []driver.Value) error {
	if r.values == nil {
		return io.EOF
	}
	copy(dest, r.values)
	r.values = nil
	return nil
}

func TestAIChatConversationDeliversLargePoolSavedResponse(t *testing.T) {
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("large-handler-unit-test"))
	t.Cleanup(func() { esessions.Store = oldStore })
	for _, test := range []struct {
		name            string
		requestTx, fail bool
	}{
		{name: "pool save without request transaction"},
		{name: "request commit before delivery", requestTx: true},
		{name: "request commit failure replaces echo but cannot undo pool save", requestTx: true, fail: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			state := &conversationCommitDriver{t: t, response: response, fail: test.fail, updatedAt: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)}
			db := sql.OpenDB(state)
			oldDB, oldAdmin := backend.Db, backend.DbAdmin
			oldReader, oldSaver := aiChatConversationUserIDReader, aiChatConversationSaver
			backend.Db, backend.DbAdmin = db, db
			aiChatConversationUserIDReader = func(*http.Request) (int, error) { return 2, nil }
			aiChatConversationSaver = saveAIChatConversation
			t.Cleanup(func() {
				backend.Db, backend.DbAdmin = oldDB, oldAdmin
				aiChatConversationUserIDReader, aiChatConversationSaver = oldReader, oldSaver
				_ = db.Close()
			})
			payload := aiChatConversationPayload{Dataset: "app_service_catalog", Preview: "Large history"}
			for i := 0; i < 300; i++ {
				role := "user"
				if i%2 == 1 {
					role = "assistant"
				}
				payload.Messages = append(payload.Messages, aiChatConversationMessage{Role: role, Content: fmt.Sprintf("%03d:", i) + strings.Repeat("x", 4092)})
			}
			body, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			if len(body) <= 1<<20 || len(body) >= 10<<20 {
				t.Fatal("fixture must exceed former cap and fit the existing request limit")
			}
			request := httptest.NewRequest(http.MethodPut, "/api/app/ai-chat/conversation", bytes.NewReader(body))
			request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Model an earlier request stage opening a transaction. The real
				// saver must still write through its separate pool connection.
				if test.requestTx {
					if _, err := dbutils.RequireTxWithError(r.Context()); err != nil {
						t.Fatal(err)
					}
				}
				FilterbarAIConversationHandler(w, r)
				if response.Body.Len() != 0 {
					t.Error("conversation echo escaped before handler completion")
				}
			})
			middlewares.WithLazyTransaction(handler).ServeHTTP(response, request)
			if state.saves != 1 || state.commits != map[bool]int{false: 0, true: 1}[test.requestTx] {
				t.Fatalf("saves=%d commits=%d", state.saves, state.commits)
			}
			var stored []aiChatConversationMessage
			if err := json.Unmarshal([]byte(state.messages), &stored); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(stored, payload.Messages) {
				t.Fatal("real pool saver did not receive the full history")
			}
			if test.fail {
				if response.Code != 500 || !strings.Contains(response.Body.String(), "transaction commit failed") || strings.Contains(response.Body.String(), "messages") || strings.Contains(response.Body.String(), "000:") {
					t.Fatal("uncommitted conversation echo escaped")
				}
				return
			}
			if response.Code != 200 || response.Body.Len() <= 1<<20 {
				t.Fatalf("large echo not delivered: status=%d bytes=%d", response.Code, response.Body.Len())
			}
			var delivered aiChatConversationPayload
			if err := json.Unmarshal(response.Body.Bytes(), &delivered); err != nil {
				t.Fatal(err)
			}
			payload.UpdatedAt = &state.updatedAt
			if !reflect.DeepEqual(delivered, payload) {
				t.Fatal("conversation echo was truncated or changed")
			}
		})
	}
}
