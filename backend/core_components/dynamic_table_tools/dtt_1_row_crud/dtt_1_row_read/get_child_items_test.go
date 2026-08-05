// get_child_items_test.go
// Verifies dynamic relation query building and authorization guards.
// Bridges HTTP requests, row-visibility SQL, and discovered FK permission filtering.
// Exists to prevent related-item endpoints from bypassing dataset or row-level access controls.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dbutils"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

type relatedItemsQueryState struct {
	mu         sync.Mutex
	rowValue   driver.Value
	queryCount int
	lastQuery  string
	lastArgs   []driver.NamedValue
}

type relatedItemsQueryDriver struct {
	state *relatedItemsQueryState
}

type relatedItemsQueryConn struct {
	state *relatedItemsQueryState
}

type relatedItemsQueryRows struct {
	value    driver.Value
	consumed bool
}

func (driverInstance *relatedItemsQueryDriver) Open(string) (driver.Conn, error) {
	return &relatedItemsQueryConn{state: driverInstance.state}, nil
}

func (connection *relatedItemsQueryConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not supported")
}

func (connection *relatedItemsQueryConn) Close() error { return nil }

func (connection *relatedItemsQueryConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("transactions not supported")
}

func (connection *relatedItemsQueryConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	connection.state.mu.Lock()
	connection.state.queryCount++
	connection.state.lastQuery = query
	connection.state.lastArgs = append([]driver.NamedValue(nil), args...)
	rowValue := connection.state.rowValue
	connection.state.mu.Unlock()
	return &relatedItemsQueryRows{value: rowValue}, nil
}

func (rows *relatedItemsQueryRows) Columns() []string { return []string{"result"} }
func (rows *relatedItemsQueryRows) Close() error      { return nil }

func (rows *relatedItemsQueryRows) Next(destination []driver.Value) error {
	if rows.consumed {
		return io.EOF
	}
	rows.consumed = true
	destination[0] = rows.value
	return nil
}

var relatedItemsQueryDriverCounter int64

func openRelatedItemsQueryDB(t *testing.T, state *relatedItemsQueryState) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("related_items_query_%d", atomic.AddInt64(&relatedItemsQueryDriverCounter, 1))
	sql.Register(driverName, &relatedItemsQueryDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open related items query DB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestGetDynamicRelatedItemsHandlerRejectsDatasetMismatchBeforeDatabaseAccess(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/fetch-dynamic-children?dataset=allowed_parent",
		strings.NewReader(`{"parent_dataset":"other_parent","parent_pk_value":"7"}`),
	)
	response := httptest.NewRecorder()

	GetDynamicRelatedItemsHandler(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "parent_dataset must match dataset query parameter") {
		t.Fatalf("response body = %q, want dataset mismatch error", response.Body.String())
	}
}

func TestGetDynamicRelatedItemsHandlerRejectsNonAdminMetadataOnlyBeforeDatabaseAccess(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/fetch-dynamic-children?dataset=allowed_parent",
		strings.NewReader(`{"parent_dataset":"allowed_parent","metadata_only":true}`),
	)
	request = request.WithContext(dbutils.SetRequestActorContext(
		request.Context(),
		dbutils.NewRequestActorContext(42, "basic"),
	))
	response := httptest.NewRecorder()

	GetDynamicRelatedItemsHandler(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "metadata_only requires admin access") {
		t.Fatalf("response body = %q, want admin-only error", response.Body.String())
	}
}

