// dataset_kind_metadata_reader_test.go
// Proves optional classification cannot break readable responses or hidden counts.
// Connects scripted evidence failures and sessions to the existing read handlers.
// Preserves the old body and headers when structural evidence is unavailable.
package dtt_1_row_read

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func kindRequest(t *testing.T, url string) *http.Request {
	t.Helper()
	oldStore, oldName := esessions.Store, esessions.SessionName
	esessions.Store = sessions.NewCookieStore([]byte("kind-reader-cookie-key-32-bytes"))
	esessions.SessionName = "session"
	t.Cleanup(func() { esessions.Store, esessions.SessionName = oldStore, oldName })
	r := httptest.NewRequest("GET", url, nil)
	session, err := esessions.Store.Get(r, esessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"], session.Values["user_role"] = 42, "basic"
	w := httptest.NewRecorder()
	if err := session.Save(r, w); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range w.Result().Cookies() {
		r.AddCookie(cookie)
	}
	return r
}

func TestKindEvidenceFailurePreservesRelatedResponse(t *testing.T) {
	for _, mode := range []string{"query", "decode"} {
		t.Run(mode, func(t *testing.T) {
			rules := appearanceHandlerRules("lazy")
			for i := range rules {
				if rules[i].fragment == "WITH registrations AS (" {
					rules[i].rows = nil
					if mode == "decode" {
						rules[i].rows = [][]driver.Value{{[]byte(`false`)}}
					}
				}
			}
			useScriptedDatabase(t, rules)
			w := requestRelatedRows()
			if w.Code != 200 {
				t.Fatalf("optional evidence broke related rows: %d %s", w.Code, w.Body.String())
			}
			var response struct {
				Children []map[string]json.RawMessage `json:"child_tables"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if len(response.Children) != 2 || w.Header().Get("Content-Type") == "" {
				t.Fatal(w.Body.String(), w.Header())
			}
			for _, child := range response.Children {
				if child["kind_capabilities"] != nil || child["dataset_appearance"] == nil {
					t.Fatal("legacy response changed", string(w.Body.Bytes()))
				}
			}
			responseMap := map[string]interface{}{"data": []int{7}}
			addDatasetKindCapabilities(context.Background(), "parent_rows_notes", responseMap)
			if !reflect.DeepEqual(responseMap, map[string]interface{}{"data": []int{7}}) {
				t.Fatal(responseMap)
			}
		})
	}
}

func TestKindCountPreservesHiddenAndEvidenceFailureResponses(t *testing.T) {
	for _, mode := range []string{"visible", "hidden", "query", "decode", "visibility failure"} {
		t.Run(mode, func(t *testing.T) {
			evidence := [][]driver.Value{{[]byte(`{"registrations":[{"table_uid":22,"name":"public.fixture","table_kind":"ordinary"}],"shapes":[{"name":"public.fixture"}]}`)}}
			if mode == "query" {
				evidence = nil
			}
			if mode == "decode" {
				evidence = [][]driver.Value{{[]byte(`false`)}}
			}
			hidden := [][]driver.Value{{mode == "hidden"}}
			if mode == "visibility failure" {
				hidden = nil
			}
			reads := useScriptedDatabase(t, []scriptedRule{
				{fragment: "WITH registrations AS (", columns: []string{"snapshot"}, rows: evidence},
				{fragment: "dataset.ui_hidden", columns: []string{"hidden"}, rows: hidden},
				{fragment: "must_be_true_unless_own", columns: []string{"column_name"}},
				{fragment: "SELECT COUNT(*)", columns: []string{"count"}, rows: [][]driver.Value{{int64(7)}}},
				{fragment: "FROM information_schema.columns", columns: []string{"column_name"}},
				{fragment: "FROM information_schema.table_constraints", columns: []string{"table_name"}},
			})
			r := kindRequest(t, "/api/get-row-count?dataset=fixture")
			w := httptest.NewRecorder()
			GetRowCountHandlerWrapper(w, r)
			if w.Code != 200 {
				t.Fatalf("old count failed: %d %s", w.Code, w.Body.String())
			}
			var got map[string]interface{}
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if (got["kind_capabilities"] != nil) != (mode == "visible") {
				t.Fatalf("wrong metadata disclosure: %s", w.Body.String())
			}
			delete(got, "kind_capabilities")
			want := map[string]interface{}{"row_count": float64(7), "has_geo": false, "geom_columns": nil, "geom_sources": nil}
			if !reflect.DeepEqual(got, want) || w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
				t.Fatal(got, w.Header())
			}
			steps, unexpected := reads.recorded()
			if len(unexpected) > 0 {
				t.Fatal(unexpected)
			}
			if mode == "hidden" || mode == "visibility failure" {
				for _, step := range steps {
					if step.statement == "" {
						continue
					}
					if strings.Contains(step.statement, "WITH registrations AS (") {
						t.Fatal("kind evidence read before visibility", step.statement)
					}
				}
			}
		})
	}
}

func TestKindRelatedDeduplicatesAuthorizedUIDs(t *testing.T) {
	reads := useScriptedDatabase(t, []scriptedRule{{fragment: "WITH registrations AS (", columns: []string{"snapshot"}, rows: [][]driver.Value{{[]byte(`{"registrations":[{"table_uid":22,"name":"public.child","table_kind":"ordinary"}],"shapes":[{"name":"public.child"}]}`)}}}})
	results := []RelatedTableResult{{DatasetUID: 22}, {DatasetUID: 22}, {DatasetUID: 0}}
	populateRelatedKindCapabilities(context.Background(), results)
	steps, unexpected := reads.recorded()
	if len(unexpected) > 0 || len(steps) != 1 || len(steps[0].args) != 3 || steps[0].args[0] != "{22}" {
		t.Fatal("related evidence was not deduplicated by UID", steps, unexpected)
	}
	if results[0].KindCapabilities == nil || !reflect.DeepEqual(results[0].KindCapabilities, results[1].KindCapabilities) || results[2].KindCapabilities != nil {
		t.Fatal("wrong related classifications", results)
	}
	// Each repeated relation owns its response pointer, but must not allocate
	// another fingerprint or pure classification. This is a cost bound, not timing.
	const duplicates = 200
	repeated := make([]RelatedTableResult, duplicates)
	for index := range repeated {
		repeated[index].DatasetUID = 22
	}
	allocations := testing.AllocsPerRun(5, func() {
		populateRelatedKindCapabilities(context.Background(), repeated)
	})
	if allocations > duplicates*2+150 {
		t.Fatalf("repeated child classifications were not memoized: %.0f allocations", allocations)
	}
}
