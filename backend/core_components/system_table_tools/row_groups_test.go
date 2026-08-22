// row_groups_test.go
// Verifies the stable validation and administrator route boundary for generic row groups.
package system_table_tools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeCreateRowGroupRequestNormalizesMultilingualValues(t *testing.T) {
	request, err := decodeCreateRowGroupRequest(strings.NewReader(`{
		"slug":"security",
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
		{name: "unknown field", body: `{"slug":"security","title":{"en":"Security"},"extra":true}`},
		{name: "unsafe slug", body: `{"slug":"Security News","title":{"en":"Security"}}`},
		{name: "missing title", body: `{"slug":"security","title":{}}`},
		{name: "invalid language code", body: `{"slug":"security","title":{"english":"Security"}}`},
		{name: "extra object", body: `{"slug":"security","title":{"en":"Security"}} {}`},
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

func TestAdminRowGroupsHandlerListsThroughExplicitAdminRoute(t *testing.T) {
	original := listRowGroups
	listRowGroups = func(_ context.Context, tableUID int64, rowID int64) ([]RowGroup, error) {
		if tableUID != 201 || rowID != 8 {
			t.Fatalf("query target = %d/%d, want 201/8", tableUID, rowID)
		}
		return []RowGroup{{ID: 4, Slug: "security", Title: map[string]string{"en": "Security"}, Enabled: true, Selected: true}}, nil
	}
	t.Cleanup(func() { listRowGroups = original })

	request := httptest.NewRequest(http.MethodGet, "/api/admin/row-groups?table_uid=201&row_id=8", nil)
	response := httptest.NewRecorder()
	AdminRowGroupsHandler(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"slug":"security"`) || !strings.Contains(response.Body.String(), `"selected":true`) {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestAdminRowGroupHandlersRejectUnsupportedMethods(t *testing.T) {
	for _, handler := range []http.HandlerFunc{AdminRowGroupsHandler, AdminRowGroupMembershipsHandler} {
		response := httptest.NewRecorder()
		handler(response, httptest.NewRequest(http.MethodPatch, "/api/admin/row-groups", nil))
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
		}
	}
}
