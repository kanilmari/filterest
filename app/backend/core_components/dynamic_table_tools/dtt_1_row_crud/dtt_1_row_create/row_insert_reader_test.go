// row_insert_reader_test.go
// Unit tests for row_insert_reader.go.
// Covers pure helper functions and DB-backed lookup functions using the queue-based mock driver defined in mock_db_test.go.
package dtt_1_row_create

import (
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"

	gorillaSessions "github.com/gorilla/sessions"
)

var rowInsertReaderTestKey = []byte("row-insert-reader-test-key-32-bytes")

func buildRequestWithSessionValues(t *testing.T, values map[interface{}]interface{}) *http.Request {
	t.Helper()

	origStore := e_sessions.Store
	origName := e_sessions.SessionName
	store := gorillaSessions.NewCookieStore(rowInsertReaderTestKey)
	store.Options = &gorillaSessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true, Secure: false}
	e_sessions.Store = store
	e_sessions.SessionName = "session"
	t.Cleanup(func() {
		e_sessions.Store = origStore
		e_sessions.SessionName = origName
	})

	cookieW := httptest.NewRecorder()
	cookieR := httptest.NewRequest(http.MethodGet, "/", nil)
	sess, err := store.Get(cookieR, e_sessions.SessionName)
	if err != nil {
		t.Fatalf("setup: store.Get: %v", err)
	}
	for key, value := range values {
		sess.Values[key] = value
	}
	if saveErr := sess.Save(cookieR, cookieW); saveErr != nil {
		t.Fatalf("setup: sess.Save: %v", saveErr)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, c := range cookieW.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}

// ── isDateLikeType ───────────────────────────────────────────────────────────

func TestIsDateLikeType(t *testing.T) {
	tests := []struct {
		dataType string
		want     bool
	}{
		// Positive cases
		{"date", true},
		{"DATE", true},
		{"Date", true},
		{"timestamp", true},
		{"TIMESTAMP", true},
		{"Timestamp", true},
		{"timestamp with time zone", true},
		{"timestamp without time zone", true},
		{"timestamptz", true},
		{"date_created", true},     // contains "date"
		{"update_timestamp", true}, // contains "timestamp"
		// Negative cases
		{"integer", false},
		{"text", false},
		{"varchar", false},
		{"boolean", false},
		{"float", false},
		{"bigint", false},
		{"", false},
		{"numeric", false},
		{"jsonb", false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.dataType, func(t *testing.T) {
			got := isDateLikeType(tc.dataType)
			if got != tc.want {
				t.Errorf("isDateLikeType(%q) = %v, want %v", tc.dataType, got, tc.want)
			}
		})
	}
}

// ── isIntegerType ────────────────────────────────────────────────────────────

func TestIsIntegerType(t *testing.T) {
	tests := []struct {
		dataType string
		want     bool
	}{
		// Positive cases
		{"integer", true},
		{"INTEGER", true},
		{"Integer", true},
		{"int", true},
		{"INT", true},
		{"bigint", true},
		{"BIGINT", true},
		{"smallint", true},
		{"int4", true},
		{"int8", true},
		{"serial", false}, // "serial" does not contain "int"
		// Negative cases
		{"text", false},
		{"varchar", false},
		{"boolean", false},
		{"float", false},
		{"date", false},
		{"timestamp", false},
		{"", false},
		{"numeric", false},
		{"jsonb", false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.dataType, func(t *testing.T) {
			got := isIntegerType(tc.dataType)
			if got != tc.want {
				t.Errorf("isIntegerType(%q) = %v, want %v", tc.dataType, got, tc.want)
			}
		})
	}
}

// ── mustJSON ─────────────────────────────────────────────────────────────────

