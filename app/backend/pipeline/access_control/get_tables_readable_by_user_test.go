// get_tables_readable_by_user_test.go
// Verifies the read-catalogue boundary independently of the broader tree inventory.
// Bridges injected query results, guest/admin identities and enabled read-route policy.
// Real grant combinations are exercised by dataset_catalogue_postgres_test.go.
package access_control

import (
	backend "easelect/backend/core_components"
	"strings"
	"testing"
)

func TestGetTablesReadableByUserNeverReturnsAdministratorWildcard(t *testing.T) {
	setupMockDB(t, acMockConfig{isAdmin: true})
	for _, user := range []int{1, 42, 99} {
		got, err := GetTablesReadableByUser(backend.Db, user)
		if err != nil || got == nil {
			t.Fatalf("user %d: set=%v err=%v; a read catalogue must have an explicit set", user, got, err)
		}
	}
}

func TestGetTablesReadableByUserRejectsMissingPrincipalWithoutQuery(t *testing.T) {
	got, err := GetTablesReadableByUser(nil, 0)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("missing principal: %v %v", got, err)
	}
}

func TestGetTablesReadableByUserUsesRowReadRouteAndVisibilityPolicy(t *testing.T) {
	for _, clause := range []string{
		"rights.target_table_uid = dataset.table_uid",
		"function.url_route_endpoint = '/api/get-results'",
		"function.disabled = false OR function.disabled IS NULL",
		"membership.user_id = $1",
		"NOT dataset.ui_hidden OR EXISTS",
		"admin.user_id = $1 AND admin.group_id = 1",
		"COALESCE(NULLIF(dataset.schema_name, ''), 'public') = 'public'",
	} {
		if !strings.Contains(readableTablesQuery, clause) {
			t.Fatalf("catalogue does not match row-read policy: missing %q", clause)
		}
	}
}