func TestBuildRelatedMetadataCandidatesReturnsOnlyRelationIdentity(t *testing.T) {
	candidates := buildRelatedMetadataCandidates(
		[]FKInfo{{Referencing_table: "allowed_child", Referencing_column: "parent_id"}},
		map[string]string{"allowed_child": relatedTableKindSharedAsset},
	)
	if len(candidates) != 1 {
		t.Fatalf("candidate count = %d, want 1", len(candidates))
	}
	candidate := candidates[0]
	if candidate.Table_name != "allowed_child" || candidate.Column_name != "parent_id" {
		t.Fatalf("candidate identity = %#v, want allowed_child.parent_id", candidate)
	}
	if candidate.RelationKind != relatedTableKindSharedAsset || candidate.ReferenceDirection != relatedReferenceDirectionIncoming {
		t.Fatalf("candidate relation metadata = %#v", candidate)
	}
	if candidate.Rows == nil || len(candidate.Rows) != 0 {
		t.Fatalf("candidate rows = %#v, want an explicit empty list", candidate.Rows)
	}

	encoded, err := json.Marshal(candidate)
	if err != nil {
		t.Fatalf("marshal candidate: %v", err)
	}
	encodedText := string(encoded)
	for _, forbiddenField := range []string{`"filter_value"`, `"row_count"`, `"types"`} {
		if strings.Contains(encodedText, forbiddenField) {
			t.Fatalf("metadata-only candidate leaked %s: %s", forbiddenField, encodedText)
		}
	}
	if !strings.Contains(encodedText, `"rows":[]`) {
		t.Fatalf("metadata-only candidate must encode empty rows: %s", encodedText)
	}
}

func TestIsRelatedParentRowVisibleHidesMissingAndPolicyFilteredRows(t *testing.T) {
	tests := []struct {
		name       string
		readPolicy ReadRowPolicy
		userID     int
		wantSQL    string
		wantArgs   []driver.Value
	}{
		{
			name:     "missing parent",
			userID:   42,
			wantSQL:  `WHERE "parent_rows"."id" = $1`,
			wantArgs: []driver.Value{int64(7)},
		},
		{
			name:       "parent hidden by row policy",
			readPolicy: legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
			userID:     42,
			wantSQL:    `("parent_rows"."published" = TRUE OR "parent_rows"."user_id" = $2)`,
			wantArgs:   []driver.Value{int64(7), int64(42)},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := &relatedItemsQueryState{rowValue: false}
			db := openRelatedItemsQueryDB(t, state)

			visible, err := isRelatedParentRowVisible(db, "parent_rows", 7, "basic", test.userID, test.readPolicy)
			if err != nil {
				t.Fatalf("isRelatedParentRowVisible returned error: %v", err)
			}
			if visible {
				t.Fatal("hidden or missing parent must not be visible")
			}

			state.mu.Lock()
			lastQuery := state.lastQuery
			lastArgs := append([]driver.NamedValue(nil), state.lastArgs...)
			state.mu.Unlock()
			if !strings.Contains(lastQuery, test.wantSQL) {
				t.Fatalf("query = %q, want fragment %q", lastQuery, test.wantSQL)
			}
			if len(lastArgs) != len(test.wantArgs) {
				t.Fatalf("query args = %#v, want %#v", lastArgs, test.wantArgs)
			}
			for index, want := range test.wantArgs {
				if lastArgs[index].Value != want {
					t.Fatalf("query arg %d = %#v, want %#v", index, lastArgs[index].Value, want)
				}
			}
		})
	}
}

func TestIsRelatedParentRowVisibleAllowsVisibleParent(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: true}
	db := openRelatedItemsQueryDB(t, state)

	visible, err := isRelatedParentRowVisible(db, "parent_rows", 7, "basic", 42, ReadRowPolicy{})
	if err != nil {
		t.Fatalf("isRelatedParentRowVisible returned error: %v", err)
	}
	if !visible {
		t.Fatal("visible parent must be accepted")
	}
}

func TestIsRelatedParentRowVisibleDefersPilotVisibilityToRLS(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: false}
	db := openRelatedItemsQueryDB(t, state)
	legacyPolicy := legacyMustTrueReadPolicy([]string{"published"}, "user_id")

	visible, err := isRelatedParentRowVisible(db, rlsPilotTableName, 7, "basic", 42, legacyPolicy)
	if err != nil {
		t.Fatalf("isRelatedParentRowVisible returned error: %v", err)
	}
	if visible {
		t.Fatal("pilot RLS-hidden parent must not be visible")
	}

	state.mu.Lock()
	lastQuery := state.lastQuery
	state.mu.Unlock()
	if strings.Contains(lastQuery, "published") || strings.Contains(lastQuery, "user_id") {
		t.Fatalf("pilot query must defer row visibility to RLS, got %q", lastQuery)
	}
}

