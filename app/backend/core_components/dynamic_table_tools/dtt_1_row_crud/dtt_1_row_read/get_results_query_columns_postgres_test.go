// get_results_query_columns_postgres_test.go
// Proves projection and URL sort/filter eligibility against real column grants.
// Connects complete HTTP readers to the disposable PostgreSQL fixture and metadata exclusions.
// Never contacts an installation database or an embedding provider; the foreman opts in.
package dtt_1_row_read

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_read"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

const queryColumnsFixtureTable = "b308_query_columns"

func queryColumnsPostgres(t *testing.T) (*sql.DB, *sql.DB, map[int]dtt_models.ColumnInfo) {
	t.Helper()
	owner, reader := ownerResolverPostgres(t)
	loadRowGroupSchema(t, owner)
	baselineExec(t, owner, `
ALTER TABLE system_db_tables ADD ui_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE system_column_details
 ADD column_uid integer, ADD co_number integer, ADD fco_number integer,
 ADD card_element text, ADD is_multilingual boolean, ADD hide_everywhere boolean,
 ADD client_delivery_mode text, ADD show_key_on_card boolean, ADD show_value_on_card boolean,
 ADD hide_in_filter_panel boolean, ADD hide_on_small_card boolean,
 ADD hide_false_null_on_sml_crd boolean, ADD hide_false_null_on_big_crd boolean,
 ADD hide_on_bg_crd_if_not_own boolean, ADD editable_in_ui boolean;
CREATE FUNCTION public.resolve_card_label_visibility(boolean,text) RETURNS boolean
 LANGUAGE sql IMMUTABLE AS 'SELECT COALESCE($1,false)';
CREATE TABLE system_config(key text PRIMARY KEY,int_value integer,json_value jsonb,updated timestamptz);
INSERT INTO system_config(key,int_value) VALUES('results_load_amount',20);
CREATE TABLE system_dataset_media(table_uid bigint,media_role text,storage_key text,hidden boolean);
CREATE TABLE system_dataset_appearance(table_uid bigint,schema_version integer,tab_values jsonb,overrides jsonb,revision bigint);
CREATE TABLE b308_query_columns(id integer PRIMARY KEY,label text,created timestamptz,x integer,hidden_x integer,server_x integer);
INSERT INTO system_db_tables(table_uid,table_name) VALUES(308,'b308_query_columns');
INSERT INTO system_column_details(table_uid,column_uid,column_name,co_number,hide_everywhere,client_delivery_mode) VALUES
 (308,3081,'id',1,false,'include'),(308,3082,'label',2,false,'include'),
 (308,3083,'created',3,false,'include'),(308,3084,'x',4,false,'include'),
 (308,3085,'hidden_x',5,true,'include'),(308,3086,'server_x',6,false,'server');
INSERT INTO b308_query_columns VALUES
 (1,'Zulu','2026-01-03',2,99,99),(2,'Alpha','2026-01-01',1,1,1),(3,'Middle','2026-01-02',3,0,0);
GRANT SELECT ON system_db_tables,system_column_details,system_config,system_dataset_media,system_dataset_appearance TO wl58_reader;
GRANT SELECT ON system_row_groups,system_row_group_memberships,system_row_group_classifications TO wl58_reader;
GRANT SELECT(id,label,created,x,hidden_x,server_x) ON b308_query_columns TO wl58_reader;
REVOKE SELECT(x) ON b308_query_columns FROM wl58_reader;
`)
	oldDB, oldBasic, oldGuest, oldAdmin := backend.Db, backend.DbBasic, backend.DbGuest, backend.DbAdmin
	backend.Db, backend.DbBasic, backend.DbGuest, backend.DbAdmin = owner, reader, reader, owner
	oldStore, oldName := e_sessions.Store, e_sessions.SessionName
	e_sessions.Store, e_sessions.SessionName = sessions.NewCookieStore([]byte("b308-disposable-session-fixture-32")), "b308-query-columns"
	configCacheMu.Lock()
	oldConfig := configCache["results_load_amount"]
	delete(configCache, "results_load_amount")
	configCacheMu.Unlock()
	clearCaches := func() {
		InvalidateSchemaCache(queryColumnsFixtureTable)
		InvalidatePermissionsCache(queryColumnsFixtureTable)
		InvalidateUserColumnSettingsCache(queryColumnsFixtureTable, "table")
		InvalidateDatasetExistsCache(queryColumnsFixtureTable)
	}
	clearCaches()
	t.Cleanup(func() {
		clearCaches()
		configCacheMu.Lock()
		delete(configCache, "results_load_amount")
		if oldConfig != nil {
			configCache["results_load_amount"] = oldConfig
		}
		configCacheMu.Unlock()
		backend.Db, backend.DbBasic, backend.DbGuest, backend.DbAdmin = oldDB, oldBasic, oldGuest, oldAdmin
		e_sessions.Store, e_sessions.SessionName = oldStore, oldName
		resetJoinMetadataCacheForTests()
	})
	columns, err := dtt_2_column_read.GetColumnsMapForTable(queryColumnsFixtureTable)
	if err != nil {
		t.Fatal(err)
	}
	types, err := getColumnDataTypesWithFK(queryColumnsFixtureTable, owner)
	if err != nil {
		t.Fatal(err)
	}
	known := buildColumnsByName(columns)
	if _, exists := known["x"]; !exists {
		t.Fatal("revoked column must remain known to owner-loaded metadata")
	}
	for _, name := range []string{"hidden_x", "server_x"} {
		if _, exists := known[name]; exists {
			t.Fatalf("withheld column %s became queryable", name)
		}
	}
	now := time.Now()
	setCachedSchemaMetadata(queryColumnsFixtureTable, &schemaCacheEntry{columnsMap: columns, columnDataTypes: types, cachedAt: now})
	setCachedJoinMetadata(queryColumnsFixtureTable, joinMetadataCacheEntry{tableUID: "308"})
	settings := []UserColumnSetting{{ColumnName: "id"}, {ColumnName: "label"}, {ColumnName: "created"}, {ColumnName: "x"}}
	for _, id := range []int{1, 2, 4} {
		setCachedUserColumnSettings(id, queryColumnsFixtureTable, "table", &ucsCacheEntry{settings: settings, cachedAt: now})
	}
	// Pin the premise with PostgreSQL itself, independently of information_schema.
	var canRead bool
	if err := reader.QueryRow(`SELECT has_column_privilege(current_user,'b308_query_columns','x','SELECT')`).Scan(&canRead); err != nil || canRead {
		t.Fatalf("fixture did not revoke x: readable=%t error=%v", canRead, err)
	}
	if err := reader.QueryRow(`SELECT has_column_privilege(current_user,'b308_query_columns','id','SELECT')`).Scan(&canRead); err != nil || !canRead {
		t.Fatalf("dataset reader lost its required id grant: readable=%t error=%v", canRead, err)
	}
	return owner, reader, columns
}

