// acl_default_postgres_test.go
// Verifies that a sequence without an explicit ACL is read with the sequence defaults.
// Bridges the direct ACL inventory and the reconciler's outside-scope fingerprint.
// acldefault's 'S' is a foreign server; read as one, a first USAGE grant looked like an owner ACL change.
package runtime_grants

import (
	"testing"
)

func TestSequenceDefaultACLMatchesExplicitOwnerACLPostgres(t *testing.T) {
	owner, _ := grantDisposableDB(t)
	fixtureExec(t, owner, `CREATE SEQUENCE acl_default_sequence`)
	fixtureExec(t, owner, `CREATE ROLE "acl default grantee"`)
	ownerPrivileges := func() string {
		t.Helper()
		var privileges string
		err := owner.QueryRow(`SELECT COALESCE(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
			FROM (` + directACLsSQL + `) a WHERE relname = 'acl_default_sequence' AND grantee = relowner`).Scan(&privileges)
		if err != nil {
			t.Fatal(err)
		}
		return privileges
	}
	before := ownerPrivileges()
	fixtureExec(t, owner, `GRANT USAGE ON SEQUENCE acl_default_sequence TO "acl default grantee"`)
	after := ownerPrivileges()
	if before != "SELECT,UPDATE,USAGE" || after != before {
		t.Fatalf("owner privileges on the sequence: %q before the first grant, %q after it", before, after)
	}
}