func TestReadParentForeignKeyValuesReappliesParentReadPolicy(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: int64(99)}
	db := openRelatedItemsQueryDB(t, state)
	foreignKeys := map[string]dtt_utils.ForeignKey{
		"lookup_id": {ReferencedTable: "lookup_rows", ReferencedColumn: "id"},
	}

	values, err := readParentForeignKeyValues(
		db,
		"parent_rows",
		7,
		foreignKeys,
		"basic",
		42,
		legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
	)
	if err != nil {
		t.Fatalf("readParentForeignKeyValues returned error: %v", err)
	}
	if values["lookup_id"] != int64(99) {
		t.Fatalf("parent FK value = %#v, want 99", values["lookup_id"])
	}

	state.mu.Lock()
	lastQuery := state.lastQuery
	lastArgs := append([]driver.NamedValue(nil), state.lastArgs...)
	state.mu.Unlock()
	if !strings.Contains(lastQuery, `WHERE "parent_rows"."id" = $1 AND ("parent_rows"."published" = TRUE OR "parent_rows"."user_id" = $2)`) {
		t.Fatalf("parent FK query did not reapply row policy: %s", lastQuery)
	}
	if len(lastArgs) != 2 || lastArgs[0].Value != int64(7) || lastArgs[1].Value != int64(42) {
		t.Fatalf("parent FK query args = %#v, want parent and owner IDs", lastArgs)
	}
}

func TestFilterAuthorizedIncomingForeignKeysOmitsUnauthorizedChild(t *testing.T) {
	foreignKeys := []FKInfo{
		{Referencing_table: "allowed_child", Referencing_column: "parent_id"},
		{Referencing_table: "private_child", Referencing_column: "parent_id"},
	}
	checkedTables := make([]string, 0, len(foreignKeys))
	canReadDataset := func(tableName string) (bool, error) {
		checkedTables = append(checkedTables, tableName)
		return tableName == "allowed_child", nil
	}

	filtered, err := filterAuthorizedIncomingForeignKeys(foreignKeys, "", canReadDataset)
	if err != nil {
		t.Fatalf("filterAuthorizedIncomingForeignKeys returned error: %v", err)
	}
	if len(filtered) != 1 || filtered[0].Referencing_table != "allowed_child" {
		t.Fatalf("filtered foreign keys = %#v, want only allowed_child", filtered)
	}
	if strings.Join(checkedTables, ",") != "allowed_child,private_child" {
		t.Fatalf("checked tables = %#v, want both discovered datasets authorized", checkedTables)
	}
}

func TestFilterAuthorizedOutgoingForeignKeysAllowsDeniesAndAppliesChildFilter(t *testing.T) {
	foreignKeys := map[string]dtt_utils.ForeignKey{
		"allowed_id":  {ReferencedTable: "allowed_target", ReferencedColumn: "id"},
		"private_id":  {ReferencedTable: "private_target", ReferencedColumn: "id"},
		"filtered_id": {ReferencedTable: "filtered_target", ReferencedColumn: "id"},
	}
	checkedTables := make([]string, 0, 2)
	canReadDataset := func(tableName string) (bool, error) {
		checkedTables = append(checkedTables, tableName)
		return tableName == "allowed_target", nil
	}

	filtered, err := filterAuthorizedOutgoingForeignKeys(foreignKeys, "", canReadDataset)
	if err != nil {
		t.Fatalf("filterAuthorizedOutgoingForeignKeys returned error: %v", err)
	}
	if len(filtered) != 1 || filtered["allowed_id"].ReferencedTable != "allowed_target" {
		t.Fatalf("filtered foreign keys = %#v, want only allowed_target", filtered)
	}
	if strings.Join(checkedTables, ",") != "allowed_target,filtered_target,private_target" {
		t.Fatalf("checked tables = %#v, want deterministic authorization of every target", checkedTables)
	}

	checkedTables = checkedTables[:0]
	filtered, err = filterAuthorizedOutgoingForeignKeys(foreignKeys, "allowed_target", canReadDataset)
	if err != nil {
		t.Fatalf("filtered target call returned error: %v", err)
	}
	if len(filtered) != 1 || filtered["allowed_id"].ReferencedTable != "allowed_target" {
		t.Fatalf("child-filtered foreign keys = %#v, want only allowed_target", filtered)
	}
	if strings.Join(checkedTables, ",") != "allowed_target" {
		t.Fatalf("child filter must run before authorization, checked %#v", checkedTables)
	}
}

