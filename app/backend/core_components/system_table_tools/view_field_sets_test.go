// view_field_sets_test.go
// Verifies the pure validation and permission-filtering boundaries for field collections.
// Exists so presentation preferences cannot disclose or invent dataset columns.
package system_table_tools

import (
	"database/sql"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type viewFieldSetExecRecorder struct {
	query string
	args  []interface{}
	err   error
}

func (recorder *viewFieldSetExecRecorder) Exec(query string, args ...interface{}) (sql.Result, error) {
	recorder.query = query
	recorder.args = append([]interface{}(nil), args...)
	return nil, recorder.err
}

func (*viewFieldSetExecRecorder) Query(string, ...interface{}) (*sql.Rows, error) {
	return nil, errors.New("unexpected query")
}

func (*viewFieldSetExecRecorder) QueryRow(string, ...interface{}) *sql.Row {
	panic("unexpected query row")
}

func TestValidateViewFieldSetTargetAcceptsStableRegisteredViewKeys(t *testing.T) {
	for _, viewKey := range []string{"table", "card", "calendar", "product_card"} {
		dataset, gotView, err := validateViewFieldSetTarget("orders", viewKey)
		if err != nil || dataset != "orders" || gotView != viewKey {
			t.Fatalf("validate target = (%q, %q, %v), want orders/%s", dataset, gotView, err, viewKey)
		}
	}
}

func TestValidateViewFieldSetTargetRejectsUnsafeIdentifiers(t *testing.T) {
	if _, _, err := validateViewFieldSetTarget("orders;drop", "table"); err == nil {
		t.Fatal("unsafe dataset must be rejected")
	}
	if _, _, err := validateViewFieldSetTarget("orders", "card/view"); err == nil {
		t.Fatal("unsafe view key must be rejected")
	}
}

func TestNormalizeVisibleColumnNamesDeduplicatesWithoutReordering(t *testing.T) {
	got, err := normalizeVisibleColumnNames([]string{"title", "id", "title"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"title", "id"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalized columns = %#v, want %#v", got, want)
	}
}

func TestFilterViewFieldSetsByPermissionRemovesForbiddenColumnNames(t *testing.T) {
	sets := []viewFieldSet{{
		ID:             7,
		Name:           "Shared",
		Scope:          "shared",
		VisibleColumns: []string{"title", "private_note"},
	}}
	filtered := filterViewFieldSetsByPermission(sets, map[string]bool{"title": true})
	want := []string{"title"}
	if len(filtered) != 1 || !reflect.DeepEqual(filtered[0].VisibleColumns, want) {
		t.Fatalf("filtered field sets = %#v, want only title", filtered)
	}
}

func TestPersonalViewFieldSetOwnerExcludesGuestIdentity(t *testing.T) {
	tests := []struct {
		name   string
		userID int64
		want   sql.NullInt64
	}{
		{name: "guest", userID: 1, want: sql.NullInt64{}},
		{name: "authenticated user", userID: 42, want: sql.NullInt64{Int64: 42, Valid: true}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := personalViewFieldSetOwner(test.userID); got != test.want {
				t.Fatalf("personal owner = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestChooseEffectiveViewFieldSetAssignmentUsesPersonalGroupSitePrecedence(t *testing.T) {
	candidates := []viewFieldSetAssignmentCandidate{
		{FieldSetID: 10},
		{FieldSetID: 20, GroupID: sql.NullInt64{Int64: 43, Valid: true}, GroupPriority: 100},
		{FieldSetID: 30, UserID: sql.NullInt64{Int64: 7, Valid: true}},
	}

	selected, found := chooseEffectiveViewFieldSetAssignment(candidates)
	if !found || selected.FieldSetID != 30 || viewFieldSetAssignmentScope(selected) != "personal" {
		t.Fatalf("selected = %#v, want personal field set 30", selected)
	}
}

func TestChooseEffectiveViewFieldSetAssignmentUsesPriorityAndStableGroupTieBreak(t *testing.T) {
	candidates := []viewFieldSetAssignmentCandidate{
		{FieldSetID: 10},
		{FieldSetID: 20, GroupID: sql.NullInt64{Int64: 43, Valid: true}, GroupPriority: 50},
		{FieldSetID: 30, GroupID: sql.NullInt64{Int64: 2, Valid: true}, GroupPriority: 50},
		{FieldSetID: 40, GroupID: sql.NullInt64{Int64: 99, Valid: true}, GroupPriority: 60},
	}

	selected, found := chooseEffectiveViewFieldSetAssignment(candidates)
	if !found || selected.FieldSetID != 40 || viewFieldSetAssignmentScope(selected) != "group" {
		t.Fatalf("selected = %#v, want highest-priority group field set 40", selected)
	}

	selected, found = chooseEffectiveViewFieldSetAssignment(candidates[:3])
	if !found || selected.FieldSetID != 30 {
		t.Fatalf("tie-selected = %#v, want smaller group id field set 30", selected)
	}
}

func TestChooseEffectiveViewFieldSetAssignmentFallsBackToSite(t *testing.T) {
	selected, found := chooseEffectiveViewFieldSetAssignment([]viewFieldSetAssignmentCandidate{{FieldSetID: 10}})
	if !found || selected.FieldSetID != 10 || viewFieldSetAssignmentScope(selected) != "site" {
		t.Fatalf("selected = %#v, want site field set 10", selected)
	}
	if _, found := chooseEffectiveViewFieldSetAssignment(nil); found {
		t.Fatal("empty assignments must fall through to metadata defaults")
	}
}

func TestNormalizeViewFieldSetGroupTargetsDeduplicatesAndSorts(t *testing.T) {
	got, err := normalizeViewFieldSetGroupTargets([]int64{43, 2, 43}, 50)
	if err != nil {
		t.Fatal(err)
	}
	want := []int64{2, 43}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalized groups = %#v, want %#v", got, want)
	}
}

func TestNormalizeViewFieldSetGroupTargetsRejectsUnsafeInputs(t *testing.T) {
	if _, err := normalizeViewFieldSetGroupTargets([]int64{0}, 0); err == nil {
		t.Fatal("non-positive group id must be rejected")
	}
	if _, err := normalizeViewFieldSetGroupTargets(nil, maximumViewFieldSetGroupPriority+1); err == nil {
		t.Fatal("unbounded group priority must be rejected")
	}
}

func TestNormalizeViewFieldSetTargetScopeDistinguishesSiteAndGroups(t *testing.T) {
	scope, err := normalizeViewFieldSetTargetScope(true, "site", nil)
	if err != nil || scope != "site" {
		t.Fatalf("site scope = %q, %v", scope, err)
	}
	scope, err = normalizeViewFieldSetTargetScope(true, "groups", []int64{2, 43})
	if err != nil || scope != "groups" {
		t.Fatalf("group scope = %q, %v", scope, err)
	}
	if _, err := normalizeViewFieldSetTargetScope(true, "groups", nil); err == nil {
		t.Fatal("group scope without groups must be rejected")
	}
	if _, err := normalizeViewFieldSetTargetScope(true, "site", []int64{2}); err == nil {
		t.Fatal("site scope with explicit groups must be rejected")
	}
}

func TestViewFieldSetTargetReadbackMatchesExactSiteAndGroupTargets(t *testing.T) {
	fieldSetID := int64(91)
	otherFieldSetID := int64(92)
	groupAssignments := []viewFieldSetGroupAssignment{
		{GroupID: 2, FieldSetID: &fieldSetID},
		{GroupID: 7, FieldSetID: &otherFieldSetID},
		{GroupID: 43, FieldSetID: &fieldSetID},
	}

	if !viewFieldSetTargetReadbackMatches(
		fieldSetID,
		"groups",
		[]int64{2, 43},
		&otherFieldSetID,
		groupAssignments,
	) {
		t.Fatal("exact group target readback should match")
	}
	if viewFieldSetTargetReadbackMatches(
		fieldSetID,
		"groups",
		[]int64{43},
		&otherFieldSetID,
		groupAssignments,
	) {
		t.Fatal("stale group target must fail exact readback")
	}
	if !viewFieldSetTargetReadbackMatches(
		fieldSetID,
		"site",
		nil,
		&fieldSetID,
		nil,
	) {
		t.Fatal("exact site target readback should match")
	}
	if viewFieldSetTargetReadbackMatches(
		fieldSetID,
		"site",
		nil,
		&fieldSetID,
		groupAssignments,
	) {
		t.Fatal("site target must reject stale group targets for the same collection")
	}
}

func TestReplaceSharedViewFieldSetAssignmentTargetsScopesDeletionToOneCollection(t *testing.T) {
	recorder := &viewFieldSetExecRecorder{}
	if err := replaceSharedViewFieldSetAssignmentTargets(recorder, 81, 4, 91); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(recorder.query, "table_uid = $1 AND view_id = $2 AND field_set_id = $3") {
		t.Fatalf("replacement delete is not scoped to the exact collection: %s", recorder.query)
	}
	if !strings.Contains(recorder.query, "user_id IS NULL") {
		t.Fatalf("replacement delete could touch personal assignments: %s", recorder.query)
	}
	if want := []interface{}{81, 4, int64(91)}; !reflect.DeepEqual(recorder.args, want) {
		t.Fatalf("replacement arguments = %#v, want %#v", recorder.args, want)
	}
}

func TestNormalizeViewFieldSetGroupVariantsRequiresExactTargetsAndPreservesOrder(t *testing.T) {
	variants, err := normalizeViewFieldSetGroupVariants([]saveViewFieldSetGroupVariant{
		{GroupID: 9, GroupPriority: 5, VisibleColumns: []string{"title", "id", "title"}},
		{GroupID: 2, GroupPriority: 7, VisibleColumns: []string{"id", "summary"}},
	}, []int64{2, 9})
	if err != nil {
		t.Fatal(err)
	}
	want := []saveViewFieldSetGroupVariant{
		{GroupID: 2, GroupPriority: 7, VisibleColumns: []string{"id", "summary"}},
		{GroupID: 9, GroupPriority: 5, VisibleColumns: []string{"title", "id"}},
	}
	if !reflect.DeepEqual(variants, want) {
		t.Fatalf("normalized variants = %#v, want %#v", variants, want)
	}
	if _, err := normalizeViewFieldSetGroupVariants(variants[:1], []int64{2, 9}); err == nil {
		t.Fatal("partial variants must fail closed")
	}
	if _, err := normalizeViewFieldSetGroupVariants([]saveViewFieldSetGroupVariant{
		{GroupID: 2, VisibleColumns: []string{"id"}},
		{GroupID: 2, VisibleColumns: []string{"title"}},
	}, []int64{2, 9}); err == nil {
		t.Fatal("duplicate group variants must fail closed")
	}
}

func TestMixedViewFieldSetNameIsDeterministicAndContentSpecific(t *testing.T) {
	first := mixedViewFieldSetName(strings.Repeat("long name ", 30), []string{"id", "title"})
	second := mixedViewFieldSetName(strings.Repeat("long name ", 30), []string{"id", "title"})
	different := mixedViewFieldSetName(strings.Repeat("long name ", 30), []string{"title", "id"})
	if first != second || first == different {
		t.Fatalf("variant names are not deterministic/content-specific: %q %q %q", first, second, different)
	}
	if len([]rune(first)) > 128 {
		t.Fatalf("variant name has %d runes, want at most 128", len([]rune(first)))
	}
}

func TestViewFieldSetGroupVariantsReadbackRequiresExactFieldSetsPrioritiesAndColumns(t *testing.T) {
	fieldSet31 := int64(31)
	fieldSet32 := int64(32)
	saved := []savedViewFieldSetGroupVariant{
		{GroupID: 2, FieldSetID: 31, GroupPriority: 7, VisibleColumns: []string{"id", "title"}},
		{GroupID: 9, FieldSetID: 32, GroupPriority: 5, VisibleColumns: []string{"summary"}},
	}
	sets := []viewFieldSet{
		{ID: 31, VisibleColumns: []string{"id", "title"}},
		{ID: 32, VisibleColumns: []string{"summary"}},
	}
	assignments := []viewFieldSetGroupAssignment{
		{GroupID: 2, FieldSetID: &fieldSet31, GroupPriority: 7},
		{GroupID: 9, FieldSetID: &fieldSet32, GroupPriority: 5},
	}
	if !viewFieldSetGroupVariantsReadbackMatches(saved, sets, assignments) {
		t.Fatal("exact group-variant readback should match")
	}
	assignments[1].GroupPriority = 6
	if viewFieldSetGroupVariantsReadbackMatches(saved, sets, assignments) {
		t.Fatal("priority mismatch must fail readback")
	}
}
