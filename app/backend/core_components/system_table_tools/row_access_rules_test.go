// row_access_rules_test.go
// Verifies row-access request normalization, readback guarantees, and administrator fail-closed gates.
// Bridges untrusted bulk payloads with the transaction-only rule service.
// Exists so unsupported actions and ambiguous selections cannot reach database mutation code.
package system_table_tools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func TestDecodeRowAccessMutationRejectsCreateForExistingRows(t *testing.T) {
	_, err := decodeRowAccessMutationRequest(strings.NewReader(`{
		"dataset":"services",
		"row_ids":[1],
		"principals":[{"type":"group","id":2}],
		"changes":{"create":"allow"}
	}`))
	if err == nil || !strings.Contains(err.Error(), errRowAccessAction.Error()) {
		t.Fatalf("decode error = %v, want unsupported row access action", err)
	}
}

func TestDecodeRowAccessMutationNormalizesRowsAndNoChange(t *testing.T) {
	request, err := decodeRowAccessMutationRequest(strings.NewReader(`{
		"dataset":" services ",
		"row_ids":[9,2,9],
		"principals":[
			{"type":"user","id":7},
			{"type":"group","id":2},
			{"type":"user","id":7}
		],
		"changes":{"read":"no_change","update":"allow","delete":"remove"},
		"reason":" reviewed "
	}`))
	if err != nil {
		t.Fatalf("decodeRowAccessMutationRequest returned error: %v", err)
	}
	if request.Dataset != "services" || request.Reason != "reviewed" {
		t.Fatalf("normalized request = %#v", request)
	}
	if len(request.RowIDs) != 2 || request.RowIDs[0] != 2 || request.RowIDs[1] != 9 {
		t.Fatalf("row IDs = %#v, want [2 9]", request.RowIDs)
	}
	if len(request.Principals) != 2 ||
		request.Principals[0] != (rowAccessPrincipalRef{Type: "group", ID: 2}) ||
		request.Principals[1] != (rowAccessPrincipalRef{Type: "user", ID: 7}) {
		t.Fatalf("principals = %#v, want group:2 and user:7", request.Principals)
	}
	if len(request.Changes) != 2 || request.Changes["update"] != "allow" || request.Changes["delete"] != "remove" {
		t.Fatalf("changes = %#v", request.Changes)
	}
}

func TestNormalizeRowAccessPrincipalsKeepsTypedIDsDistinct(t *testing.T) {
	principals, err := normalizeRowAccessPrincipals([]rowAccessPrincipalRef{
		{Type: "user", ID: 7},
		{Type: "group", ID: 7},
		{Type: "user", ID: 7},
	})
	if err != nil {
		t.Fatalf("normalizeRowAccessPrincipals returned error: %v", err)
	}
	if len(principals) != 2 || principals[0].Type != "group" || principals[1].Type != "user" {
		t.Fatalf("principals = %#v, want distinct group:7 and user:7", principals)
	}
}

func TestParseRowAccessPrincipalRefsCanonicalizesQuery(t *testing.T) {
	principals, err := parseRowAccessPrincipalRefs(" user:12,group:3,user:12 ")
	if err != nil {
		t.Fatalf("parseRowAccessPrincipalRefs returned error: %v", err)
	}
	if len(principals) != 2 ||
		principals[0] != (rowAccessPrincipalRef{Type: "group", ID: 3}) ||
		principals[1] != (rowAccessPrincipalRef{Type: "user", ID: 12}) {
		t.Fatalf("principals = %#v, want canonical typed identities", principals)
	}
	if _, err := parseRowAccessPrincipalRefs("user:not-an-id"); err == nil {
		t.Fatal("invalid principal query must fail closed")
	}
}

func TestValidateRowAccessAssignmentSizeCapsCartesianBatch(t *testing.T) {
	rowIDs := make([]int64, 101)
	principals := make([]rowAccessPrincipalRef, maxRowAccessPrincipals)
	for index := range rowIDs {
		rowIDs[index] = int64(index + 1)
	}
	for index := range principals {
		principals[index] = rowAccessPrincipalRef{Type: "user", ID: int64(index + 1)}
	}
	if err := validateRowAccessAssignmentSize(rowIDs, principals); err == nil {
		t.Fatal("oversized row × principal batch must fail closed")
	}
}

func TestVerifyRowAccessMutationReadbackRequiresUniformRequestedState(t *testing.T) {
	states := map[string]rowAccessActionState{
		"read":   {State: "allow"},
		"update": {State: "mixed"},
		"delete": {State: "inherited"},
	}
	if err := verifyRowAccessMutationReadback(states, map[string]string{
		"read": "allow", "delete": "remove",
	}); err != nil {
		t.Fatalf("valid readback returned error: %v", err)
	}
	if err := verifyRowAccessMutationReadback(states, map[string]string{"update": "deny"}); err == nil {
		t.Fatal("mixed readback must fail a requested deny mutation")
	}
}

func TestNewRowAccessChangeSetIDReturnsVersion4UUID(t *testing.T) {
	value, err := newRowAccessChangeSetID()
	if err != nil {
		t.Fatalf("newRowAccessChangeSetID returned error: %v", err)
	}
	if len(value) != 36 || value[14] != '4' || (value[19] != '8' && value[19] != '9' && value[19] != 'a' && value[19] != 'b') {
		t.Fatalf("change set ID = %q, want RFC 4122 version 4 shape", value)
	}
}

func TestAdminRowAccessRulesHandlerRejectsNonAdminBeforeTransaction(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/admin/row-access-rules", nil)
	request = request.WithContext(dbutils.SetRequestActorContext(
		context.Background(),
		dbutils.NewRequestActorContext(12, "basic"),
	))
	recorder := httptest.NewRecorder()

	AdminRowAccessRulesHandler(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
}

func TestAdminRowAccessRulesHandlerRequiresTransaction(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/admin/row-access-rules", nil)
	request = request.WithContext(dbutils.SetRequestActorContext(
		context.Background(),
		dbutils.NewRequestActorContext(12, "admin"),
	))
	recorder := httptest.NewRecorder()

	AdminRowAccessRulesHandler(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
}

func TestAdminRowAccessRulesHandlerRejectsUnsupportedMethodBeforeTransaction(t *testing.T) {
	request := httptest.NewRequest(http.MethodPut, "/api/admin/row-access-rules", nil)
	request = request.WithContext(dbutils.SetRequestActorContext(
		context.Background(),
		dbutils.NewRequestActorContext(12, "admin"),
	))
	recorder := httptest.NewRecorder()

	AdminRowAccessRulesHandler(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", recorder.Code)
	}
}