func TestAuthorizeRelatedNestedMetadataRemovesUnauthorizedLabelAndTypeTarget(t *testing.T) {
	foreignKeys := map[string]dtt_utils.ForeignKey{
		"allowed_id": {
			ReferencedTable:  "allowed_lookup",
			ReferencedColumn: "id",
			NameColumn:       "name",
		},
		"private_id": {
			ReferencedTable:  "private_lookup",
			ReferencedColumn: "id",
			NameColumn:       "secret_name",
		},
	}
	dataTypes := map[string]interface{}{
		"allowed_id": map[string]interface{}{
			"data_type":      "integer",
			"foreign_table":  "allowed_lookup",
			"foreign_column": "id",
		},
		"private_id": map[string]interface{}{
			"data_type":      "integer",
			"foreign_table":  "private_lookup",
			"foreign_column": "id",
		},
		"type_only_id": map[string]interface{}{
			"data_type":      "integer",
			"foreign_table":  "private_type_only_lookup",
			"foreign_column": "id",
		},
	}

	labelForeignKeys, sanitizedTypes, err := authorizeRelatedNestedMetadata(
		foreignKeys,
		dataTypes,
		"basic",
		func(tableName string) (bool, error) { return tableName == "allowed_lookup", nil },
		func(string) (ReadRowPolicy, error) { return ReadRowPolicy{}, nil },
	)
	if err != nil {
		t.Fatalf("authorizeRelatedNestedMetadata returned error: %v", err)
	}
	if len(labelForeignKeys) != 1 || labelForeignKeys["allowed_id"].ReferencedTable != "allowed_lookup" {
		t.Fatalf("label foreign keys = %#v, want only allowed lookup", labelForeignKeys)
	}
	privateType := sanitizedTypes["private_id"].(map[string]interface{})
	if _, found := privateType["foreign_table"]; found {
		t.Fatalf("private type metadata retained foreign_table: %#v", privateType)
	}
	if _, found := privateType["foreign_column"]; found {
		t.Fatalf("private type metadata retained foreign_column: %#v", privateType)
	}
	if privateType["data_type"] != "integer" {
		t.Fatalf("non-FK type metadata must remain intact: %#v", privateType)
	}
	typeOnly := sanitizedTypes["type_only_id"].(map[string]interface{})
	if _, found := typeOnly["foreign_table"]; found {
		t.Fatalf("type-only private metadata retained foreign_table: %#v", typeOnly)
	}
	if _, found := typeOnly["foreign_column"]; found {
		t.Fatalf("type-only private metadata retained foreign_column: %#v", typeOnly)
	}
	allowedType := sanitizedTypes["allowed_id"].(map[string]interface{})
	if allowedType["foreign_table"] != "allowed_lookup" || allowedType["foreign_column"] != "id" {
		t.Fatalf("authorized FK type metadata = %#v, want target metadata retained", allowedType)
	}
	if originalPrivate := dataTypes["private_id"].(map[string]interface{}); originalPrivate["foreign_table"] != "private_lookup" {
		t.Fatalf("authorization helper mutated caller-owned type metadata: %#v", originalPrivate)
	}
}

