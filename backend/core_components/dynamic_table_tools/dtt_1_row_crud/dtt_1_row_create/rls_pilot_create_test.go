// rls_pilot_create_test.go
// Tests the owner-safe create helpers for the app_service_catalog RLS pilot.
// Bridges the narrow create allowlist, form metadata filtering, and forced owner binding.
// Exists to keep the first INSERT pilot slice explicit and regression-safe.
package dtt_1_row_create

import (
	"errors"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestShouldEnforceOwnerSafePilotCreateRules(t *testing.T) {
	if !shouldEnforceOwnerSafePilotCreateRules(createRLSPilotTableName, "basic") {
		t.Fatal("pilot table should enforce owner-safe create rules for non-admin")
	}
	if shouldEnforceOwnerSafePilotCreateRules(createRLSPilotTableName, "admin") {
		t.Fatal("pilot table should not enforce owner-safe create rules for admin")
	}
	if shouldEnforceOwnerSafePilotCreateRules("some_other_table", "basic") {
		t.Fatal("non-pilot table should not enforce owner-safe create rules")
	}
}

func TestFilterPilotCreateColumns(t *testing.T) {
	columns := []dtt_models.AddRowColumnInfo{
		{ColumnName: "header"},
		{ColumnName: "published"},
		{ColumnName: "keywords_static"},
		{ColumnName: "search_vector_simple"},
		{ColumnName: "national_corporation_identifier"},
	}

	filtered := filterPilotCreateColumns(createRLSPilotTableName, "basic", columns)
	if len(filtered) != 3 {
		t.Fatalf("len(filtered) = %d, want 3", len(filtered))
	}
	got := []string{filtered[0].ColumnName, filtered[1].ColumnName, filtered[2].ColumnName}
	want := []string{"header", "keywords_static", "national_corporation_identifier"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("filtered[%d] = %q, want %q", i, got[i], want[i])
		}
	}

	adminFiltered := filterPilotCreateColumns(createRLSPilotTableName, "admin", columns)
	if len(adminFiltered) != len(columns) {
		t.Fatalf("admin path should keep all columns, got %d want %d", len(adminFiltered), len(columns))
	}
}

func TestApplyPilotCreatePayload(t *testing.T) {
	payload := map[string]interface{}{
		"header":            "Service",
		"keywords_static":   "alpha, beta",
		"type_of_operation": "Oy",
		"website":           "https://example.com",
	}

	filtered, err := applyPilotCreatePayload(createRLSPilotTableName, "basic", payload, 42, "alice")
	if err != nil {
		t.Fatalf("applyPilotCreatePayload returned error: %v", err)
	}
	if filtered["user_id"] != 42 {
		t.Fatalf("filtered[user_id] = %v, want 42", filtered["user_id"])
	}
	if filtered["cached_username"] != "alice" {
		t.Fatalf("filtered[cached_username] = %v, want alice", filtered["cached_username"])
	}
	if filtered["header"] != "Service" {
		t.Fatalf("filtered[header] = %v, want Service", filtered["header"])
	}
}

func TestApplyPilotCreatePayloadRejectsDisallowedColumn(t *testing.T) {
	_, err := applyPilotCreatePayload(createRLSPilotTableName, "basic", map[string]interface{}{
		"published": true,
	}, 42, "alice")
	if err == nil {
		t.Fatal("expected forbidden error for disallowed create column")
	}
	var fe *forbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("err = %v, want forbiddenError", err)
	}
}

func TestApplyPilotCreatePayloadBypassesAdmin(t *testing.T) {
	payload := map[string]interface{}{
		"published": true,
	}

	filtered, err := applyPilotCreatePayload(createRLSPilotTableName, "admin", payload, 42, "alice")
	if err != nil {
		t.Fatalf("admin path returned error: %v", err)
	}
	if filtered["published"] != true {
		t.Fatalf("admin filtered[published] = %v, want true", filtered["published"])
	}
	if _, ok := filtered["user_id"]; ok {
		t.Fatal("admin path should not force user_id")
	}
}
