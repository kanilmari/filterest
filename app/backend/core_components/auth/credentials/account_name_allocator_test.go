// account_name_allocator_test.go
// Pins K149 environment order, sanitization and reserved proposal refusals.
// Bridges first-run and bootstrap callers through their single suggestion function.
// Prevents two tools from suggesting different login names for one installation.
package credentials

import (
	"strings"
	"testing"
)

func TestSuggestedAdministratorLoginNameLT8(t *testing.T) {
	for _, test := range []struct{ preferred, fallback, want string }{
		{"Northwind", "ignored", "admin_northwind"}, {"", "My Site.fi", "admin_my_site_fi"},
		{"", "", "admin_filterest"}, {"2026", "other", ""}, {strings.Repeat("a", 65), "", ""},
	} {
		t.Setenv("FILTEREST_SITE_SLUG", test.preferred)
		t.Setenv("SITE_SLUG", test.fallback)
		if got := SuggestedAdministratorLoginName(); got != test.want {
			t.Fatalf("suggestion=%q want=%q", got, test.want)
		}
	}
}
func TestSystemLoginNameValidationIsNarrowLT11(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "named_local_admin")
	for _, name := range []string{AutomationLoginName, TestUserLoginName, TestAdministratorLoginName, "named_local_admin"} {
		if ValidateLoginName(name) == nil || ValidateReservedLoginName(name) != nil {
			t.Fatal("reserved/system boundary", name)
		}
	}
	for _, name := range []string{"admin_1", "auto_9", "bad name"} {
		if ValidateReservedLoginName(name) == nil {
			t.Fatal("unexpected system exception", name)
		}
	}
}
