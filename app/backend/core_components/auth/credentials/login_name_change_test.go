// login_name_change_test.go
// Covers the shared name format and system reservations before any transaction is opened.
// Bridges ordinary, administrator and recovery writers with the same private-name policy.
// Exists to prevent a writer from adopting a reserved cleanup or automation identity.
package credentials

import (
	"easelect/backend/core_components/httpresponse"
	"testing"
)

func TestValidateLoginNameSharesFormatAndReservations(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_DEV_ADMIN_USERNAME", "local_operator")
	for _, name := range []string{"Abc", "admin_site", "person.name-7"} {
		if err := ValidateLoginName(name); err != nil {
			t.Fatalf("valid %q: %v", name, err)
		}
	}
	for _, test := range []struct{ name, key string }{
		{"ab", "login_name_invalid"}, {" leading", "login_name_invalid"}, {"trailing ", "login_name_invalid"}, {"person@host", "login_name_invalid"},
		{"Admin_7", "login_name_reserved"}, {"AUTO_2", "login_name_reserved"}, {"TEST_USER", "login_name_reserved"}, {"test_admin", "login_name_reserved"}, {"filterest_agent", "login_name_reserved"}, {"LOCAL_OPERATOR", "login_name_reserved"},
	} {
		err := ValidateLoginName(test.name)
		refusal := httpresponse.AccountNameRefusal(err)
		if refusal == nil || refusal.LangKey != test.key || refusal.Message != test.key {
			t.Fatalf("name %q gave %v", test.name, err)
		}
	}
}