func TestAuthorizeRelatedNestedMetadataOmitsUnsafeNonAdminLabelJoins(t *testing.T) {
	tests := []struct {
		name       string
		userRole   string
		target     string
		policy     ReadRowPolicy
		policyErr  error
		wantLabels int
	}{
		{
			name:       "active Go row policy",
			userRole:   "basic",
			target:     "policy_lookup",
			policy:     legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
			wantLabels: 0,
		},
		{
			name:       "pilot RLS policy",
			userRole:   "basic",
			target:     rlsPilotTableName,
			wantLabels: 0,
		},
		{
			name:       "policy lookup failure",
			userRole:   "basic",
			target:     "uncertain_lookup",
			policyErr:  fmt.Errorf("metadata unavailable"),
			wantLabels: 0,
		},
		{
			name:       "admin may join policy target",
			userRole:   "admin",
			target:     "policy_lookup",
			policy:     legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
			wantLabels: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			foreignKeys := map[string]dtt_utils.ForeignKey{
				"lookup_id": {
					ReferencedTable:  test.target,
					ReferencedColumn: "id",
					NameColumn:       "name",
				},
			}
			dataTypes := map[string]interface{}{
				"lookup_id": map[string]interface{}{
					"foreign_table":  test.target,
					"foreign_column": "id",
				},
			}

			labels, sanitizedTypes, err := authorizeRelatedNestedMetadata(
				foreignKeys,
				dataTypes,
				test.userRole,
				func(string) (bool, error) { return true, nil },
				func(string) (ReadRowPolicy, error) { return test.policy, test.policyErr },
			)
			if err != nil {
				t.Fatalf("authorizeRelatedNestedMetadata returned error: %v", err)
			}
			if len(labels) != test.wantLabels {
				t.Fatalf("label count = %d, want %d; labels=%#v", len(labels), test.wantLabels, labels)
			}
			columnInfo := sanitizedTypes["lookup_id"].(map[string]interface{})
			if columnInfo["foreign_table"] != test.target || columnInfo["foreign_column"] != "id" {
				t.Fatalf("dataset-authorized type metadata was removed: %#v", columnInfo)
			}
		})
	}
}

func TestRelatedDatasetPermissionCheckerUsesCanonicalRouteAndCachesDecision(t *testing.T) {
	state := &relatedItemsQueryState{rowValue: int64(1)}
	db := openRelatedItemsQueryDB(t, state)
	canReadDataset := newRelatedDatasetPermissionChecker(db, 42)

	for call := 0; call < 2; call++ {
		allowed, err := canReadDataset("allowed_child")
		if err != nil {
			t.Fatalf("permission call %d returned error: %v", call+1, err)
		}
		if !allowed {
			t.Fatalf("permission call %d denied an allowed dataset", call+1)
		}
	}

	state.mu.Lock()
	queryCount := state.queryCount
	lastQuery := state.lastQuery
	lastArgs := append([]driver.NamedValue(nil), state.lastArgs...)
	state.mu.Unlock()
	if queryCount != 1 {
		t.Fatalf("permission query count = %d, want 1 cached query", queryCount)
	}
	if !strings.Contains(lastQuery, "system_group_table_func_rights") {
		t.Fatalf("permission query = %q, want canonical rights table", lastQuery)
	}
	if len(lastArgs) != 3 || lastArgs[0].Value != dynamicRelatedItemsRoute || lastArgs[1].Value != int64(42) || lastArgs[2].Value != "allowed_child" {
		t.Fatalf("permission args = %#v, want route, actor, and target dataset", lastArgs)
	}
}

func TestBuildRelatedFKDisplayAliasPrefersPlainNameWhenFree(t *testing.T) {
	alias := buildRelatedFKDisplayAlias("group_id", map[string]struct{}{}, map[string]struct{}{})
	if alias != "group_name" {
		t.Fatalf("buildRelatedFKDisplayAlias(group_id) = %q, want %q", alias, "group_name")
	}
}

func TestBuildRelatedFKDisplayAliasFallsBackWhenPlainNameAlreadyExists(t *testing.T) {
	alias := buildRelatedFKDisplayAlias(
		"group_id",
		map[string]struct{}{"group_name": {}},
		map[string]struct{}{},
	)
	if alias != "group_name (ln)" {
		t.Fatalf("buildRelatedFKDisplayAlias collision = %q, want %q", alias, "group_name (ln)")
	}
}

