// surviving_sign_in_grants_postgres_test.go
// Proves the new private columns inherit real restricted-table privileges.
// Uses only the existing opt-in disposable PostgreSQL grant fixture.
// Checks both an upgrade with existing grants and startup reconciliation afterwards.
package runtime_grants

import (
	"os"
	"testing"
)

func TestSurvivingSignInColumnsKeepRestrictedGrantsPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	startupRun(t, owner, config)
	fixtureExec(t, owner, `ALTER TABLE system_data_repair_records
		ADD COLUMN migration text, ADD COLUMN action text, ADD COLUMN detail jsonb`)
	migration, err := os.ReadFile("../../../server_tools/migrations/20261005000040_add_surviving_sign_in.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(migration))
	for _, phase := range []string{"upgrade", "startup"} {
		if phase == "startup" {
			startupRun(t, owner, config)
		}
		for label, role := range config.Names {
			for _, column := range []string{"surviving_sign_in_id", "surviving_sign_in_generation"} {
				for _, privilege := range []string{"SELECT", "INSERT", "UPDATE"} {
					var allowed bool
					if err := owner.QueryRow(`SELECT has_column_privilege($1,
						'restricted.users_restricted', $2, $3)`, role, column, privilege).Scan(&allowed); err != nil || allowed != (label == "confidential") {
						t.Fatalf("%s %s %s %s allowed=%v error=%v", phase, label, column, privilege, allowed, err)
					}
				}
			}
		}
	}
}
