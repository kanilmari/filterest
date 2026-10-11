// dataset_catalogue_privacy_test.go
// Exercises tab-order privacy and runtime registration without a live database.
// Bridges catalogue HTTP responses and consistency repairs with scripted SQL replies.
// PostgreSQL tests separately verify the grant and stored-order semantics.
package system_table_tools

import (
	"database/sql/driver"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestDatasetCatalogueFiltersSavedTabOrderAndRenumbers(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	db := newSystemTableToolsTestDB(t)
	t.Cleanup(func() { db.Close() })
	previous := backend.Db
	backend.Db = db
	oldStore, oldName := esessions.Store, esessions.SessionName
	esessions.Store, esessions.SessionName = sessions.NewCookieStore([]byte("wl159-catalogue-test-cookie-key32")), "wl159-test"
	t.Cleanup(func() { backend.Db = previous; esessions.Store, esessions.SessionName = oldStore, oldName })
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"uid"}, rows: [][]driver.Value{{int64(11)}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"table_uid", "name", "schema"}, rows: [][]driver.Value{{int64(11), "app_orders", "public"}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"uid", "alias", "primary"}, rows: [][]driver.Value{{int64(11), "shop-orders", true}, {int64(11), "old-orders", false}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"exists"}, rows: [][]driver.Value{{false}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"id", "uid", "name", "default", "filterbar", "main", "about", "folder", "project", "top", "icon", "media"},
		rows: [][]driver.Value{{int64(900), int64(11), "app_orders", false, false, false, false, nil, false, false, nil, false}}})
	// The merged handler proves ordinary read/visibility and loads optional kind
	// evidence before reading saved order. These replies keep the order aligned.
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"hidden"}, rows: [][]driver.Value{{false}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"snapshot"}, rows: [][]driver.Value{{[]byte(`{"registrations":[{"table_uid":11,"name":"public.app_orders","table_kind":"ordinary"}],"shapes":[{"name":"public.app_orders"}]}`)}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"exists"}, rows: [][]driver.Value{{true}}})
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"order"}, rows: [][]driver.Value{{`[
        {"tab_id":"app_private","sort_order":0},
        {"tab_id":"old-orders","sort_order":8,"secret":"private-orders"},
        {"tab_id":"static:login","sort_order":20},
        {"tab_id":"static:unknown-secret","sort_order":30},
        {"dataset_name":"app_orders","sort_order":50},
        {"tab_id":"static:system_users","sort_order":60}]`}}})
	response := httptest.NewRecorder()
	GetGroupedTables(response, catalogueRequest(t, 1))
	var body struct {
		TabOrder []map[string]interface{} `json:"tab_order"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	expected := []map[string]interface{}{{"tab_id": "app_orders", "sort_order": float64(0)}, {"tab_id": "static:login", "sort_order": float64(1)}}
	if response.Code != 200 || !reflect.DeepEqual(body.TabOrder, expected) {
		t.Fatalf("catalogue tab order leaked names or positions: %s", response.Body.String())
	}
}

func TestRuntimeDatasetRegistrationGrantsAdministratorFunctions(t *testing.T) {
	resetOrphanQueues()
	t.Cleanup(resetOrphanQueues)
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	for _, query := range []orphanQueuedQuery{
		{cols: []string{"schema"}, rows: [][]driver.Value{{"public"}}},
		{cols: []string{"folder"}, rows: [][]driver.Value{{int64(1)}}},
		{cols: []string{"folder"}, rows: [][]driver.Value{{int64(2)}}},
		{cols: []string{"uid"}, rows: [][]driver.Value{{int64(11)}}},
		{cols: []string{"admin"}, rows: [][]driver.Value{{int64(1)}}},
		{cols: []string{"function"}, rows: [][]driver.Value{{int64(101)}, {int64(102)}}},
	} {
		pushOrphanQuery(query)
	}
	for i := 0; i < 3; i++ {
		pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
	}
	if err := fixIssue(db, "cat2_app_orders", map[string]string{"cat2_app_orders": "register"}); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, query := range snapshotOrphanCalls() {
		if strings.Contains(query, "INSERT INTO system_group_table_func_rights") {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("runtime registration gave %d administrator grants, want 2", count)
	}
}