func TestBuildRelatedSelectColumnsWithFKLabelsAddsJoinAndDisplayAlias(t *testing.T) {
	selectColumns, joinClauses := buildRelatedSelectColumnsWithFKLabels(
		"dev_agent_task_group_relations",
		[]string{"id", "group_id", "task_id"},
		map[string]dtt_utils.ForeignKey{
			"group_id": {
				ReferencedTable:  "dev_agent_task_groups",
				ReferencedColumn: "id",
				NameColumn:       "title",
			},
		},
	)

	if !strings.Contains(selectColumns, `"dev_agent_task_group_relations"."group_id" AS "group_id"`) {
		t.Fatalf("selectColumns missing raw FK column: %s", selectColumns)
	}
	if !strings.Contains(selectColumns, `"group_id_related_fk_alias1"."title" AS "group_name"`) {
		t.Fatalf("selectColumns missing FK display alias: %s", selectColumns)
	}
	if !strings.Contains(joinClauses, `LEFT JOIN "dev_agent_task_groups" AS "group_id_related_fk_alias1"`) {
		t.Fatalf("joinClauses missing FK join: %s", joinClauses)
	}
}

func TestBuildRelatedItemsQueryQualifiesWhereColumnToAvoidAmbiguousFKNames(t *testing.T) {
	query := buildRelatedItemsQuery(
		`"dev_agent_tasks"."id" AS "id", "queue_id_related_fk_alias1"."title" AS "queue_name"`,
		"dev_agent_tasks",
		`LEFT JOIN "dev_agent_task_queues" AS "queue_id_related_fk_alias1" ON "dev_agent_tasks"."queue_id" = "queue_id_related_fk_alias1"."id" `,
		"queue_id",
	)

	if !strings.Contains(query, `WHERE "dev_agent_tasks"."queue_id" = $1`) {
		t.Fatalf("query WHERE clause must qualify FK column to avoid ambiguity: %s", query)
	}
}

func TestBuildRelatedItemsQueryWithReadPolicyAddsOwnerFallback(t *testing.T) {
	query, args := buildRelatedItemsQueryWithReadPolicy(
		`"dev_agent_tasks"."id" AS "id"`,
		"dev_agent_tasks",
		"",
		"queue_id",
		42,
		"editor",
		9,
		legacyMustTrueReadPolicy([]string{"published"}, "user_id"),
	)

	if !strings.Contains(query, `WHERE "dev_agent_tasks"."queue_id" = $1 AND ("dev_agent_tasks"."published" = TRUE OR "dev_agent_tasks"."user_id" = $2)`) {
		t.Fatalf("query missing read policy with owner fallback: %s", query)
	}
	if len(args) != 2 || args[0] != 42 || args[1] != 9 {
		t.Fatalf("query args = %#v, want []interface{}{42, 9}", args)
	}
}

func TestClassifyRelatedTableKindDefaultsToRelatedRowsWithoutMetadata(t *testing.T) {
	tests := []struct {
		tableName string
		wantKind  string
	}{
		{tableName: "app_service_catalog_assets", wantKind: relatedTableKindRows},
		{tableName: "app_service_catalog_gallery", wantKind: relatedTableKindRows},
		{tableName: "app_service_catalog_comments", wantKind: relatedTableKindRows},
	}

	for _, tt := range tests {
		if got := classifyRelatedTableKind(tt.tableName, nil); got != tt.wantKind {
			t.Fatalf("classifyRelatedTableKind(%q) = %q, want %q", tt.tableName, got, tt.wantKind)
		}
	}
}

func TestClassifyRelatedTableKindPrefersRelationMetadataOverSuffixGuessing(t *testing.T) {
	metadata := map[string]string{
		"custom_media_bucket": relatedTableKindSharedAsset,
		"legacy_media_bucket": relatedTableKindImageAsset,
	}

	if got := classifyRelatedTableKind("custom_media_bucket", metadata); got != relatedTableKindSharedAsset {
		t.Fatalf("classifyRelatedTableKind(metadata override) = %q, want %q", got, relatedTableKindSharedAsset)
	}
	if got := classifyRelatedTableKind("legacy_media_bucket", metadata); got != relatedTableKindImageAsset {
		t.Fatalf("classifyRelatedTableKind(legacy metadata override) = %q, want %q", got, relatedTableKindImageAsset)
	}
}

