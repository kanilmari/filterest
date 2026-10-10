// get_child_items_appearance_test.go
// Proves related results carry a fresh, authorized UID-bound appearance contract.
// Connects the HTTP handler to scripted role and registry reads without PostgreSQL.
// Keeps lazy summaries and administrator metadata subject to ordinary read authorization.
package dtt_1_row_read

import (
	"database/sql/driver"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	appearance "easelect/frontend/shared/dataset_appearance"
)

func appearanceHandlerRules(mode string) []scriptedRule {
	permission := scriptedRule{fragment: "system_group_table_func_rights", columns: []string{"granted"}, rows: [][]driver.Value{{int64(1)}}}
	rules := parentWithAGallery(permission)
	// Ordinary relations, so no gallery transaction is needed for these proofs.
	for index := range rules {
		if mode == "eager" && rules[index].fragment == "AS referencing_table" {
			rules[index].rows = rules[index].rows[:1]
		}
		if rules[index].fragment == "target_insert_specs" {
			rules[index].rows = nil
		}
		if rules[index].fragment == "information_schema.tables" {
			rules[index].rows = [][]driver.Value{{false}}
		}
	}
	if mode == "denied" {
		rules = append([]scriptedRule{{fragment: "system_group_table_func_rights", columns: []string{"granted"},
			matches: func(args []driver.Value) bool { return args[0] == "/api/get-results" }}}, rules...)
	}
	tab, _ := json.Marshal(appearance.Rules().DefaultsForPlace(appearance.TabOnly))
	rules = append(rules,
		scriptedRule{fragment: "SELECT src.table_name, fk.source_column_name", columns: []string{"table_name", "source_column_name"}},
		scriptedRule{fragment: "AND column_name = $2", columns: []string{"exists"}, rows: [][]driver.Value{{false}}},
		scriptedRule{fragment: "SELECT table_uid FROM public.system_db_tables", columns: []string{"table_uid"}, rows: [][]driver.Value{{int64(22)}}},
		scriptedRule{fragment: "dataset.ui_hidden = TRUE", columns: []string{"hidden"}, rows: [][]driver.Value{{mode == "hidden"}}},
		scriptedRule{fragment: "a.schema_version,a.tab_values,a.overrides,a.revision::text", columns: []string{"site", "stamp", "schema_version", "tab_values", "overrides", "revision"},
			rows: [][]driver.Value{{nil, "", int64(2), tab, []byte(`{"shared.card_image_width":440}`), "2"}}},
		scriptedRule{fragment: "SELECT COUNT(*)", columns: []string{"count"}, rows: [][]driver.Value{{int64(1)}}},
		scriptedRule{fragment: "public.app_row_actor_column", columns: []string{"column_name", "actor_role"}},
		scriptedRule{fragment: `FROM "parent_rows_notes"`, columns: []string{"id"}, rows: [][]driver.Value{{int64(9)}}},
		// Type metadata is optional; empty metadata is enough to prove appearance ownership.
		scriptedRule{fragment: "SELECT c.column_name", columns: []string{"column_name"}},
	)
	return rules
}

func TestRelatedAppearanceHandlerContract(t *testing.T) {
	for _, mode := range []string{"eager", "lazy", "metadata", "denied", "hidden"} {
		t.Run(mode, func(t *testing.T) {
			reads := useScriptedDatabase(t, appearanceHandlerRules(mode))
			var response *httptest.ResponseRecorder
			if mode == "metadata" {
				previous := backend.DbAdmin
				backend.DbAdmin = backend.DbBasic
				t.Cleanup(func() { backend.DbAdmin = previous })
				request := httptest.NewRequest("POST", "/api/fetch-dynamic-children?dataset=parent_rows",
					strings.NewReader(`{"parent_dataset":"parent_rows","metadata_only":true}`))
				request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(42, "admin")))
				response = httptest.NewRecorder()
				GetDynamicChildItemsHandler(response, request)
			} else {
				response = requestRelatedRows()
			}
			if response.Code != 200 {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			var body struct {
				Children []map[string]json.RawMessage `json:"child_tables"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			wantChildren := 2
			if mode == "eager" {
				wantChildren = 1
			}
			if len(body.Children) != wantChildren {
				t.Fatalf("missing related results: %s", response.Body.String())
			}
			for _, child := range body.Children {
				if mode == "denied" || mode == "hidden" {
					if child["dataset_appearance"] != nil || child["dataset_uid"] != nil {
						t.Fatalf("unreadable appearance exposed: %s", response.Body.String())
					}
					continue
				}
				if string(child["dataset_uid"]) != "22" {
					t.Fatalf("missing related UID: %s", response.Body.String())
				}
				var snapshot store.AppearanceResponse
				if err := json.Unmarshal(child["dataset_appearance"], &snapshot); err != nil {
					t.Fatal(err)
				}
				if snapshot.DatasetUID != 22 || snapshot.Version != "2" || snapshot.SchemaVersion != 2 || len(snapshot.TabValues) != 28 || len(snapshot.Sources) != 44 || snapshot.Effective.Shared.CardImageWidth != 440 {
					t.Fatalf("wrong current appearance: %+v", snapshot)
				}
			}
			steps, unexpected := reads.recorded()
			if len(unexpected) > 0 {
				t.Fatalf("unscripted queries: %q", unexpected)
			}
			for _, step := range steps {
				if strings.Contains(step.statement, "a.schema_version") {
					if mode == "denied" || mode == "hidden" {
						t.Fatal("private appearance was read before authorization")
					}
					if len(step.args) != 3 || step.args[0] != int64(22) || !strings.HasPrefix(step.args[2].(string), "parent_rows_") {
						t.Fatalf("snapshot not pinned to authorized UID/name: %v", step.args)
					}
				}
			}
		})
	}
}

func TestRelatedAppearanceNameReuseFailsClosed(t *testing.T) {
	rules := appearanceHandlerRules("lazy")
	for index := range rules {
		if strings.Contains(rules[index].fragment, "a.schema_version") {
			rules[index].rows = nil
		}
	}
	useScriptedDatabase(t, rules)
	response := requestRelatedRows()
	if response.Code != 500 || strings.Contains(response.Body.String(), "dataset_appearance") || strings.Contains(response.Body.String(), "child_tables") {
		t.Fatalf("a UID/name mismatch must refuse the response: %d %s", response.Code, response.Body.String())
	}
}
