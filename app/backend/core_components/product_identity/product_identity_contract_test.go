// product_identity_contract_test.go
// Pins the public product identity's JSON field names before admin-only additions.
// Connects the public handler's Identity payload with its reflection-visible tags.
// Prevents administrator build details from leaking into the public contract.
package productidentity

import (
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestPublicIdentityJSONTagContract(t *testing.T) {
	want := []string{"kind", "name", "private_upstream", "public_distribution", "app_version_file",
		"version", "release_channel", "artifact_purpose", "artifact_type", "maturity", "verification",
		"identity_source", "build_id", "ledger_record_id", "database_min_version", "database_target_version",
		"private_frontend_extension_module_url"}
	var got []string
	typ := reflect.TypeOf(Identity{})
	for i := 0; i < typ.NumField(); i++ {
		got = append(got, strings.Split(typ.Field(i).Tag.Get("json"), ",")[0])
	}
	for _, private := range []string{"git_commit_sha", "source_dirty", "built_at", "source_status"} {
		if slices.Contains(got, private) {
			t.Errorf("public identity exposes administrator field %q", private)
		}
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("public JSON tags = %v, want %v", got, want)
	}
}
