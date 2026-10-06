// mutation_test.go
// Checks the translated privilege-view boundary for configured runtime identities.
// Covers custom quoted names and the unchanged behaviour for unrelated roles.
// Does not start database connections or alter application data.
package runtime_grant_mutations

import (
	"errors"
	"testing"

	"easelect/backend/core_components/httpresponse"
)

func TestPrivilegeViewRefusesEveryConfiguredRuntimeRole(t *testing.T) {
	for _, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
		name := key + ` "custom role"`
		t.Setenv(key, name)
		var refusal *httpresponse.Refusal
		if err := RefuseManagedPrivilegeRole(name); !errors.As(err, &refusal) || refusal.Status != 409 || refusal.LangKey != "error_runtime_grant_privilege_managed" {
			t.Fatal(key, err)
		}
	}
	for _, name := range []string{"", "other role", "PUBLIC"} {
		if err := RefuseManagedPrivilegeRole(name); err != nil {
			t.Fatal("unrelated role refused", name, err)
		}
	}
}
