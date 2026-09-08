// get_results_metadata_test.go
// Verifies result metadata and optional column layout transport.
// Connects supported schema shapes to safe client-visible metadata.
// Preserves inheritance and hidden-field delivery restrictions.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"
)

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
		{name: "unknown fallback", input: "floating", want: "conditional_multiline"},
		{name: "empty fallback", input: "", want: "conditional_multiline"},
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
		{name: "modern", input: "modern", want: "modern"},
		{name: "standard", input: "standard", want: "standard"},
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

func TestResolveOwnerColumnFromMetadataPrefersExplicitColumn(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
	}

	got := resolveOwnerColumnFromMetadata("user_id", columns)
	if got.Column != "user_id" {
		t.Fatalf("owner column = %q, want user_id", got.Column)
	}
	if got.Source != ownerColumnSourceExplicitMetadata {
		t.Fatalf("owner source = %q, want %q", got.Source, ownerColumnSourceExplicitMetadata)
	}
}

func TestResolveOwnerColumnWithLegacyShadowRecordsExplicitDivergence(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
	}

	got := resolveOwnerColumnWithLegacyShadow("user_id", columns)
	if got.Column != "user_id" {
		t.Fatalf("owner column = %q, want user_id", got.Column)
	}
	if got.LegacyFallbackColumn != "created_by" {
		t.Fatalf("legacy shadow owner = %q, want created_by", got.LegacyFallbackColumn)
	}
	if got.MatchesLegacyFallback {
		t.Fatalf("expected explicit user_id to diverge from legacy created_by")
	}
	if !got.ComparedWithLegacyFallback {
		t.Fatalf("expected legacy comparison to be marked")
	}
}

func TestResolveOwnerColumnWithLegacyShadowMatchesFallbackWhenExplicitInvalid(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
	}

	got := resolveOwnerColumnWithLegacyShadow("missing_owner", columns)
	if got.Column != "created_by" {
		t.Fatalf("owner column = %q, want created_by", got.Column)
	}
	if got.LegacyFallbackColumn != "created_by" {
		t.Fatalf("legacy shadow owner = %q, want created_by", got.LegacyFallbackColumn)
	}
	if !got.MatchesLegacyFallback {
		t.Fatalf("expected invalid explicit metadata to match legacy fallback")
	}
}

func TestResolveOwnerColumnFromMetadataFallsBackWhenExplicitColumnMissing(t *testing.T) {
	columns := map[string]bool{
		"created_by": true,
		"user_id":    true,
		"id":         true,
	}

	got := resolveOwnerColumnFromMetadata("missing_owner", columns)
	if got.Column != "created_by" {
		t.Fatalf("owner column = %q, want created_by", got.Column)
	}
	if got.Source != ownerColumnSourceLegacyFallback {
		t.Fatalf("owner source = %q, want %q", got.Source, ownerColumnSourceLegacyFallback)
	}
}

func TestResolveOwnerColumnFromMetadataKeepsLegacyFallbackOrder(t *testing.T) {
	tests := []struct {
		name    string
		columns map[string]bool
		want    string
	}{
		{name: "created_by first", columns: map[string]bool{"created_by": true, "user_id": true, "id": true}, want: "created_by"},
		{name: "user_id before id", columns: map[string]bool{"user_id": true, "id": true}, want: "user_id"},
		{name: "id compatibility", columns: map[string]bool{"id": true}, want: "id"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveOwnerColumnFromMetadata("", tt.columns)
			if got.Column != tt.want {
				t.Fatalf("owner column = %q, want %q", got.Column, tt.want)
			}
			if got.Source != ownerColumnSourceLegacyFallback {
				t.Fatalf("owner source = %q, want %q", got.Source, ownerColumnSourceLegacyFallback)
			}
		})
	}
}

func TestNormalizeResultsViewKeyKeepsSafeViewDimensions(t *testing.T) {
	for _, viewKey := range []string{"table", "card", "calendar", "product_card", "article_view"} {
		if got := normalizeResultsViewKey(viewKey); got != viewKey {
			t.Fatalf("normalizeResultsViewKey(%q) = %q", viewKey, got)
		}
	}
	for _, unsafe := range []string{"", "calendar/view", "x;drop"} {
		if got := normalizeResultsViewKey(unsafe); got != "table" {
			t.Fatalf("normalizeResultsViewKey(%q) = %q, want table fallback", unsafe, got)
		}
	}
}