func TestMustJSON(t *testing.T) {
	t.Run("nil value", func(t *testing.T) {
		b := mustJSON(nil)
		if string(b) != "null" {
			t.Errorf("mustJSON(nil) = %q, want %q", b, "null")
		}
	})

	t.Run("string value", func(t *testing.T) {
		b := mustJSON("hello")
		if string(b) != `"hello"` {
			t.Errorf("mustJSON(%q) = %q, want %q", "hello", b, `"hello"`)
		}
	})

	t.Run("integer value", func(t *testing.T) {
		b := mustJSON(42)
		if string(b) != "42" {
			t.Errorf("mustJSON(42) = %q, want %q", b, "42")
		}
	})

	t.Run("map value", func(t *testing.T) {
		m := map[string]int{"a": 1}
		b := mustJSON(m)
		var got map[string]int
		if err := json.Unmarshal(b, &got); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if got["a"] != 1 {
			t.Errorf("mustJSON map: got %v, want {a:1}", got)
		}
	})

	t.Run("empty slice", func(t *testing.T) {
		b := mustJSON([]string{})
		if string(b) != "[]" {
			t.Errorf("mustJSON([]) = %q, want %q", b, "[]")
		}
	})

	t.Run("nested struct", func(t *testing.T) {
		type Inner struct {
			Name string `json:"name"`
			Val  int    `json:"val"`
		}
		b := mustJSON(Inner{Name: "test", Val: 7})
		expected := `{"name":"test","val":7}`
		if string(b) != expected {
			t.Errorf("mustJSON(struct) = %q, want %q", b, expected)
		}
	})

	t.Run("returns non-nil byte slice", func(t *testing.T) {
		b := mustJSON("x")
		if b == nil {
			t.Error("mustJSON should never return nil")
		}
	})
}

// ── getTableUID ──────────────────────────────────────────────────────────────

func TestGetTableUID(t *testing.T) {
	t.Cleanup(resetQueues)

	t.Run("found", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushQuery(queuedQuery{
			cols: []string{"table_uid"},
			rows: [][]driver.Value{{"abc-123"}},
		})

		uid, err := getTableUID("my_table", db)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uid != "abc-123" {
			t.Errorf("uid = %q, want %q", uid, "abc-123")
		}
	})

	t.Run("not found returns error", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		// Empty rows → sql.ErrNoRows
		pushQuery(queuedQuery{
			cols: []string{"table_uid"},
			rows: nil,
		})

		_, err := getTableUID("no_such_table", db)
		if err == nil {
			t.Error("expected error for missing table, got nil")
		}
	})
}

// ── getTableNameFromUID ──────────────────────────────────────────────────────

func TestGetTableNameFromUID(t *testing.T) {
	t.Cleanup(resetQueues)

	t.Run("found", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushQuery(queuedQuery{
			cols: []string{"table_name"},
			rows: [][]driver.Value{{"users"}},
		})

		name, err := getTableNameFromUID("uid-999", db)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if name != "users" {
			t.Errorf("name = %q, want %q", name, "users")
		}
	})

	t.Run("not found returns error", func(t *testing.T) {
		db := newTestDB(t)
		defer db.Close()

		pushQuery(queuedQuery{
			cols: []string{"table_name"},
			rows: nil,
		})

		_, err := getTableNameFromUID("missing-uid", db)
		if err == nil {
			t.Error("expected error for missing UID, got nil")
		}
	})
}

// ── isDateLikeType + isIntegerType boundary cases ───────────────────────────

// TestTypeHelpers_NoCrossContamination ensures that date-like and integer
// detection are independent and don't produce false matches on each other's
// keywords.
func TestTypeHelpers_NoCrossContamination(t *testing.T) {
	if isDateLikeType("integer") {
		t.Error("isDateLikeType should return false for 'integer'")
	}
	if isIntegerType("timestamp") {
		t.Error("isIntegerType should return false for 'timestamp'")
	}
	if isIntegerType("date") {
		t.Error("isIntegerType should return false for 'date'")
	}
}

// ── getCurrentUserID ────────────────────────────────────────────────────────

func TestGetCurrentUserID(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"user_id": 77})
		userID, err := getCurrentUserID(req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if userID != 77 {
			t.Fatalf("userID = %d, want 77", userID)
		}
	})

	t.Run("missing user_id returns error", func(t *testing.T) {
		req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"username": "alice"})
		_, err := getCurrentUserID(req)
		if err == nil {
			t.Fatal("expected error for missing user_id")
		}
	})

	t.Run("wrong user_id type returns error", func(t *testing.T) {
		req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"user_id": "77"})
		_, err := getCurrentUserID(req)
		if err == nil {
			t.Fatal("expected error for wrong user_id type")
		}
	})
}

// ── getCurrentUsername ──────────────────────────────────────────────────────

func TestGetCurrentUsername(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"username": "alice"})
		username, err := getCurrentUsername(req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if username != "alice" {
			t.Fatalf("username = %q, want %q", username, "alice")
		}
	})

	t.Run("missing username returns error", func(t *testing.T) {
		req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"user_id": 42})
		_, err := getCurrentUsername(req)
		if err == nil {
			t.Fatal("expected error for missing username")
		}
	})

	t.Run("wrong username type returns error", func(t *testing.T) {
		req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"username": 42})
		_, err := getCurrentUsername(req)
		if err == nil {
			t.Fatal("expected error for wrong username type")
		}
	})
}
