// permissions_handlers_test.go
// Verifies table-specific permission target validation for the patch-permissions flow.
// Bridges permission payload normalization and dataset lookup expectations in isolation.
// Exists to prevent unresolved dataset names from being accepted as successful permission saves.

package backend

import (
	"errors"
	"strings"
	"testing"
)

func TestResolveTableSpecificPermissionTargetUsesExistingUID(t *testing.T) {
	lookupCalled := false

	resolved, err := resolveTableSpecificPermissionTarget(Permission{
		TargetTableName: "users",
		TargetTableUID:  42,
	}, func(string) (int, error) {
		lookupCalled = true
		return 0, nil
	})
	if err != nil {
		t.Fatalf("resolveTableSpecificPermissionTarget returned error: %v", err)
	}
	if lookupCalled {
		t.Fatal("resolveTableSpecificPermissionTarget called lookup despite existing uid")
	}
	if resolved.TargetTableUID != 42 {
		t.Fatalf("resolved.TargetTableUID = %d, want 42", resolved.TargetTableUID)
	}
}

func TestResolveTableSpecificPermissionTargetFillsUIDFromLookup(t *testing.T) {
	resolved, err := resolveTableSpecificPermissionTarget(Permission{
		TargetTableName: "users",
	}, func(name string) (int, error) {
		if name != "users" {
			t.Fatalf("lookup name = %q, want users", name)
		}
		return 77, nil
	})
	if err != nil {
		t.Fatalf("resolveTableSpecificPermissionTarget returned error: %v", err)
	}
	if resolved.TargetTableUID != 77 {
		t.Fatalf("resolved.TargetTableUID = %d, want 77", resolved.TargetTableUID)
	}
}

func TestResolveTableSpecificPermissionTargetRejectsMissingDatasetName(t *testing.T) {
	_, err := resolveTableSpecificPermissionTarget(Permission{}, func(string) (int, error) {
		t.Fatal("lookup should not be called when dataset name is missing")
		return 0, nil
	})
	if err == nil || !strings.Contains(err.Error(), "missing target dataset name") {
		t.Fatalf("err = %v, want missing target dataset name", err)
	}
}

func TestResolveTableSpecificPermissionTargetRejectsUnresolvedDataset(t *testing.T) {
	_, err := resolveTableSpecificPermissionTarget(Permission{
		TargetTableName: "ghost_table",
	}, func(string) (int, error) {
		return 0, errors.New("sql: no rows in result set")
	})
	if err == nil || !strings.Contains(err.Error(), `resolve target dataset "ghost_table"`) {
		t.Fatalf("err = %v, want wrapped unresolved dataset error", err)
	}
}