func TestResolveRelatedTableKindDoesNotTreatAttachmentMetadataAsLegacyImage(t *testing.T) {
	status := relatedMediaRelationStatus{
		ChildTable: "custom_media_gallery",
		UploadConfig: relatedMediaFileUploadConfig{
			TargetDirectory: "attachments",
			AssetKinds:      []string{"pdf"},
		},
	}

	if got := resolveRelatedTableKind(status); got != relatedTableKindRows {
		t.Fatalf("resolveRelatedTableKind(attachment metadata) = %q, want %q", got, relatedTableKindRows)
	}
}

func TestShouldEagerLoadRelatedRows(t *testing.T) {
	tests := []struct {
		name            string
		childTable      string
		relationKind    string
		regularCount    int
		wantEagerLoaded bool
	}{
		{
			name:            "broad non media request stays count only when several tabs exist",
			childTable:      "",
			relationKind:    relatedTableKindRows,
			regularCount:    2,
			wantEagerLoaded: false,
		},
		{
			name:            "single broad non media request eagerly loads the only related tab",
			childTable:      "",
			relationKind:    relatedTableKindRows,
			regularCount:    1,
			wantEagerLoaded: true,
		},
		{
			name:            "broad media request still eager loads rows",
			childTable:      "",
			relationKind:    relatedTableKindSharedAsset,
			regularCount:    2,
			wantEagerLoaded: true,
		},
		{
			name:            "single child tab request eagerly loads rows",
			childTable:      "dev_agent_task_group_relations",
			relationKind:    relatedTableKindRows,
			regularCount:    3,
			wantEagerLoaded: true,
		},
	}

	for _, tt := range tests {
		if got := shouldEagerLoadRelatedRows(tt.childTable, tt.relationKind, tt.regularCount); got != tt.wantEagerLoaded {
			t.Fatalf("%s: shouldEagerLoadRelatedRows(%q, %q, %d) = %v, want %v", tt.name, tt.childTable, tt.relationKind, tt.regularCount, got, tt.wantEagerLoaded)
		}
	}
}

func TestAppendRelatedAuditColumnsAddsExistingAuditColumnsOnce(t *testing.T) {
	got := appendRelatedAuditColumns(
		[]string{"id", "title", "created"},
		map[string]bool{
			"created": true,
			"updated": true,
		},
	)

	want := []string{"id", "title", "created", "updated"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("appendRelatedAuditColumns = %#v, want %#v", got, want)
	}
}

func TestAppendRelatedAuditColumnsSkipsMissingAuditColumns(t *testing.T) {
	got := appendRelatedAuditColumns(
		[]string{"id", "title"},
		map[string]bool{
			"created": true,
			"updated": false,
		},
	)

	want := []string{"id", "title", "created"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("appendRelatedAuditColumns = %#v, want %#v", got, want)
	}
}

func TestNormalizeRelatedIntegerIDAcceptsCommonSQLValues(t *testing.T) {
	tests := []struct {
		name  string
		value interface{}
		want  int
		ok    bool
	}{
		{name: "int", value: 42, want: 42, ok: true},
		{name: "int64", value: int64(42), want: 42, ok: true},
		{name: "numeric string", value: " 42 ", want: 42, ok: true},
		{name: "non numeric string", value: "abc", want: 0, ok: false},
		{name: "nil", value: nil, want: 0, ok: false},
	}

	for _, tt := range tests {
		got, ok := normalizeRelatedIntegerID(tt.value)
		if got != tt.want || ok != tt.ok {
			t.Fatalf("%s: normalizeRelatedIntegerID(%#v) = (%d, %v), want (%d, %v)", tt.name, tt.value, got, ok, tt.want, tt.ok)
		}
	}
}

func TestSortedForeignKeyColumnsReturnsStableOrder(t *testing.T) {
	got := sortedForeignKeyColumns(map[string]dtt_utils.ForeignKey{
		"service_id": {},
		"risk_id":    {},
		"doc_id":     {},
	})
	want := []string{"doc_id", "risk_id", "service_id"}

	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("sortedForeignKeyColumns = %#v, want %#v", got, want)
	}
}
