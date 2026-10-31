// front_page_box_query_test.go
// Proves strict saved definitions, legacy identity merging and fail-closed delegates.
// Connects the real decoder/read facade with language/catalogue fixtures and canonical read stubs.
// Exercises authorization narrowing and SQL page-size transport without PostgreSQL.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	e_sessions "easelect/backend/core_components/sessions"
)

func frontPageBoxMockDB(t *testing.T, fixture *rowGroupSQLDriver) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("front_page_box_%d", rowGroupDriverSerial.Add(1))
	sql.Register(name, fixture)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		if len(fixture.steps) > 0 {
			t.Errorf("%d expected statements not read", len(fixture.steps))
		}
	})
	return db
}

func stubFrontPageLanguages(t *testing.T) {
	t.Helper()
	old := frontPageKnownLanguage
	frontPageKnownLanguage = func(_ dbutils.Querier, code string) (bool, error) { return code == "fi" || code == "en", nil }
	t.Cleanup(func() { frontPageKnownLanguage = old })
}

func TestFrontPageBoxStrictDecoder(t *testing.T) {
	stubFrontPageLanguages(t)
	slugs := []string{}
	for i := 0; i < 20; i++ {
		slugs = append(slugs, fmt.Sprintf("group-%d", i))
	}
	twenty, _ := json.Marshal(slugs)
	for _, fields := range []string{
		`"query":{"unknown":true}`, `"query":{"ROW_GROUP":["one"]}`, `"query":{"SORT_COLUMN":"__newest"}`, `"unknown":true`, `"query":{"row_group":` + string(twenty) + `}`,
		`"query":{"row_group":["Bad slug"]}`, `"query":{"row_group":["one","one"]}`,
		`"query":{"sort_order":"down"}`, `"query":{"sort_order":"desc"}`, `"query":{"sort_column":""}`,
		`"query":null`, `"query":[]`, `"query":{"row_group":null}`, `"query":{"sort_column":null}`,
		`"title":{"en":"` + strings.Repeat("ä", 101) + `"}`, `"title":{"zz":"Unknown language"}`,
		`"title":{"en":{"unknown":"title"}}`, `"title":{"usage_explanation":"private"}`, `"title":{"en":"<b>markup</b>"}`,
		`"title":{"en":" "}`, `"title":{"en":null}`, `"title":[]`, `"category_links":4`, `"category_links":-1`, `"category_links":null`,
	} {
		body := `{"version":"none","blocks":[{"dataset":"content","result_limit":3,"sort_order":1,` + fields + `}]}`
		if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
	for _, fields := range []string{`"query":{}`, `"title":null`, `"title":{}`, `"title":{"fi":"  Otsikko  ","en":"` + strings.Repeat("ä", 100) + `"}`, `"query":{"row_group":["a-b","c_d"],"sort_column":"__newest","sort_order":"ASC"},"category_links":0`} {
		body := `{"version":"none","blocks":[{"dataset":"content","result_limit":3,"sort_order":1,` + fields + `}]}`
		if _, err := decodeFrontPageAdminRequest(strings.NewReader(body)); err != nil {
			t.Fatal(body, err)
		}
	}
	query, _ := json.Marshal(frontPageBoxQuery{RowGroup: slugs[:19]})
	if _, err := decodeFrontPageBoxQuery(query); err != nil {
		t.Fatal("19 slugs rejected", err)
	}
	request, err := decodeFrontPageAdminRequest(strings.NewReader(`{"version":"none","blocks":[{"dataset":"content","result_limit":3,"sort_order":1,"title":{"fi":"  Otsikko  "}}]}`))
	if err != nil || string((*request.Blocks)[0].Title) != `{"fi":"Otsikko"}` {
		t.Fatal("title not trimmed", request, err)
	}
}

func TestFrontPageBoxLegacyMergePreservesIdentityAndOmittedFields(t *testing.T) {
	stored := frontPageBlock{ID: 55, Dataset: "content", ResultLimit: 4, SortOrder: 1, Enabled: true,
		Title: json.RawMessage(`{"fi":"Otsikko"}`), Query: json.RawMessage(`{"row_group":["finland"]}`), CategoryLinks: 1}
	for _, entry := range []string{`{"dataset":"content","result_limit":6,"sort_order":2,"enabled":false}`, `{"box_id":55,"result_limit":6,"sort_order":2,"enabled":false}`} {
		request, err := decodeFrontPageAdminRequest(strings.NewReader(`{"version":"none","blocks":[` + entry + `]}`))
		if err != nil {
			t.Fatal(err)
		}
		blocks, err := mergeFrontPageBlockInputs(*request.Blocks, []frontPageBlock{stored})
		if err != nil || len(blocks) != 1 {
			t.Fatal(blocks, err)
		}
		got := blocks[0]
		if got.ID != 55 || got.Dataset != stored.Dataset || string(got.Title) != string(stored.Title) || string(got.Query) != string(stored.Query) || got.CategoryLinks != 1 || got.ResultLimit != 6 || got.SortOrder != 2 || got.Enabled {
			t.Fatal(got)
		}
	}
	var legacyOnlyDataset frontPageBlockInput
	if err := json.Unmarshal([]byte(`{"dataset":"content"}`), &legacyOnlyDataset); err != nil {
		t.Fatal(err)
	}
	unchanged, err := mergeFrontPageBlockInputs([]frontPageBlockInput{legacyOnlyDataset}, []frontPageBlock{stored})
	if err != nil || len(unchanged) != 1 || unchanged[0].ID != stored.ID || unchanged[0].ResultLimit != stored.ResultLimit || unchanged[0].SortOrder != stored.SortOrder || !unchanged[0].Enabled {
		t.Fatal("omitted legacy scalar changed", unchanged, err)
	}
	request, err := decodeFrontPageAdminRequest(strings.NewReader(`{"version":"none","blocks":[{"box_id":55,"title":null,"query":{},"category_links":0}]}`))
	if err != nil {
		t.Fatal(err)
	}
	blocks, err := mergeFrontPageBlockInputs(*request.Blocks, []frontPageBlock{stored})
	if err != nil || string(blocks[0].Title) != "null" || string(blocks[0].Query) != "{}" || blocks[0].CategoryLinks != 0 || blocks[0].ResultLimit != 4 {
		t.Fatal(blocks, err)
	}
	input := []frontPageBlockInput{{Dataset: "content", ResultLimit: 3, SortOrder: 1}}
	if _, err := mergeFrontPageBlockInputs(input, []frontPageBlock{stored, stored}); err == nil {
		t.Fatal("ambiguous legacy match accepted")
	}
	input[0].ID = 99
	if _, err := mergeFrontPageBlockInputs(input, []frontPageBlock{stored}); err == nil {
		t.Fatal("foreign box id accepted")
	}
}

func TestFrontPageBoxDelegateSelectionMismatchAndSQLLimit(t *testing.T) {
	block := frontPageBlock{ID: 19, Dataset: "content", ResultLimit: 2, Enabled: true, Query: json.RawMessage(`{"row_group":["one","two"],"sort_column":"__newest","sort_order":"ASC"}`)}
	stubFrontPageRead(t, []frontPageBlock{block})
	old := backend.Db
	t.Cleanup(func() { backend.Db = old })
	for _, resolved := range []string{`[]`, `["one"]`, `["one","unknown"]`, `["one","one"]`, `["two","one"]`} {
		t.Run(resolved, func(t *testing.T) {
			// A query-only fixture: reference validation must see both enabled dataset slugs.
			fixture := &rowGroupSQLDriver{t: t, steps: []rowGroupSQLStep{
				{contains: []string{"category.enabled", "heading.enabled", "registry.table_name=$1"}, rows: [][]driver.Value{{int64(2)}}},
				{contains: []string{"FROM system_config"}, rows: [][]driver.Value{{""}}},
			}}
			backend.Db = frontPageBoxMockDB(t, fixture)
			frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
				if read.ResultsPageSizeFromContext(r.Context()) != 2 || r.URL.Query().Get("row_group") != "one,two" || r.URL.Query().Get("sort_order") != "ASC" {
					t.Fatal("definition not delegated", r.URL.Query())
				}
				fmt.Fprintf(w, `{"columns":["id"],"types":{},"data":[{"id":1},{"id":2},{"id":3}],"row_group_selection":{"slugs":%s}}`, resolved)
			}
			response := httptest.NewRecorder()
			GetFrontPageHandler(response, frontPageSessionRequest(t, 1, "guest", "GET", "/api/front-page"))
			var got struct {
				Blocks []frontPageResultBlock `json:"blocks"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if resolved == `["two","one"]` {
				if len(got.Blocks) != 1 || len(got.Blocks[0].Data) != 2 {
					t.Fatal(response.Body.String())
				}
			} else if len(got.Blocks) != 0 || strings.Contains(response.Body.String(), `"one"`) || strings.Contains(response.Body.String(), "reason_key") || strings.Contains(response.Body.String(), "box_id") {
				t.Fatal("widened query or metadata leaked", response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal(response.Header())
			}
		})
	}
}

func TestFrontPageBoxInvalidReferencesRefusedWithoutDelegate(t *testing.T) {
	for _, tc := range []struct {
		query string
		count driver.Value
		want  string
	}{
		{`{"row_group":["unknown"]}`, int64(0), "row_group_invalid_filters"},
		{`{"sort_column":"missing"}`, false, "front_page_blocks_invalid"},
	} {
		t.Run(tc.query, func(t *testing.T) {
			old := backend.Db
			defer func() { backend.Db = old }()
			backend.Db = frontPageBoxMockDB(t, &rowGroupSQLDriver{t: t, steps: []rowGroupSQLStep{{rows: [][]driver.Value{{tc.count}}}}})
			result, reason := delegateFrontPageBox(httptest.NewRequest("GET", "/api/front-page", nil), frontPageBlock{Dataset: "content", ResultLimit: 3, Query: json.RawMessage(tc.query)})
			if reason != tc.want || len(result.Data) != 0 {
				t.Fatal(reason, result)
			}
		})
	}
}

func TestFrontPageBoxUnreadableSortOmitted(t *testing.T) {
	old, guest := backend.Db, backend.DbGuest
	defer func() { backend.Db, backend.DbGuest = old, guest }()
	backend.Db = frontPageBoxMockDB(t, &rowGroupSQLDriver{t: t, steps: []rowGroupSQLStep{{contains: []string{"information_schema.columns"}, rows: [][]driver.Value{{true}}}}})
	backend.DbGuest = frontPageBoxMockDB(t, &rowGroupSQLDriver{t: t, steps: []rowGroupSQLStep{{contains: []string{"has_column_privilege"}, rows: [][]driver.Value{{false}}}}})
	request := httptest.NewRequest("GET", "/api/front-page", nil).WithContext(dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(1, "guest")))
	_, reason := delegateFrontPageBox(request, frontPageBlock{Dataset: "content", ResultLimit: 3, Query: json.RawMessage(`{"sort_column":"private_column"}`)})
	if reason != "front_page_blocks_invalid" {
		t.Fatal(reason)
	}
}

func TestFrontPageBoxAdminDiagnosticUsesGuestInsteadOfAdministrator(t *testing.T) {
	block := frontPageBlock{ID: 7, Dataset: "content", ResultLimit: 3, Enabled: true, Query: json.RawMessage(`{"row_group":["one"]}`)}
	stubFrontPageRead(t, nil)
	old, guest := backend.Db, backend.DbGuest
	t.Cleanup(func() { backend.Db, backend.DbGuest = old, guest })
	backend.Db = frontPageBoxMockDB(t, &rowGroupSQLDriver{t: t, steps: []rowGroupSQLStep{{rows: [][]driver.Value{{int64(1)}}}}})
	backend.DbGuest = nil
	admin := frontPageSessionRequest(t, 42, "admin", "GET", "/api/admin/front-page")
	frontPageResultsHandler = func(w http.ResponseWriter, r *http.Request) {
		id, err := e_sessions.GetUserIDFromSession(r)
		actor := dbutils.RequestActorContextFromRequest(r)
		if err != nil || id != 1 || actor.UserRole != "guest" || actor.IsAdmin || read.ResultsPageSizeFromContext(r.Context()) != 3 {
			t.Fatal("admin preview widened actor", id, actor, err)
		}
		w.Write([]byte(`{"columns":["id"],"types":{},"data":[{"id":99}],"row_group_selection":{"slugs":[]}}`))
	}
	diagnostics := frontPageAdminDiagnostics(admin, []frontPageBlock{block}, 0)
	if len(diagnostics) != 1 || diagnostics[0].BoxID != 7 || diagnostics[0].ReasonKey != "row_group_invalid_filters" {
		t.Fatal(diagnostics)
	}
	if id, err := e_sessions.GetUserIDFromSession(admin); err != nil || id != 42 {
		t.Fatal("admin session mutated", id, err)
	}
}
