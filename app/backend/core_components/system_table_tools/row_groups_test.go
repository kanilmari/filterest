// row_groups_test.go
// Verifies the stable validation and administrator route boundary for generic row groups.
package system_table_tools

import (
	"strings"
	"testing"
)

func TestDecodeCreateRowGroupRequestNormalizesMultilingualValues(t *testing.T) {
	request, err := decodeCreateRowGroupRequest(strings.NewReader(`{
		"classification_id":1,"slug":"security",
		"title":{"fi":" Turvallisuus ","en":" Security "},
		"description":{"fi":" Matkaturvallisuus "},
		"sort_order":20
	}`))
	if err != nil {
		t.Fatalf("decodeCreateRowGroupRequest() error = %v", err)
	}
	if request.Slug != "security" || request.Title["fi"] != "Turvallisuus" || request.Description["fi"] != "Matkaturvallisuus" {
		t.Fatalf("normalized request = %#v", request)
	}
}

func TestDecodeCreateRowGroupRequestRejectsInvalidContract(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"classification_id":1,"slug":"security","title":{"en":"Security"},"extra":true}`},
		{name: "unsafe slug", body: `{"slug":"Security News","title":{"en":"Security"}}`},
		{name: "missing title", body: `{"classification_id":1,"slug":"security","title":{}}`},
		{name: "invalid language code", body: `{"classification_id":1,"slug":"security","title":{"english":"Security"}}`},
		{name: "extra object", body: `{"classification_id":1,"slug":"security","title":{"en":"Security"}} {}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := decodeCreateRowGroupRequest(strings.NewReader(test.body)); err == nil {
				t.Fatal("decodeCreateRowGroupRequest() error = nil, want validation error")
			}
		})
	}
}

func TestDecodeRowGroupMembershipRequestRequiresPositiveIdentifiers(t *testing.T) {
	valid, err := decodeRowGroupMembershipRequest(strings.NewReader(`{"group_id":4,"table_uid":201,"row_id":8}`))
	if err != nil || valid.GroupID != 4 || valid.TableUID != 201 || valid.RowID != 8 {
		t.Fatalf("valid membership = %#v, error = %v", valid, err)
	}
	if _, err := decodeRowGroupMembershipRequest(strings.NewReader(`{"group_id":4,"table_uid":0,"row_id":8}`)); err == nil {
		t.Fatal("zero table_uid accepted")
	}
}
