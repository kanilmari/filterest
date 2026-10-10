// dataset_appearance_related_postgres_test.go
// Proves related appearance authorization and freshness against real PostgreSQL.
// Connects eager, lazy and outgoing handlers to the existing isolated bootstrap fixture.
// Never uses installation credentials or a production database; the supervisor runs this proof.
package system_table_tools

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

func TestDatasetAppearancePostgresRelatedResultsAuthorizedAndFresh(t *testing.T) {
	db, _ := datasetAppearanceFixture(t)
	frontPageExec(t, db, `
        CREATE TABLE wl160_related(id bigint PRIMARY KEY,title text,parent_id bigint REFERENCES wl143_content(id));
        CREATE TABLE wl160_other_related(id bigint PRIMARY KEY,parent_id bigint REFERENCES wl143_content(id));
        ALTER TABLE wl143_content ADD COLUMN related_id bigint REFERENCES wl160_related(id);
        INSERT INTO wl143_content(id,title) VALUES(7,'Parent');
        INSERT INTO wl160_related VALUES(9,'Child',7);
        INSERT INTO wl160_other_related VALUES(10,7);
        UPDATE wl143_content SET related_id=9 WHERE id=7;
        INSERT INTO system_db_tables(table_name,schema_name,folder_id,is_main_table)
            VALUES('wl160_related','public',1,true),('wl160_other_related','public',1,true);
        INSERT INTO system_functions(id,name,disabled,specific_table_related,url_route_endpoint)
            VALUES(500001,'related_appearance_fixture',false,true,'/api/fetch-dynamic-children');
        INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,f.id,d.table_uid FROM system_db_tables d CROSS JOIN system_functions f
            WHERE d.table_name IN ('wl143_content','wl160_related','wl160_other_related')
              AND f.id IN (500000,500001) AND NOT EXISTS (
                SELECT 1 FROM system_group_table_func_rights r
                WHERE r.user_group_id=2 AND r.function_id=f.id AND r.target_table_uid=d.table_uid);
        INSERT INTO system_column_details(table_uid,column_name,co_number,hide_everywhere,client_delivery_mode)
            SELECT d.table_uid,c.column_name,c.ordinal_position,false,'include' FROM system_db_tables d
            JOIN information_schema.columns c ON c.table_name=d.table_name AND c.table_schema='public'
            WHERE d.table_name IN ('wl143_content','wl160_related','wl160_other_related');`)
	uid, err := store.UIDForName(db, "wl160_related")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_image_width": 440}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	frontPageRuntimeDB(t, db)
	frontPageExec(t, db, `REVOKE ALL ON system_dataset_appearance FROM front_page_runtime`)
	load := func(child string) []read.RelatedTableResult {
		t.Helper()
		body := `{"parent_dataset":"wl143_content","parent_pk_value":"7"`
		if child != "" {
			body += `,"child_table":"` + child + `"`
		}
		request := httptest.NewRequest("POST", "/api/fetch-dynamic-children?dataset=wl143_content", strings.NewReader(body+`}`))
		request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(42, "basic")))
		response := httptest.NewRecorder()
		read.GetDynamicChildItemsHandler(response, request)
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
		var payload struct {
			Children []read.RelatedTableResult `json:"child_tables"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Children
	}
	assertRelated := func(results []read.RelatedTableResult, width float64, version string, denied bool) {
		t.Helper()
		found := 0
		for _, result := range results {
			if result.Table_name != "wl160_related" {
				continue
			}
			found++
			if denied {
				if result.DatasetAppearance != nil || result.DatasetUID != 0 {
					t.Fatal("unreadable related appearance exposed", result)
				}
				continue
			}
			expected, err := store.ReadAppearanceForName(db, uid, "wl160_related", false)
			if err != nil {
				t.Fatal(err)
			}
			actualJSON, _ := json.Marshal(result.DatasetAppearance)
			expectedJSON, _ := json.Marshal(expected)
			if result.DatasetUID != uid || string(actualJSON) != string(expectedJSON) || result.DatasetAppearance.Version != version || result.DatasetAppearance.Effective.Shared.CardImageWidth != width {
				t.Fatalf("related appearance differs from results contract: %+v", result)
			}
		}
		if found == 0 {
			t.Fatal("related dataset was not returned", results)
		}
	}
	all := load("")
	assertRelated(all, 440, saved.Revision, false)
	var lazy, outgoing bool
	for _, result := range all {
		if result.Table_name != "wl160_related" {
			continue
		}
		lazy = lazy || (result.ReferenceDirection == "incoming" && result.RowCount == 1 && len(result.Rows) == 0)
		outgoing = outgoing || (result.ReferenceDirection == "outgoing" && len(result.Rows) == 1)
	}
	if !lazy || !outgoing {
		t.Fatal("lazy or outgoing path missing", all)
	}
	saved, err = datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_image_width": 480}}, saved.Revision)
	if err != nil {
		t.Fatal(err)
	}
	assertRelated(load("wl160_related"), 480, saved.Revision, false)
	assertRelated(load(""), 480, saved.Revision, false)
	frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE user_group_id=2 AND function_id=500000 AND target_table_uid=`+fmtUID(uid))
	assertRelated(load(""), 0, "", true)
	frontPageExec(t, db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(2,500000,`+fmtUID(uid)+`);
        UPDATE system_db_tables SET ui_hidden=true WHERE table_uid=`+fmtUID(uid))
	assertRelated(load(""), 0, "", true)
}
