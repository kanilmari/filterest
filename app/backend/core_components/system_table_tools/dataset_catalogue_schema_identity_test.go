// dataset_catalogue_schema_identity_test.go
// Proves equal physical table names keep separate catalogue identities.
// Connects guest, reader and administrator responses with ordered metadata fixtures.
// Prevents a private schema's aliases from replacing or entering a public pool.
package system_table_tools

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestDatasetCatalogueSameNamesAcrossSchemasKeepPublicIdentity(t *testing.T) {
	for _, privateFirst := range []bool{false, true} {
		for _, user := range []int{1, 42, 99} {
			t.Run(fmt.Sprintf("private_first_%t/user_%d", privateFirst, user), func(t *testing.T) {
				resetOrphanQueues()
				t.Cleanup(resetOrphanQueues)
				db := newSystemTableToolsTestDB(t)
				t.Cleanup(func() { db.Close() })
				previous := backend.Db
				backend.Db = db
				oldStore, oldName := esessions.Store, esessions.SessionName
				esessions.Store, esessions.SessionName = sessions.NewCookieStore([]byte("wl159-catalogue-test-cookie-key32")), "wl159-test"
				t.Cleanup(func() { backend.Db = previous; esessions.Store, esessions.SessionName = oldStore, oldName })
				readable := [][]driver.Value{{int64(11)}}
				if user == 99 {
					// Even if a caller supplies a private-schema grant, only public
					// identities are supported by the catalogue's document routes.
					readable = append(readable, []driver.Value{int64(12)})
				}
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"uid"}, rows: readable})
				tables := [][]driver.Value{{int64(11), "app_orders", "public"}, {int64(12), "app_orders", "audit"}}
				if privateFirst {
					tables[0], tables[1] = tables[1], tables[0]
				}
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"uid", "name", "schema"}, rows: tables})
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"uid", "alias", "primary"}, rows: [][]driver.Value{
					{int64(11), "shop-orders", true}, {int64(11), "old-orders", false}, {int64(12), "private-audit-orders", true},
				}})
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"exists"}, rows: [][]driver.Value{{false}}})
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"id", "uid", "name", "default", "filterbar", "main", "about", "folder", "project", "top", "icon", "media"},
					rows: [][]driver.Value{{int64(900), int64(11), "app_orders", false, false, false, false, nil, false, false, nil, false},
						{int64(901), int64(12), "app_orders", false, false, false, false, nil, false, false, nil, false}}})
				// Only the UID-bound public entry reaches the merged optional-kind
				// read/visibility checks and evidence query, ahead of the order check.
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"hidden"}, rows: [][]driver.Value{{false}}})
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"snapshot"}, rows: [][]driver.Value{{[]byte(`{"registrations":[{"table_uid":11,"name":"public.app_orders","table_kind":"ordinary"}],"shapes":[{"name":"public.app_orders"}]}`)}}})
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"exists"}, rows: [][]driver.Value{{false}}})
				response := httptest.NewRecorder()
				GetGroupedTables(response, catalogueRequest(t, user))
				assertPublicOrdersPool(t, response)
			})
		}
	}
}

func assertPublicOrdersPool(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	var body struct {
		Datasets []dtt_models.Table `json:"datasets"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("catalogue response: %d %s", response.Code, response.Body.String())
	}
	var publicOrders *dtt_models.Table
	for i := range body.Datasets {
		entry := &body.Datasets[i]
		if entry.TableName == "app_orders" {
			if publicOrders != nil {
				t.Fatalf("duplicate same-name catalogue entry: %s", response.Body.String())
			}
			publicOrders = entry
		}
	}
	if publicOrders == nil || publicOrders.ID != 900 || publicOrders.TableUID != 11 || !publicOrders.CanReadRows ||
		publicOrders.PreferredName != "shop-orders" || !reflect.DeepEqual(publicOrders.Names, []string{"app_orders", "old-orders", "shop-orders"}) {
		t.Fatalf("public dataset vanished or inherited another identity's names: %+v", body.Datasets)
	}
	if strings.Contains(response.Body.String(), "private-audit-orders") {
		t.Fatalf("private schema alias disclosed: %s", response.Body.String())
	}
}
