// add_row_provenance_test.go
// Proves a missing display-name label cannot prevent the real insert flow.
// Connects the replaceable name reader and session to SQL argument inspection.
// Keeps account ids and guest labels unchanged without starting PostgreSQL.
package dtt_1_row_create

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
)

func TestInsertProvenanceNameCannotFailSave(t *testing.T) {
	for _, tc := range []struct {
		name    string
		userID  int
		value   string
		err     error
		timeout bool
		want    string
	}{
		{name: "lookup error", userID: 42, err: errors.New("user table unavailable"), want: "unknown"},
		{name: "lookup deadline", userID: 42, timeout: true, want: "unknown"},
		{name: "empty name", userID: 42, want: "unknown"},
		{name: "whitespace name", userID: 42, value: " \t ", want: "unknown"},
		{name: "normal name", userID: 42, value: "alice", want: "alice"},
		{name: "guest", userID: 1},
		{name: "zero id", userID: 0},
		{name: "negative id", userID: -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetQueues()
			t.Cleanup(resetQueues)
			db, metadataDB := newTestDB(t), newTestDB(t)
			t.Cleanup(func() { _ = db.Close(); _ = metadataDB.Close() })
			originalDB, originalLookup := backend.Db, currentUserDisplayName
			backend.Db = metadataDB
			t.Cleanup(func() { backend.Db = originalDB; currentUserDisplayName = originalLookup })
			lookups := 0
			currentUserDisplayName = func(ctx context.Context, userID int) (string, error) {
				lookups++
				if userID != tc.userID || userID <= 1 {
					t.Fatalf("unexpected name lookup for id %d", userID)
				}
				if tc.timeout {
					// Shorten only the lookup's context: its deadline must not
					// cancel the request or the subsequent transactional write.
					ctx, cancel := context.WithTimeout(ctx, 5*time.Millisecond)
					defer cancel()
					<-ctx.Done()
					return "", ctx.Err()
				}
				return tc.value, tc.err
			}
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			push := func(fragment string, q queuedQuery) {
				q.inspect = func(query string, _ []driver.Value) error {
					if !strings.Contains(query, fragment) {
						return fmt.Errorf("expected query containing %q, got %s", fragment, query)
					}
					return nil
				}
				pushQuery(q)
			}

			push("app_row_actor_column", queuedQuery{cols: []string{"column_name", "actor_role"}, rows: [][]driver.Value{{"created_by", "creator"}, {"owner_id", "owner"}}})
			pushQuery(provenanceColumnMetadata())
			want := map[string]driver.Value{"user_id": int64(tc.userID), "cached_username": tc.want, "created_by": nil, "owner_id": nil}
			if tc.userID > 1 {
				want["created_by"], want["owner_id"] = int64(tc.userID), int64(tc.userID)
			}
			inserted := false
			pushQuery(queuedQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(81)}}, inspect: func(query string, args []driver.Value) error {
				prefix := `INSERT INTO "notes" (`
				end := strings.Index(query, ") VALUES (")
				if !strings.HasPrefix(query, prefix) || end < len(prefix) {
					return fmt.Errorf("expected notes INSERT, got %s", query)
				}
				columns := strings.Split(query[len(prefix):end], ", ")
				if len(columns) != len(args) {
					return fmt.Errorf("insert columns/arguments differ: %v / %v", columns, args)
				}
				stored := map[string]driver.Value{}
				for i, column := range columns {
					stored[strings.Trim(column, `"`)] = args[i]
				}
				if !reflect.DeepEqual(stored, want) {
					return fmt.Errorf("stored provenance = %#v, want %#v", stored, want)
				}
				inserted = true
				return nil
			}})
			push("search_vector_simple", queuedQuery{cols: []string{"exists"}})               // no search vector
			push("SELECT DISTINCT tgt.table_name", queuedQuery{cols: []string{"table_name"}}) // not a gallery child
			push("target_insert_specs", queuedQuery{cols: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"}})
			push("src.table_name, fk.source_column_name", queuedQuery{cols: []string{"table_name", "source_column_name"}})
			push("information_schema.tables", queuedQuery{cols: []string{"exists"}, rows: [][]driver.Value{{false}}}) // no gallery table
			push(`SELECT * FROM "notes"`, queuedQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(81)}}})
			push("system_triggers", queuedQuery{cols: []string{"exists"}, rows: [][]driver.Value{{false}}}) // no triggers

			req := buildRequestWithSessionValues(t, map[interface{}]interface{}{"user_id": tc.userID, "user_role": "basic", "username": "stale-copy"})
			rec := httptest.NewRecorder()
			id, children, err := insertDataAccordingToPayload(rec, req, "notes", "42", map[string]interface{}{}, tx)
			if err != nil || rec.Code != http.StatusOK || id != 81 || len(children) != 0 || !inserted {
				t.Fatalf("insert: id=%d children=%v status=%d inserted=%t error=%v body=%s", id, children, rec.Code, inserted, err, rec.Body)
			}
			if req.Context().Err() != nil {
				t.Fatal("name lookup cancelled the request")
			}
			wantLookups := 0
			if tc.userID > 1 {
				wantLookups = 1
			}
			if lookups != wantLookups || len(queryQueue) != 0 || len(execQueue) != 0 {
				t.Fatalf("lookups=%d (want %d), unused queries=%d execs=%d", lookups, wantLookups, len(queryQueue), len(execQueue))
			}
		})
	}
}

func provenanceColumnMetadata() queuedQuery {
	columns := []string{"column_name", "data_type", "is_nullable", "column_default", "is_identity", "generation_expression", "foreign_table_schema", "foreign_table_name", "foreign_column_name", "udt_name", "insert_new_target_with_source", "insert_new_source_with_target", "source_insert_specs", "target_insert_specs", "insertable", "is_multilingual", "multilingual_languages"}
	return queuedQuery{cols: columns, rows: [][]driver.Value{
		{"user_id", "integer", "YES", nil, "NO", nil, nil, nil, nil, "int4", nil, nil, `{"user_id":"currentUser"}`, nil, false, false, nil},
		{"cached_username", "text", "YES", nil, "NO", nil, nil, nil, nil, "text", nil, nil, `{"cached_username":"currentUserName"}`, nil, false, false, nil},
		{"created_by", "integer", "YES", nil, "NO", nil, "public", "system_users", "id", "int4", nil, nil, nil, nil, false, false, nil},
		{"owner_id", "integer", "YES", nil, "NO", nil, "public", "system_users", "id", "int4", nil, nil, nil, nil, false, false, nil},
	}}
}
