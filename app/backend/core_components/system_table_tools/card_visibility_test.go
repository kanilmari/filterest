package system_table_tools

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func TestScheduleCardVisibilitySchemaCacheInvalidationDefersToCommitHook(t *testing.T) {
	calledWith := ""
	lazyTx := dbutils.NewLazyTx(nil)
	ctx := dbutils.SetLazyTx(context.Background(), lazyTx)

	scheduleCardVisibilitySchemaCacheInvalidation(ctx, "travel_deals", func(tableName string) {
		calledWith = tableName
	})

	if calledWith != "" {
		t.Fatalf("cache invalidated before commit for %q", calledWith)
	}
}

func TestScheduleCardVisibilitySchemaCacheInvalidationFallsBackWithoutLazyTx(t *testing.T) {
	calledWith := ""
	scheduleCardVisibilitySchemaCacheInvalidation(
		context.Background(),
		"travel_deals",
		func(tableName string) { calledWith = tableName },
	)

	if calledWith != "travel_deals" {
		t.Fatalf("fallback invalidation table = %q, want travel_deals", calledWith)
	}
}

func TestNormalizeCardDetailsLayout(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "single line", input: "single_line", want: "single_line"},
		{name: "stacked", input: "stacked", want: "stacked"},
		{name: "inline", input: "inline", want: "inline"},
		{name: "conditional multiline", input: "conditional_multiline", want: "conditional_multiline"},
		{name: "legacy multiline", input: "multiline", want: "conditional_multiline"},
		{name: "unknown fallback", input: "legacy", want: "conditional_multiline"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCardDetailsLayout(tt.input); got != tt.want {
				t.Fatalf("normalizeCardDetailsLayout(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeCardStyleVariant(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "standard", input: "standard", want: "standard"},
		{name: "modern", input: "modern", want: "modern"},
		{name: "unknown fallback", input: "floating", want: "standard"},
		{name: "empty fallback", input: "", want: "standard"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCardStyleVariant(tt.input); got != tt.want {
				t.Fatalf("normalizeCardStyleVariant(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeCardDetailIconKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "lowercase valid key", input: "Calendar-Clock", want: "calendar-clock"},
		{name: "allows underscore", input: "custom_key", want: "custom_key"},
		{name: "rejects spaces", input: "bad key", want: ""},
		{name: "empty fallback", input: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCardDetailIconKey(tt.input); got != tt.want {
				t.Fatalf("normalizeCardDetailIconKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeNullableCardDetailIconKey(t *testing.T) {
	empty := normalizeNullableCardDetailIconKey("")
	if empty.Valid {
		t.Fatalf("empty icon key should normalize to NULL, got %q", empty.String)
	}

	valid := normalizeNullableCardDetailIconKey(" Bolt-Pattern ")
	if !valid.Valid || valid.String != "bolt-pattern" {
		t.Fatalf("valid icon key = (%q, %v), want (%q, true)", valid.String, valid.Valid, "bolt-pattern")
	}
}

func TestNormalizeFieldViewColumnsUsesRequestOrderAsGlobalOrder(t *testing.T) {
	guards := []fieldViewColumnGuard{
		{ColumnUID: 1, ColumnName: "id", LockReason: "primary_key"},
		{ColumnUID: 2, ColumnName: "title"},
		{ColumnUID: 3, ColumnName: "summary"},
	}
	requested := []CardVisibilityColumn{
		{ColumnUID: 3, ColumnName: "untrusted-summary", HideEverywhere: true, ClientDeliveryMode: "include"},
		{ColumnUID: 1, ColumnName: "untrusted-id", HideEverywhere: false, ClientDeliveryMode: "include"},
		{ColumnUID: 2, ColumnName: "untrusted-title", HideEverywhere: false, ClientDeliveryMode: "include"},
	}

	got, err := normalizeFieldViewColumns(guards, requested)
	if err != nil {
		t.Fatalf("normalizeFieldViewColumns() error = %v", err)
	}
	wantOrder := []int{3, 1, 2}
	gotOrder := []int{got[0].ColumnUID, got[1].ColumnUID, got[2].ColumnUID}
	if !reflect.DeepEqual(gotOrder, wantOrder) {
		t.Fatalf("column order = %#v, want %#v", gotOrder, wantOrder)
	}
	for index, column := range got {
		if column.CoNumber != index+1 {
			t.Fatalf("column %d co_number = %d, want %d", column.ColumnUID, column.CoNumber, index+1)
		}
	}
	if got[1].ColumnName != "id" || got[1].HideEverywhereLocked || !got[1].ClientDeliveryModeLocked {
		t.Fatalf("id metadata = %#v, want visually hideable but delivery-locked id", got[1])
	}
}

func TestNormalizeFieldViewColumnsRejectsIncompleteDuplicateAndForeignLists(t *testing.T) {
	guards := []fieldViewColumnGuard{
		{ColumnUID: 1, ColumnName: "id", LockReason: "primary_key"},
		{ColumnUID: 2, ColumnName: "title"},
	}
	tests := []struct {
		name      string
		requested []CardVisibilityColumn
		wantError string
	}{
		{
			name:      "incomplete",
			requested: []CardVisibilityColumn{{ColumnUID: 1}},
			wantError: "all 2 dataset fields",
		},
		{
			name: "duplicate",
			requested: []CardVisibilityColumn{
				{ColumnUID: 1, ClientDeliveryMode: "include"},
				{ColumnUID: 1, ClientDeliveryMode: "include"},
			},
			wantError: "appears more than once",
		},
		{
			name: "foreign uid",
			requested: []CardVisibilityColumn{
				{ColumnUID: 1, ClientDeliveryMode: "include"},
				{ColumnUID: 99, ClientDeliveryMode: "include"},
			},
			wantError: "does not belong",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := normalizeFieldViewColumns(guards, testCase.requested)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want text %q", err, testCase.wantError)
			}
		})
	}
}

func TestNormalizeFieldViewColumnsAllowsVisualIDHiding(t *testing.T) {
	guards := []fieldViewColumnGuard{
		{ColumnUID: 1, ColumnName: "id"},
		{ColumnUID: 2, ColumnName: "title"},
	}

	columns, err := normalizeFieldViewColumns(
		guards,
		[]CardVisibilityColumn{
			{ColumnUID: 1, HideEverywhere: true, ClientDeliveryMode: "include"},
			{ColumnUID: 2, HideEverywhere: false, ClientDeliveryMode: "include"},
		},
	)
	if err != nil || len(columns) != 2 || !columns[0].HideEverywhere {
		t.Fatalf("hidden id = (%#v, %v), want visually hidden transport id", columns, err)
	}
}

func TestNormalizeFieldViewColumnsKeepsIDAsClientTransportButAllowsVisualHidingElsewhere(t *testing.T) {
	guards := []fieldViewColumnGuard{
		{ColumnUID: 1, ColumnName: "id", LockReason: "primary_key"},
		{ColumnUID: 2, ColumnName: "embedding_vector"},
	}

	_, err := normalizeFieldViewColumns(
		guards,
		[]CardVisibilityColumn{
			{ColumnUID: 1, ClientDeliveryMode: "server_only"},
			{ColumnUID: 2, ClientDeliveryMode: "server_only"},
		},
	)
	if err == nil || !strings.Contains(err.Error(), "client transport key") {
		t.Fatalf("id server-only error = %v, want client transport rejection", err)
	}

	columns, err := normalizeFieldViewColumns(
		guards,
		[]CardVisibilityColumn{
			{ColumnUID: 1, ClientDeliveryMode: "include"},
			{ColumnUID: 2, ClientDeliveryMode: "server_only"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !columns[0].ClientDeliveryModeLocked || columns[0].ClientDeliveryMode != "include" {
		t.Fatalf("id delivery = %#v, want locked include", columns[0])
	}
	if columns[1].ClientDeliveryMode != "server_only" {
		t.Fatalf("embedding delivery = %q, want server_only", columns[1].ClientDeliveryMode)
	}
}

func TestNormalizeFieldViewColumnsRejectsMissingClientDeliveryMode(t *testing.T) {
	guards := []fieldViewColumnGuard{{ColumnUID: 2, ColumnName: "embedding_vector"}}
	_, err := normalizeFieldViewColumns(
		guards,
		[]CardVisibilityColumn{{ColumnUID: 2}},
	)
	if err == nil || !strings.Contains(err.Error(), "invalid client delivery mode") {
		t.Fatalf("missing client delivery mode error = %v, want fail-closed rejection", err)
	}
}

func TestNormalizeFieldViewColumnsRequiresOneVisibleField(t *testing.T) {
	guards := []fieldViewColumnGuard{
		{ColumnUID: 2, ColumnName: "title"},
		{ColumnUID: 3, ColumnName: "summary"},
	}

	_, err := normalizeFieldViewColumns(
		guards,
		[]CardVisibilityColumn{
			{ColumnUID: 2, HideEverywhere: true, ClientDeliveryMode: "include"},
			{ColumnUID: 3, HideEverywhere: true, ClientDeliveryMode: "include"},
		},
	)
	if err == nil || !strings.Contains(err.Error(), "at least one") {
		t.Fatalf("all-hidden field list error = %v, want at-least-one-visible guard", err)
	}
}

func TestFieldViewGuardQueryProtectsRuntimeAndRequiredInputs(t *testing.T) {
	for _, contract := range []string{
		"LEFT JOIN information_schema.columns columns",
		"constraints.constraint_type = 'PRIMARY KEY'",
		"sdt.row_policy_owner_column = scd.column_name",
		"columns.is_nullable = 'NO'",
		"columns.column_default IS NULL",
		"COALESCE(scd.insertable, true) = true",
	} {
		if !strings.Contains(fieldViewColumnGuardQuery, contract) {
			t.Fatalf("field-view guard query missing %q", contract)
		}
	}
}

func TestFieldViewOrderQueryStaysDatasetScopedWithoutReorderingSavedCollections(t *testing.T) {
	for _, contract := range []string{
		"details.column_uid = $2",
		"WHERE table_name = $3",
	} {
		if !strings.Contains(updateFieldViewColumnOrderQuery, contract) {
			t.Fatalf("field order query missing %q", contract)
		}
	}
	if strings.Contains(updateFieldViewColumnOrderQuery, "system_column_field_set_members") {
		t.Fatal("global metadata order must not overwrite a user's saved field collection order")
	}
}
