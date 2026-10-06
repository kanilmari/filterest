// startup_default_privileges_test.go
// Proves identifier escaping and PUBLIC/global default-privilege syntax.
// Complements the PostgreSQL proof covering every creator and future objects.
// Refuses malformed catalogue identities instead of building incomplete SQL.
package runtime_grants

import (
	"database/sql"
	"testing"
)

func TestStartupDefaultRevocationsQuoteIdentities(t *testing.T) {
	for _, test := range []struct {
		name  string
		entry startupDefaultPrivilege
		want  string
	}{
		{"quoted identities", startupDefaultPrivilege{Creator: `creator "a"`, Schema: sql.NullString{String: `schema "b"`, Valid: true}, Kind: "r", Privilege: "INSERT", Grantee: sql.NullString{String: `role "c"`, Valid: true}},
			`ALTER DEFAULT PRIVILEGES FOR ROLE "creator ""a""" IN SCHEMA "schema ""b""" REVOKE INSERT ON TABLES FROM "role ""c"""`},
		{"global PUBLIC", startupDefaultPrivilege{Creator: "creator", Kind: "S", Privilege: "USAGE"},
			`ALTER DEFAULT PRIVILEGES FOR ROLE "creator" REVOKE USAGE ON SEQUENCES FROM PUBLIC`},
		{"schema PUBLIC", startupDefaultPrivilege{Creator: "creator", Schema: sql.NullString{String: "extra", Valid: true}, Kind: "r", Privilege: "UPDATE"},
			`ALTER DEFAULT PRIVILEGES FOR ROLE "creator" IN SCHEMA "extra" REVOKE UPDATE ON TABLES FROM PUBLIC`},
		{"global named role", startupDefaultPrivilege{Creator: "creator", Kind: "n", Privilege: "CREATE", Grantee: sql.NullString{String: "PUBLIC", Valid: true}},
			`ALTER DEFAULT PRIVILEGES FOR ROLE "creator" REVOKE CREATE ON SCHEMAS FROM "PUBLIC"`},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := test.entry.revokeStatement()
			if err != nil || got != test.want {
				t.Fatalf("statement = %q, want %q: %v", got, test.want, err)
			}
		})
	}
	for _, entry := range []startupDefaultPrivilege{
		{Creator: "", Kind: "r", Privilege: "UPDATE"},
		{Creator: "creator", Schema: sql.NullString{Valid: true}, Kind: "r", Privilege: "UPDATE"},
		{Creator: "creator", Grantee: sql.NullString{Valid: true}, Kind: "r", Privilege: "UPDATE"},
		{Creator: "creator", Kind: "r", Privilege: "UPDATE; SELECT 1"},
		{Creator: "creator", Kind: "unknown", Privilege: "UPDATE"},
	} {
		if statement, err := entry.revokeStatement(); err == nil {
			t.Fatalf("invalid entry produced %q", statement)
		}
	}
}
