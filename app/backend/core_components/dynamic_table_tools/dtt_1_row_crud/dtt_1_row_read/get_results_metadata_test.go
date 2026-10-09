// get_results_metadata_test.go
// Verifies result metadata and the retired column layout boundary.
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
	"sort"
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

// The owner rule, applied to metadata already read. The second argument set is
// the columns the system catalog vouches for as validated foreign keys to
// system_users(id); everything else is refused with an explanation.
func TestSelectRowPolicyOwnerColumnAcceptsNamedUserForeignKey(t *testing.T) {
	owner, refusal := selectRowPolicyOwnerColumn("articles", " created_by ", map[string]bool{"created_by": true})
	if owner != "created_by" || refusal != "" {
		t.Fatalf("owner = %q (refusal %q), want the named, validated created_by", owner, refusal)
	}
}

func TestSelectRowPolicyOwnerColumnRefusesNamedColumnThatIsNotUserForeignKey(t *testing.T) {
	for _, userForeignKeyColumns := range []map[string]bool{nil, {}, {"editor_id": true}} {
		owner, refusal := selectRowPolicyOwnerColumn("articles", "user_id", userForeignKeyColumns)
		if owner != "" {
			t.Fatalf("owner = %q with foreign keys %v, want no owner", owner, userForeignKeyColumns)
		}
		if !strings.Contains(refusal, `"user_id" is not a validated single-column foreign key to system_users(id)`) {
			t.Fatalf("refusal = %q, want it to name the column and the missing foreign key", refusal)
		}
	}
}

// id is never guessed, and neither is any other column: a dataset that names no
// owner has none, even when created_by and user_id are real user foreign keys.
func TestSelectRowPolicyOwnerColumnNeverInfersAnOwner(t *testing.T) {
	everyCandidate := map[string]bool{"created_by": true, "user_id": true, "id": true}
	owner, refusal := selectRowPolicyOwnerColumn("system_about", "", everyCandidate)
	if owner != "" || refusal != rowOwnerRefusalNoneNamed {
		t.Fatalf("owner = %q (refusal %q), want no owner and the none-named refusal", owner, refusal)
	}

	owner, refusal = selectRowPolicyOwnerColumn("system_about", "id", map[string]bool{"created_by": true})
	if owner != "" || refusal == "" {
		t.Fatalf("owner = %q (refusal %q), want a named id refused when id is not a user foreign key", owner, refusal)
	}
}

