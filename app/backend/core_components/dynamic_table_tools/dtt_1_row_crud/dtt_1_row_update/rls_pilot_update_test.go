package dtt_1_row_update

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
)

type rowsAffectedErrResult struct{}

func (rowsAffectedErrResult) LastInsertId() (int64, error) { return 0, nil }
func (rowsAffectedErrResult) RowsAffected() (int64, error) { return 0, errors.New("boom") }

func TestShouldEnforceOwnerSafePilotUpdateAllowlist(t *testing.T) {
	if !shouldEnforceOwnerSafePilotUpdateAllowlist(updateRLSPilotTableName, "basic") {
		t.Fatal("pilot table should enforce owner-safe allowlist for non-admin")
	}
	if shouldEnforceOwnerSafePilotUpdateAllowlist(updateRLSPilotTableName, "admin") {
		t.Fatal("pilot table should not enforce owner-safe allowlist for admin")
	}
	if shouldEnforceOwnerSafePilotUpdateAllowlist("some_other_table", "basic") {
		t.Fatal("non-pilot table should not enforce owner-safe allowlist")
	}
}

func TestEnforcePilotUpdateColumn(t *testing.T) {
	allowedColumns := []string{
		"header",
		"keywords_static",
		"type_of_operation",
		"national_corporation_identifier",
		"published",
		"enabled",
	}
	for _, columnName := range allowedColumns {
		if err := enforcePilotUpdateColumn(updateRLSPilotTableName, "basic", columnName); err != nil {
			t.Fatalf("allowed pilot column %q returned error: %v", columnName, err)
		}
	}

	err := enforcePilotUpdateColumn(updateRLSPilotTableName, "basic", "admin_reviewed")
	if err == nil {
		t.Fatal("expected forbidden error for non-allowlisted pilot column")
	}
	var fe *forbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("err = %v, want forbiddenError", err)
	}

	if err := enforcePilotUpdateColumn(updateRLSPilotTableName, "admin", "admin_reviewed"); err != nil {
		t.Fatalf("admin should bypass pilot allowlist, got: %v", err)
	}
}

func TestEnforcePilotUpdatedRows(t *testing.T) {
	if err := enforcePilotUpdatedRows("some_other_table", driver.RowsAffected(1)); err != nil {
		t.Fatalf("exact non-pilot row count should pass, got: %v", err)
	}
	if err := enforcePilotUpdatedRows(updateRLSPilotTableName, driver.RowsAffected(1)); err != nil {
		t.Fatalf("exactly one updated row should pass, got: %v", err)
	}

	err := enforcePilotUpdatedRows(updateRLSPilotTableName, driver.RowsAffected(0))
	if err == nil {
		t.Fatal("expected forbidden error when pilot update touches zero rows")
	}
	var fe *forbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("err = %v, want forbiddenError", err)
	}

	err = enforcePilotUpdatedRows("some_other_table", driver.RowsAffected(0))
	if !errors.As(err, &fe) {
		t.Fatalf("non-pilot err = %v, want forbiddenError", err)
	}
}

func TestEnforcePilotUpdatedRowsPropagatesRowsAffectedError(t *testing.T) {
	err := enforcePilotUpdatedRows(updateRLSPilotTableName, rowsAffectedErrResult{})
	if err == nil {
		t.Fatal("expected wrapped rows affected error")
	}
	if !strings.Contains(err.Error(), "error verifying updated rows") || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v, want wrapped rows affected error", err)
	}
}