func TestArticleResultsUseIndependentFieldSetAssignments(t *testing.T) {
	if !resultsViewUsesFieldSetAssignment("article_view") {
		t.Fatal("article projection must resolve its own field-set assignment")
	}
	for _, viewKey := range []string{"table", "card", "calendar", "product_card"} {
		if !resultsViewUsesFieldSetAssignment(viewKey) {
			t.Fatalf("%s projection should keep its own field-set assignment", viewKey)
		}
	}
}

func TestPersonalFieldSetAssignmentUserExcludesGuestIdentity(t *testing.T) {
	tests := []struct {
		name   string
		userID int
		want   sql.NullInt64
	}{
		{name: "guest", userID: 1, want: sql.NullInt64{}},
		{name: "authenticated user", userID: 42, want: sql.NullInt64{Int64: 42, Valid: true}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := personalFieldSetAssignmentUser(test.userID); got != test.want {
				t.Fatalf("assignment user = %#v, want %#v", got, test.want)
			}
		})
	}
}

type layoutMetadataDriver struct {
	present bool
	value   driver.Value
	query   *string
}
type layoutMetadataConn struct{ state *layoutMetadataDriver }
type layoutMetadataRows struct {
	values   []driver.Value
	consumed bool
}

func (d *layoutMetadataDriver) Open(string) (driver.Conn, error) {
	return &layoutMetadataConn{state: d}, nil
}
func (*layoutMetadataConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (*layoutMetadataConn) Close() error              { return nil }
func (*layoutMetadataConn) Begin() (driver.Tx, error) { return nil, fmt.Errorf("unexpected mutation") }
func (c *layoutMetadataConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "SELECT EXISTS") {
		present := true
		if args[1].Value == "label_value_layout" {
			present = c.state.present
		}
		return &layoutMetadataRows{values: []driver.Value{present}}, nil
	}
	*c.state.query = query
	value := c.state.value
	if !c.state.present {
		value = nil
	}
	return &layoutMetadataRows{values: []driver.Value{
		"url", "text", nil, nil, "details_link", true, true, false, false, false, false, false, false,
		int64(1), int64(1), false, "", "", true, "label", value,
	}}, nil
}
func (r *layoutMetadataRows) Columns() []string {
	columns := make([]string, len(r.values))
	for index := range columns {
		columns[index] = fmt.Sprint(index)
	}
	return columns
}
func (*layoutMetadataRows) Close() error { return nil }
func (r *layoutMetadataRows) Next(dest []driver.Value) error {
	if r.consumed {
		return io.EOF
	}
	copy(dest, r.values)
	r.consumed = true
	return nil
}

func TestColumnMetadataCarriesOptionalLayoutWithoutExposingHiddenFields(t *testing.T) {
	tests := []struct {
		name    string
		present bool
		value   driver.Value
	}{
		{"older schema", false, nil}, {"inherited", true, nil}, {"inline", true, "inline"}, {"auto", true, "auto"}, {"stacked", true, "stacked"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query := ""
			name := "wl52-layout-" + t.Name()
			sql.Register(name, &layoutMetadataDriver{present: tt.present, value: tt.value, query: &query})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			metadata, err := getColumnDataTypesWithFK("example", db)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(metadata)
			if err != nil {
				t.Fatal(err)
			}
			var result map[string]map[string]interface{}
			if err = json.Unmarshal(encoded, &result); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(result["url"]["label_value_layout"], tt.value) {
				t.Fatalf("layout %s", encoded)
			}
			for _, guard := range []string{"COALESCE(scd.hide_everywhere, false) = false", "COALESCE(scd.client_delivery_mode, 'include') = 'include'"} {
				if !strings.Contains(query, guard) {
					t.Fatalf("missing delivery guard %s", guard)
				}
			}
			if !tt.present && !strings.Contains(query, "NULL::varchar AS label_value_layout") {
				t.Fatal("old schema must remain readable")
			}
		})
	}
}

func TestLegacyArticleViewKeysRemainCompatible(t *testing.T) {
	for _, key := range []string{"article", "big_card", "row_article", " ARTICLE "} {
		if got := normalizeResultsViewKey(key); got != "article_view" {
			t.Fatalf("%q resolved to %q", key, got)
		}
	}
}
