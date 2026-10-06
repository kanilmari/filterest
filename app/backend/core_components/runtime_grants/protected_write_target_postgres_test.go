// protected_write_target_postgres_test.go
// Proves the editor guard follows the shared account/view dependency closure.
// Uses the disposable catalogue and preserves literal padded request targets.
// Prevents policy-test stubs from being the only evidence of this security guard.
package runtime_grants

import "testing"

func TestProtectedWriteTargetPostgres(t *testing.T) {
	owner, _, _ := startupGrantFixture(t)
	fixtureExec(t, owner, `CREATE VIEW user_names AS SELECT id FROM system_users;
 CREATE VIEW nested_user_names AS SELECT id FROM user_names`)
	for _, test := range []struct {
		target string
		want   bool
	}{
		{"system_user_group_memberships", true},
		{" user_names ", true},
		{"public.nested_user_names", true},
		{"startup_safe_content", false},
	} {
		got, err := ProtectedWriteTarget(owner, test.target)
		if err != nil || got != test.want {
			t.Fatalf("target %q protected=%v, want %v: %v", test.target, got, test.want, err)
		}
	}
}
