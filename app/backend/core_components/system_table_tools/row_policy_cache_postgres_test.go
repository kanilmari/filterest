// row_policy_cache_postgres_test.go
// Proves generic visibility-gate saves replace a warm result reader's row policy.
// Uses real handlers, commit middleware and the disposable PostgreSQL fixture.
// Run this test alone with -timeout 90s; it never waits for a cache TTL.
package system_table_tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	"easelect/backend/core_components/middlewares"
	"github.com/lib/pq"
)

func TestGenericRowPolicyImmediateResultsInvalidationPostgres(t *testing.T) {
	started := time.Now()
	watchdog := time.AfterFunc(90*time.Second, func() {
		panic("row-policy regression exceeded 90s including fixture cleanup")
	})
	t.Cleanup(func() {
		watchdog.Stop()
		if elapsed := time.Since(started); elapsed > 90*time.Second {
			t.Errorf("row-policy regression exceeded 90s including fixture cleanup: %s", elapsed)
		}
	})
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	db := frontPageDisposableDB(t)
	const dataset = "b324r1_row_policy"
	if _, err := db.ExecContext(ctx, `
 UPDATE system_users SET admin_access_allowed=false WHERE id IN (42,73);
 INSERT INTO system_users(id,username,enabled,admin_access_allowed) VALUES(94,'Row policy admin',true,true);
 INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(94,1);
 CREATE TABLE b324r1_row_policy(id integer PRIMARY KEY,user_id integer REFERENCES system_users(id),approved boolean);
 INSERT INTO b324r1_row_policy VALUES(1,73,false),(2,73,true);
 INSERT INTO system_db_tables(table_name,schema_name,folder_id,row_policy_owner_column)
 VALUES('b324r1_row_policy','public',1,'user_id');
 INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,must_be_true_unless_own)
 SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,false
 FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
 WHERE col.table_schema='public' AND col.table_name='b324r1_row_policy';
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
 SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='b324r1_row_policy';`); err != nil {
		t.Fatal(err)
	}
	// Match generic save's real grant reconciliation without using installed roles.
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		name := "b324r1_" + label
		t.Setenv(key, name)
		if _, err := db.ExecContext(ctx, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN"); err != nil {
			t.Fatal(err)
		}
	}
	var candidateID int
	if err := db.QueryRowContext(ctx, `SELECT id FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name=$1) AND column_name='approved'`, dataset).Scan(&candidateID); err != nil {
		t.Fatal(err)
	}
	// Only teardown clears test-owned cache entries; no invalidation between steps.
	t.Cleanup(func() {
		read.InvalidateSchemaCache(dataset)
		read.InvalidatePermissionsCache(dataset)
		read.InvalidateUserColumnSettingsCache(dataset, "")
		read.InvalidateDatasetExistsCache(dataset)
	})
	reader := frontPageSessionRequest(t, 42, "basic", "GET", "/api/get-results?dataset="+dataset+"&view_key=table")
	owner := frontPageSessionRequest(t, 73, "basic", "GET", reader.URL.String())
	admin := frontPageSessionRequest(t, 94, "admin", "POST", "/api/update-row?dataset=system_column_details")
	assertRows := func(request *http.Request, want ...int) {
		t.Helper()
		response := httptest.NewRecorder()
		middlewares.WithLazyTransaction(http.HandlerFunc(read.GetResults)).ServeHTTP(response, request.Clone(ctx))
		var result struct {
			Data []struct {
				ID int `json:"id"`
			} `json:"data"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatalf("read: %d %s", response.Code, response.Body)
		}
		got := make([]int, 0, len(result.Data))
		for _, row := range result.Data {
			got = append(got, row.ID)
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			t.Fatalf("visible row IDs=%v, want %v: %s", got, want, response.Body)
		}
	}
	save := func(value bool) {
		t.Helper()
		body, err := json.Marshal(map[string]any{"id": candidateID, "column": "must_be_true_unless_own", "value": value})
		if err != nil {
			t.Fatal(err)
		}
		request := admin.Clone(ctx)
		request.Body = io.NopCloser(strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			update.UpdateRowHandler(w, r, "system_column_details")
		})
		middlewares.WithLazyTransaction(handler).ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("save gate=%v: %d %s", value, response.Code, response.Body)
		}
		var committed bool
		if err := db.QueryRowContext(ctx, `SELECT must_be_true_unless_own FROM system_column_details WHERE id=$1`, candidateID).Scan(&committed); err != nil || committed != value {
			t.Fatalf("committed gate=%v, want %v: %v", committed, value, err)
		}
	}
	assertRows(reader, 1, 2) // Non-owner warms the schema cache with no gate.
	assertRows(reader, 1, 2) // The same reader uses that warm cache.
	save(true)
	assertRows(reader, 2)   // Immediate read after commit must omit the draft.
	assertRows(owner, 1, 2) // The owner keeps the own-row exception.
	save(false)
	assertRows(reader, 1, 2) // Clearing the gate must replace the cached policy too.
}
