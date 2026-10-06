// new_blockers_postgres_test.go
// Proves HTTP endpoint validation and generic metadata rollback for new blockers.
// Reuses real bootstrap handlers and lazy transaction completion.
// An unchanged invalid row elsewhere still allows an unrelated request.
package runtime_grants_test

import (
	"bytes"
	create "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	triggers "easelect/backend/core_components/dynamic_table_tools/dtt_triggers"
	. "easelect/backend/core_components/runtime_grants"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func TestHTTPMutationsCannotIntroduceUnresolvedAutomationsPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("valid_endpoint", "")
	for _, endpoint := range []string{"source", "target"} {
		var fi, en string
		if err := f.owner.QueryRow(`SELECT fi,en FROM system_lang_keys WHERE lang_key=$1`, "error_trigger_"+endpoint+"_dataset_missing").Scan(&fi, &en); err != nil || fi == "" || en == "" {
			t.Fatal("missing translated endpoint refusal", endpoint, fi, en, err)
		}
	}
	for _, endpoints := range [][2]string{{"missing_source", "valid_endpoint"}, {"valid_endpoint", "missing_target"}, {"missing_source", "missing_target"}} {
		rec := f.request(triggers.CreateTriggerHandler, fmt.Sprintf(`{"source_dataset":%q,"target_dataset":%q,"condition":"id = 1","action_values":"{}"}`, endpoints[0], endpoints[1]), 400)
		endpoint := "source"
		if endpoints[0] == "valid_endpoint" {
			endpoint = "target"
		}
		if !strings.Contains(rec.Body.String(), "dataset does not exist") || !strings.Contains(rec.Body.String(), "error_trigger_"+endpoint+"_dataset_missing") {
			t.Fatal(rec.Body)
		}
	}
	var count int
	if err := f.owner.QueryRow(`SELECT count(*) FROM system_triggers`).Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid automation saved", count, err)
	}
	// Register the optional legacy table so the generic metadata writer can use it;
	// a creation's registry refresh may already have registered it.
	FixtureExec(t, f.owner, `INSERT INTO system_db_tables(table_name,schema_name) SELECT 'system_triggers','public'
	 WHERE NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name='system_triggers' AND schema_name='public')`)
	FixtureExec(t, f.owner, `UPDATE system_column_details c SET insertable=true,editable_in_ui=true FROM system_db_tables d
	 WHERE d.table_name='system_triggers' AND c.table_uid=d.table_uid;
	 INSERT INTO system_column_details(table_uid,column_name,data_type,insertable,editable_in_ui)
	 SELECT d.table_uid,a.attname,format_type(a.atttypid,a.atttypmod),true,true FROM system_db_tables d,pg_attribute a
	 WHERE d.table_name='system_triggers' AND a.attrelid='system_triggers'::regclass AND a.attnum>0 AND NOT a.attisdropped
	   AND NOT EXISTS (SELECT 1 FROM system_column_details c WHERE c.table_uid=d.table_uid AND c.column_name=a.attname)`)
	for _, endpoints := range [][2]string{{"missing_source", "valid_endpoint"}, {"valid_endpoint", "missing_target"}, {"missing_source", "missing_target"}} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		writer.WriteField("jsonPayload", fmt.Sprintf(`{"source_table":%q,"target_table":%q,"condition":"id = 1","action_values":"{}"}`, endpoints[0], endpoints[1]))
		writer.Close()
		rec := f.request(func(w http.ResponseWriter, r *http.Request) {
			r.Body = io.NopCloser(bytes.NewReader(body.Bytes()))
			r.Header.Set("Content-Type", writer.FormDataContentType())
			create.AddRowMultipartHandler(w, r, "system_triggers")
		}, "", 409)
		if !strings.Contains(rec.Body.String(), "error_runtime_grant_policy_blocked") {
			t.Fatal(rec.Body)
		}
		if err := f.owner.QueryRow(`SELECT count(*) FROM system_triggers`).Scan(&count); err != nil || count != 0 {
			t.Fatal("generic blocker committed", count, err)
		}
	}
	FixtureExec(t, f.owner, `INSERT INTO system_triggers(source_table,target_table,condition,action_values) VALUES('old_missing_source','old_missing_target','true','{}')`)
	f.create("unrelated_after_old_blocker", "")
	if err := f.owner.QueryRow(`SELECT count(*) FROM system_triggers`).Scan(&count); err != nil || count != 1 {
		t.Fatal("old invalid row changed", count, err)
	}
}
