// add_row_reference_recheck_test.go
// Unit tests for recheckReferencesAfterInsert: which references the add-row path checks again after its INSERTs.
// Replaces the repeated check so the rows chosen and the refusal returned can be tested without a database.
// Exists because, since WL124 stage 2a, account-table rows are checked without a lock and must be checked again then.
package dtt_1_row_create

import (
	"database/sql"
	"errors"
	"reflect"
	"testing"
)

type recheckCall struct {
	tableName string
	rowIDs    []int64
}

// replaceRecheck records every repeated check, as alice (user 4, basic), and reports the named tables' rows hidden.
func replaceRecheck(t *testing.T, hidden ...string) *[]recheckCall {
	t.Helper()
	calls := &[]recheckCall{}
	hiddenTables := map[string]bool{}
	for _, tableName := range hidden {
		hiddenTables[tableName] = true
	}
	original := recheckRowsVisibleAfterInsert
	recheckRowsVisibleAfterInsert = func(_ *sql.Tx, tableName, userRole string, userID int, rowIDs []int64) (bool, error) {
		if userRole != "basic" || userID != 4 {
			t.Errorf("recheck as %s %d, want the request's actor basic 4", userRole, userID)
		}
		*calls = append(*calls, recheckCall{tableName: tableName, rowIDs: append([]int64(nil), rowIDs...)})
		return !hiddenTables[tableName], nil
	}
	t.Cleanup(func() { recheckRowsVisibleAfterInsert = original })
	return calls
}

func TestRecheckReferencesAfterInsertRepeatsEveryReadCheck(t *testing.T) {
	calls := replaceRecheck(t)
	references := []checkedReference{{tableName: "system_users", rowID: 12}, {tableName: "palvelukatalogi", rowID: 3}}
	links := []resolvedExistingLink{
		{Kind: existingRelationManyToMany, RelatedTableName: "system_user_groups", RowIDs: []int64{5, 6}},
		// A one-to-many link updates its related rows, which LockRowsVisibleForMutation locked FOR UPDATE.
		{Kind: existingRelationOneToMany, RelatedTableName: "tiketit_assets", RowIDs: []int64{9}},
	}
	if err := recheckReferencesAfterInsert(nil, references, links, 4, "basic"); err != nil {
		t.Fatalf("every row still visible: %v", err)
	}
	// Which of these are read again is RecheckRowsVisibleAfterInsert's choice: only the account and rights tables.
	want := []recheckCall{
		{tableName: "system_users", rowIDs: []int64{12}},
		{tableName: "palvelukatalogi", rowIDs: []int64{3}},
		{tableName: "system_user_groups", rowIDs: []int64{5, 6}},
	}
	if !reflect.DeepEqual(*calls, want) {
		t.Fatalf("rechecked %+v, want %+v", *calls, want)
	}
}

func TestRecheckReferencesAfterInsertRefusesARowHiddenSinceTheFirstCheck(t *testing.T) {
	for _, test := range []struct {
		name       string
		references []checkedReference
		links      []resolvedExistingLink
		hidden     string
		want       string
	}{
		{
			name:       "the new row's own reference",
			references: []checkedReference{{tableName: "system_users", rowID: 12}},
			hidden:     "system_users",
			want:       foreignRowUnreadable,
		},
		{
			name:   "a many-to-many link",
			links:  []resolvedExistingLink{{Kind: existingRelationManyToMany, RelatedTableName: "system_user_groups", RowIDs: []int64{5}}},
			hidden: "system_user_groups",
			want:   relatedRowsUnreadable,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			replaceRecheck(t, test.hidden)
			err := recheckReferencesAfterInsert(nil, test.references, test.links, 4, "basic")
			var forbidden *forbiddenError
			if !errors.As(err, &forbidden) || forbidden.msg != test.want {
				t.Fatalf("error = %v, want the first check's refusal %q", err, test.want)
			}
		})
	}
}

func TestRecheckReferencesAfterInsertPassesADatabaseErrorOn(t *testing.T) {
	failure := errors.New("connection lost")
	original := recheckRowsVisibleAfterInsert
	recheckRowsVisibleAfterInsert = func(*sql.Tx, string, string, int, []int64) (bool, error) { return false, failure }
	t.Cleanup(func() { recheckRowsVisibleAfterInsert = original })
	err := recheckReferencesAfterInsert(nil, []checkedReference{{tableName: "system_users", rowID: 12}}, nil, 4, "basic")
	var forbidden *forbiddenError
	if !errors.Is(err, failure) || errors.As(err, &forbidden) {
		t.Fatalf("error = %v, want the database error itself, not a refusal", err)
	}
}