// Only system_users owns itself, and the pilot keeps its enforced user_id; both
// are fixed in code, so no setting can move them or lend them to another table.
func TestSelectRowPolicyOwnerColumnUsesBuiltInOwnersRegardlessOfSetting(t *testing.T) {
	tests := []struct {
		tableName string
		explicit  string
		want      string
	}{
		{tableName: "system_users", explicit: "", want: "id"},
		{tableName: "system_users", explicit: "created_by", want: "id"},
		{tableName: rlsPilotTableName, explicit: "user_id", want: rlsPilotOwnerColumn},
		{tableName: rlsPilotTableName, explicit: "", want: rlsPilotOwnerColumn},
	}
	for _, tt := range tests {
		owner, refusal := selectRowPolicyOwnerColumn(tt.tableName, tt.explicit, nil)
		if owner != tt.want || refusal != "" {
			t.Fatalf("%s with setting %q: owner = %q (refusal %q), want %q", tt.tableName, tt.explicit, owner, refusal, tt.want)
		}
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
	dataType          string
	defaultView       driver.Value
	defaultViewColumn bool
	detailColumn      bool
	cardDetailColumns driver.Value
	tableMeta         bool
	styleColumn       bool
	cardStyle         driver.Value
	editable          bool
	query             *string
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
		if c.state.tableMeta && args[1].Value == "default_view_id" {
			present = c.state.defaultViewColumn
		}
		if c.state.tableMeta && args[1].Value == "card_detail_columns" {
			present = c.state.detailColumn
		}
		if c.state.tableMeta && args[1].Value == "card_style_variant" {
			present = c.state.styleColumn
		}
		if args[1].Value == "label_value_layout" {
			return nil, fmt.Errorf("retired column presence read")
		}
		return &layoutMetadataRows{values: []driver.Value{present}}, nil
	}
	*c.state.query = query
	if c.state.tableMeta {
		return &layoutMetadataRows{values: []driver.Value{"conditional_multiline", c.state.cardStyle, c.state.cardDetailColumns, c.state.defaultView}}, nil
	}
	dataType := c.state.dataType
	if dataType == "" {
		dataType = "text"
	}
	return &layoutMetadataRows{values: []driver.Value{
		"url", dataType, nil, nil, "details_link", true, true, false, false, false, false, false, false,
		int64(1), int64(1), false, c.state.editable, "", "", true, "label",
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

func TestColumnMetadataOmitsRetiredLayoutWithoutExposingHiddenFields(t *testing.T) {
	query := ""
	const name = "wl52-retired-layout-metadata"
	sql.Register(name, &layoutMetadataDriver{query: &query})
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
	if _, exists := result["url"]["label_value_layout"]; exists || strings.Contains(query, "label_value_layout") {
		t.Fatalf("retired layout in query or metadata: %s %s", query, encoded)
	}
	if result["url"]["show_key_on_card"] != true || result["url"]["show_value_on_card"] != true {
		t.Fatalf("visibility lost: %s", encoded)
	}
	for _, guard := range []string{"public.resolve_card_label_visibility(scd.show_key_on_card, scd.card_element) AS show_key_on_card", "COALESCE(scd.hide_everywhere, false) = false", "COALESCE(scd.client_delivery_mode, 'include') = 'include'"} {
		if !strings.Contains(query, guard) {
			t.Fatalf("missing delivery guard %s", guard)
		}
	}
}

func TestLegacyArticleViewKeysRemainCompatible(t *testing.T) {
	for _, key := range []string{"article", "big_card", "row_article", " ARTICLE "} {
		if got := normalizeResultsViewKey(key); got != "article_view" {
			t.Fatalf("%q resolved to %q", key, got)
		}
	}
}

// The article language editor requires an explicit true value; omitting this
// field hides every otherwise editable multilingual header and description.
func TestColumnMetadataCarriesExplicitEditability(t *testing.T) {
	for _, editable := range []bool{false, true} {
		t.Run(fmt.Sprint(editable), func(t *testing.T) {
			query := ""
			name := "wl61-editability-" + t.Name()
			sql.Register(name, &layoutMetadataDriver{editable: editable, query: &query})
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
			got, explicit := result["url"]["editable_in_ui"].(bool)
			if !explicit || got != editable {
				t.Fatalf("explicit editable_in_ui = %#v, want %t", result["url"]["editable_in_ui"], editable)
			}
			if !strings.Contains(query, "COALESCE(scd.editable_in_ui, false) AS editable_in_ui") {
				t.Fatal("missing metadata must remain noneditable")
			}
		})
	}
}

func TestColumnMetadataCarriesDeclaredNumericScale(t *testing.T) {
	query := ""
	const driverName = "column-description-numeric-scale"
	sql.Register(driverName, &layoutMetadataDriver{
		dataType: "numeric(18,2)",
		query:    &query,
	})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	metadata, err := getColumnDataTypesWithFK("subscriptions", db)
	if err != nil {
		t.Fatal(err)
	}
	columnInfo, ok := metadata["url"].(map[string]interface{})
	if !ok {
		t.Fatalf("column description type = %T, want map[string]interface{}", metadata["url"])
	}
	if got := columnInfo["data_type"]; got != "numeric(18,2)" {
		t.Fatalf("data_type = %#v, want numeric(18,2)", got)
	}
	for _, requiredFragment := range []string{
		"WHEN c.data_type = 'numeric'",
		"pg_catalog.format_type(type_column.atttypid, type_column.atttypmod)",
	} {
		if !strings.Contains(query, requiredFragment) {
			t.Fatalf("column metadata query missing %q", requiredFragment)
		}
	}
}

// TestDatasetColumnDescriptionsConformToBuilderFieldSet prevents an ordinary
// dataset column and a dataset-specific overlay from publishing different
// description contracts. The builder owns the expected fields, so adding a
// field there automatically extends this check without another hand-kept list.
func TestDatasetColumnDescriptionsConformToBuilderFieldSet(t *testing.T) {
	query := ""
	const driverName = "column-description-conformance"
	sql.Register(driverName, &layoutMetadataDriver{query: &query})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	metadata, err := getColumnDataTypesWithFK(serviceCatalogModerationTableName, db)
	if err != nil {
		t.Fatal(err)
	}
	if len(metadata) != len(serviceCatalogModerationColumns)+1 {
		t.Fatalf("metadata returned %d columns, want one ordinary column and %d moderation columns", len(metadata), len(serviceCatalogModerationColumns))
	}

	expectedFields := sortedColumnDescriptionFields(buildColumnDescription(nil))
	for columnName, rawColumnInfo := range metadata {
		columnInfo, ok := rawColumnInfo.(map[string]interface{})
		if !ok {
			t.Errorf("column %q description has type %T, want map[string]interface{}", columnName, rawColumnInfo)
			continue
		}

		if _, exists := columnInfo["label_value_layout"]; exists {
			t.Errorf("retired field on %s", columnName)
		}
		actualFields := sortedColumnDescriptionFields(columnInfo)
		if !reflect.DeepEqual(actualFields, expectedFields) {
			t.Errorf("column %q description fields = %v, want complete builder contract %v", columnName, actualFields, expectedFields)
		}
	}
}

func sortedColumnDescriptionFields(description map[string]interface{}) []string {
	fields := make([]string, 0, len(description))
	for fieldName := range description {
		fields = append(fields, fieldName)
	}
	sort.Strings(fields)
	return fields
}

func TestTableMetadataPreservesNullableCardStyle(t *testing.T) {
	for _, test := range []struct {
		name    string
		present bool
		value   driver.Value
		want    string
	}{
		{"no override row", false, nil, "null"}, {"inherited", true, nil, "null"},
		{"standard", true, "standard", `"standard"`}, {"modern", true, "modern", `"modern"`},
	} {
		t.Run(test.name, func(t *testing.T) {
			query := ""
			name := "card-style-meta-" + t.Name()
			sql.Register(name, &layoutMetadataDriver{tableMeta: true, styleColumn: test.present, cardStyle: test.value, query: &query})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			meta, err := fetchTableReadMeta(db, "example")
			if err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(meta)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), `"card_style_variant":`+test.want) {
				t.Fatalf("metadata=%s", body)
			}
			if strings.Contains(query, "COALESCE(card_style_variant") {
				t.Fatal("query materialized an inherited style")
			}
			if !strings.Contains(query, "overrides->>'shared.card_style_variant'") {
				t.Fatalf("legacy schema fallback=%s", query)
			}
		})
	}
}

// Nullable dataset counts must reach the renderer unchanged, including on old schemas.
func TestTableMetadataPreservesNullableCardDetailColumns(t *testing.T) {
	for _, test := range []struct {
		name    string
		present bool
		value   driver.Value
		want    string
	}{
		{"no override row", false, nil, "null"}, {"inherited", true, nil, "null"},
		{"one", true, int64(1), "1"}, {"four", true, int64(4), "4"},
	} {
		t.Run(test.name, func(t *testing.T) {
			query := ""
			name := "card-columns-meta-" + t.Name()
			sql.Register(name, &layoutMetadataDriver{tableMeta: true, detailColumn: test.present, cardDetailColumns: test.value, query: &query})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			meta, err := fetchTableReadMeta(db, "example")
			if err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(meta)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), `"card_detail_columns":`+test.want) {
				t.Fatalf("metadata=%s", body)
			}
			if strings.Contains(query, "COALESCE(card_detail_columns") {
				t.Fatal("query materialized an inherited count")
			}
			if !strings.Contains(query, "overrides->>'shared.card_detail_columns'") {
				t.Fatalf("old schema query=%s", query)
			}
		})
	}
}

// The normal row response must carry the DB default without requiring the admin tree.
func TestTableMetadataIncludesDefaultView(t *testing.T) {
	for _, test := range []struct {
		name    string
		present bool
		value   driver.Value
		want    string
	}{
		{"table", true, "table", `"table"`},
		{"card", true, "card", `"card"`},
		{"site fallback", true, nil, "null"},
		{"older schema", false, nil, "null"},
	} {
		t.Run(test.name, func(t *testing.T) {
			query := ""
			name := "default-view-meta-" + t.Name()
			sql.Register(name, &layoutMetadataDriver{tableMeta: true, defaultViewColumn: test.present, defaultView: test.value, query: &query})
			db, err := sql.Open(name, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			meta, err := fetchTableReadMeta(db, "example")
			if err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(meta)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), `"default_view_name":`+test.want) {
				t.Fatalf("metadata=%s", body)
			}
			if !test.present && strings.Contains(query, "system_db_tables.default_view_id") {
				t.Fatal("older schema must not query an absent default view column")
			}
		})
	}
}
