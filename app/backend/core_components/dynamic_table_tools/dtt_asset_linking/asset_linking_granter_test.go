// asset_linking_granter_test.go
// Verifies PostgreSQL ACL inheritance for generated shared asset child tables.
// Bridges the database/sql test driver with runtime table and sequence grants.
// Exists so policy-routed non-owner pools keep upload access in every project.
package dtt_asset_linking

import (
	"database/sql/driver"
	"strings"
	"testing"
)

func TestCopyPhysicalTablePermissionsMirrorsRuntimeTableAndSequenceAccess(t *testing.T) {
	db, state := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
		{
			match: "aclexplode",
			cols:  []string{"grantee_name", "privilege_type", "is_parent_owner"},
			rows: [][]driver.Value{
				{"basic_user", "INSERT", false},
				{"basic_user", "SELECT", false},
				{"readeronly", "SELECT", false},
				{"postgres", "SELECT", true},
			},
		},
		{
			match: "pg_catalog.pg_depend",
			cols:  []string{"nspname", "relname"},
			rows:  [][]driver.Value{{"public", "articles_assets_id_seq"}},
		},
	}, []imageAssetLinkingExecResponse{
		{match: "GRANT", rowsAffected: 0},
	})

	if err := CopyPhysicalTablePermissions(db, "articles", "articles_assets"); err != nil {
		t.Fatalf("CopyPhysicalTablePermissions returned error: %v", err)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	joined := ""
	for _, call := range state.calls {
		joined += call.query + "\n"
	}
	for _, fragment := range []string{
		`GRANT SELECT, INSERT ON TABLE "public"."articles_assets" TO "basic_user"`,
		`GRANT SELECT ON TABLE "public"."articles_assets" TO "readeronly"`,
		`GRANT USAGE, SELECT ON SEQUENCE "public"."articles_assets_id_seq" TO "basic_user"`,
	} {
		if !strings.Contains(joined, fragment) {
			t.Fatalf("grant calls missing %q:\n%s", fragment, joined)
		}
	}
	if strings.Contains(joined, `TO "postgres"`) {
		t.Fatalf("parent owner permissions must not be copied explicitly:\n%s", joined)
	}
}

func TestCopyPhysicalTablePermissionsRejectsUnsafeNamesBeforeDatabaseAccess(t *testing.T) {
	stub := &imageAssetLinkingExecStub{}
	if err := CopyPhysicalTablePermissions(stub, `articles; DROP TABLE users`, "articles_assets"); err == nil {
		t.Fatal("unsafe parent table name was accepted")
	}
	if stub.query != "" {
		t.Fatalf("database was touched for unsafe input: %q", stub.query)
	}
}