func queryColumnsHTTP(t *testing.T, handler http.HandlerFunc, role string, params url.Values) *httptest.ResponseRecorder {
	t.Helper()
	cloned := make(url.Values, len(params)+1)
	for key, values := range params {
		cloned[key] = append([]string(nil), values...)
	}
	params = cloned
	params.Set("dataset", queryColumnsFixtureTable)
	req := httptest.NewRequest(http.MethodGet, "/api/get-results?"+params.Encode(), nil)
	session, err := e_sessions.Store.Get(req, e_sessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	userID := map[string]int{"guest": 1, "admin": 2, "basic": 4}[role]
	session.Values["user_id"], session.Values["user_role"] = userID, role
	cookieResponse := httptest.NewRecorder()
	if err := session.Save(req, cookieResponse); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range cookieResponse.Result().Cookies() {
		req.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler(response, req)
	return response
}

func assertQueryColumnsHTTP(t *testing.T, response *httptest.ResponseRecorder, want []int, deliveredX bool) []string {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var result struct {
		Columns []string                 `json:"columns"`
		Data    []map[string]interface{} `json:"data"`
		Count   *int                     `json:"row_count"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	ids := []int{}
	for _, row := range result.Data {
		ids = append(ids, int(row["id"].(float64)))
		keys := make([]string, 0, len(row))
		for key := range row {
			keys = append(keys, key)
		}
		assertQueryColumnSet(t, keys, result.Columns)
		_, hasX := row["x"]
		if hasX != deliveredX || row["hidden_x"] != nil || row["server_x"] != nil {
			t.Fatalf("delivered columns changed: %v", row)
		}
	}
	if !reflect.DeepEqual(ids, want) || result.Count != nil && *result.Count != len(want) {
		t.Fatalf("ids=%v count=%v want=%v", ids, result.Count, want)
	}
	for _, name := range result.Columns {
		if name == "hidden_x" || name == "server_x" || name == "x" && !deliveredX {
			t.Fatalf("withheld column in presentation: %s", name)
		}
	}
	return result.Columns
}

func assertQueryColumnSet(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) || !reflect.DeepEqual(selectableColumnSet(got), selectableColumnSet(want)) {
		t.Fatalf("delivered columns=%v want exactly=%v", got, want)
	}
}

func TestGetResultsQueryColumnsPostgres(t *testing.T) {
	queryColumnsPostgres(t)
	var output bytes.Buffer
	previousLog := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previousLog) })
	for _, role := range []string{"basic", "guest"} {
		for _, column := range []string{"x", "hidden_x", "server_x"} {
			for _, suffix := range []string{"sort", "", "_from", "_to", "_exclude", "_from_exclude", "_to_exclude"} {
				for _, prefix := range []string{"", queryColumnsFixtureTable + "_"} {
					t.Run(role+"/"+prefix+column+suffix, func(t *testing.T) {
						params := url.Values{"sort_column": {semanticNewestSortColumn}}
						if suffix == "sort" {
							params.Set("sort_column", column)
						} else {
							params.Set(prefix+column+suffix, "999")
						}
						assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResults, role, params), []int{1, 3, 2}, false)
					})
				}
			}
		}
	}
	for _, tc := range []struct {
		params url.Values
		want   []int
	}{
		{url.Values{"sort_column": {"label"}, "sort_order": {"ASC"}}, []int{2, 3, 1}},
		{url.Values{"sort_column": {semanticNewestSortColumn}, "label": {"Alpha"}}, []int{2}},
		{url.Values{"sort_column": {semanticNewestSortColumn}, "id_from": {"2"}, "id_to": {"3"}}, []int{3, 2}},
		{url.Values{"sort_column": {semanticNewestSortColumn}, "label_exclude": {"Alpha"}}, []int{1, 3}},
	} {
		assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResults, "basic", tc.params), tc.want, false)
	}
	// The administrator's existing complete SELECT set still controls eligibility and delivery.
	assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResults, "admin", url.Values{"sort_column": {"x"}, "sort_order": {"ASC"}}), []int{2, 1, 3}, true)
	assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResults, "admin", url.Values{"sort_column": {"x"}, "x": {"2"}}), []int{1}, true)
	if strings.Contains(output.String(), "permission denied") {
		t.Fatalf("ignored filters still reached PostgreSQL: %s", output.String())
	}
}

func TestVectorQueryColumnsWithheldAndReadablePostgres(t *testing.T) {
	owner, _, _ := queryColumnsPostgres(t)
	// A complete column grant keeps all previously delivered known columns.
	baselineExec(t, owner, `GRANT SELECT(x) ON b308_query_columns TO wl58_reader`)
	for _, column := range []string{"hidden_x", "server_x"} {
		for _, suffix := range []string{"sort", "", "_from", "_to", "_exclude"} {
			params := url.Values{"sort_column": {semanticNewestSortColumn}}
			if suffix == "sort" {
				params.Set("sort_column", column)
			} else {
				params.Set(column+suffix, "999")
			}
			assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, "basic", params), []int{1, 3, 2}, true)
		}
	}
	assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, "basic", url.Values{"sort_column": {"label"}, "sort_order": {"ASC"}}), []int{2, 3, 1}, true)
	assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, "basic", url.Values{"label": {"Alpha"}}), []int{2}, true)
}

func TestVectorQueryColumnsCompleteProjectionPostgres(t *testing.T) {
	owner, _, columns := queryColumnsPostgres(t)
	known := make([]string, 0, len(columns))
	for _, column := range columns {
		known = append(known, column.ColumnName)
	}
	assertQueryColumnSet(t, known, []string{"id", "label", "created", "x"})
	params := url.Values{"sort_column": {semanticNewestSortColumn}}
	admin := assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, "admin", params), []int{1, 3, 2}, true)
	assertQueryColumnSet(t, admin, known)
	// Pin both PostgreSQL forms of full access: per-column and table SELECT.
	for _, grant := range []string{
		`GRANT SELECT(x) ON b308_query_columns TO wl58_reader`,
		`GRANT SELECT ON b308_query_columns TO wl58_reader`,
	} {
		baselineExec(t, owner, grant)
		for _, role := range []string{"basic", "guest"} {
			got := assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, role, params), []int{1, 3, 2}, true)
			assertQueryColumnSet(t, got, known)
		}
	}
}

func TestVectorQueryColumnsRevokedProjectionPostgres(t *testing.T) {
	queryColumnsPostgres(t)
	for _, role := range []string{"basic", "guest"} {
		params := url.Values{"sort_column": {semanticNewestSortColumn}}
		listing := assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResults, role, params), []int{1, 3, 2}, false)
		assertQueryColumnSet(t, listing, []string{"id", "label", "created"})
		vector := assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, role, params), []int{1, 3, 2}, false)
		assertQueryColumnSet(t, vector, listing)
		for _, suffix := range []string{"sort", "", "_from", "_to", "_exclude", "_from_exclude", "_to_exclude"} {
			for _, prefix := range []string{"", queryColumnsFixtureTable + "_"} {
				for _, value := range []string{"999", "999,998", "!999"} {
					t.Run(role+"/"+prefix+"x"+suffix+"/"+value, func(t *testing.T) {
						params := url.Values{"sort_column": {semanticNewestSortColumn}}
						if suffix == "sort" {
							params.Set("sort_column", "x")
						} else {
							params.Set(prefix+"x"+suffix, value)
						}
						got := assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, role, params), []int{1, 3, 2}, false)
						assertQueryColumnSet(t, got, listing)
					})
				}
			}
		}
		for _, tc := range []struct {
			params url.Values
			want   []int
		}{
			{url.Values{"sort_column": {"label"}, "sort_order": {"ASC"}}, []int{2, 3, 1}},
			{url.Values{"label": {"Alpha"}, "x": {"999"}}, []int{2}},
		} {
			got := assertQueryColumnsHTTP(t, queryColumnsHTTP(t, GetResultsVector, role, tc.params), tc.want, false)
			assertQueryColumnSet(t, got, listing)
		}
	}
}
