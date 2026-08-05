// engine_test.go
// Unit tests for the dynamic_function_engine package.
// All action types currently return stub errors, so we verify error messages.
package dynamic_function_engine

import (
	"strings"
	"testing"
)

func TestDispatchOperationRowUpdate(t *testing.T) {
	err := DispatchOperation(nil, DynamicOperation{ActionType: "row_update"})
	if err == nil {
		t.Fatal("expected error for unimplemented row_update")
	}
	if !strings.Contains(err.Error(), "not yet implemented") {
		t.Fatalf("error = %q, want 'not yet implemented'", err.Error())
	}
}

func TestDispatchOperationColumnDelete(t *testing.T) {
	err := DispatchOperation(nil, DynamicOperation{ActionType: "column_delete"})
	if err == nil {
		t.Fatal("expected error for unimplemented column_delete")
	}
	if !strings.Contains(err.Error(), "not yet implemented") {
		t.Fatalf("error = %q, want 'not yet implemented'", err.Error())
	}
}

func TestDispatchOperationUnknown(t *testing.T) {
	err := DispatchOperation(nil, DynamicOperation{ActionType: "foobar"})
	if err == nil {
		t.Fatal("expected error for unknown action type")
	}
	if !strings.Contains(err.Error(), "unknown action type") {
		t.Fatalf("error = %q, want 'unknown action type'", err.Error())
	}
}

func TestDispatchOperationEmpty(t *testing.T) {
	err := DispatchOperation(nil, DynamicOperation{})
	if err == nil {
		t.Fatal("expected error for empty action type")
	}
}

func TestDynamicOperationStruct(t *testing.T) {
	op := DynamicOperation{
		ActionType:  "row_update",
		TargetTable: "users",
		Conditions:  map[string]any{"id": 1},
		Values:      map[string]any{"name": "test"},
	}
	if op.ActionType != "row_update" {
		t.Fatal("ActionType mismatch")
	}
	if op.TargetTable != "users" {
		t.Fatal("TargetTable mismatch")
	}
}
