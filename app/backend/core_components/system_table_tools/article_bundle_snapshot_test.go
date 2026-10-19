// article_bundle_snapshot_test.go
// Compares article storage by its dataset, collection, field and target identities.
// Connects bootstrap/upgrade proofs to bounded, column-level failure diagnostics.
// Keeps generated identity allocation and installation times out of content equality.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

type articleBundleStorageSnapshot map[string]map[string]map[string]json.RawMessage

func articleBundleStorage(t *testing.T, db *sql.DB) articleBundleStorageSnapshot {
	t.Helper()
	// Dataset UIDs are installation-local: runtime.seed.sql registers datasets
	// through an unordered pg_class join, whose order changes with folded schema
	// DDL. Resolve EVERY dataset reference to schema/name, and column/collection/
	// view references to their natural keys; do not compare generated sequence IDs.
	// created/updated record separate installation times, not article settings.
	// Seeded user/group identities are fixed. Order, priorities, all projection
	// values, collection ownership/names, sections, opener policy and audience
	// scopes must still match. Assignments are checked separately from members so
	// even empty collections and their three sibling links remain observable.
	raw := articleBundleText(t, db, `WITH datasets AS (
	 SELECT table_uid,format('%I.%I',COALESCE(NULLIF(schema_name,''),'public'),table_name) AS dataset,
	  article_section_initial_open,article_opener_policy FROM system_db_tables
	), bundles AS (
	 SELECT s.*,d.dataset FROM system_column_field_sets s JOIN datasets d USING(table_uid) WHERE s.article_family
	)
	SELECT jsonb_build_object(
	 'system_db_tables',(SELECT jsonb_object_agg(dataset,jsonb_build_object(
	  'article_section_initial_open',article_section_initial_open,'article_opener_policy',article_opener_policy)) FROM datasets),
	 'system_column_field_sets',(SELECT jsonb_object_agg(
	  jsonb_build_object('dataset',s.dataset,'owner_user_id',s.owner_user_id,'name',s.name)::text,
	  to_jsonb(s)-'id'-'table_uid'-'dataset'-'created'-'updated') FROM bundles s),
	 'system_column_field_set_members',(SELECT jsonb_object_agg(
	  jsonb_build_object('dataset',s.dataset,'owner_user_id',s.owner_user_id,'collection',s.name,'field',c.column_name)::text,
	  jsonb_build_object('sort_order',m.sort_order,'column_width_px',m.column_width_px,'presentation_values',m.presentation_values))
	  FROM system_column_field_set_members m JOIN bundles s ON s.id=m.field_set_id
	  JOIN system_column_details c ON c.table_uid=m.table_uid AND c.column_uid=m.column_uid),
	 'system_view_field_set_assignments',(SELECT jsonb_object_agg(
	  jsonb_build_object('dataset',d.dataset,'user_id',a.user_id,'group_id',a.group_id,'view_key',v.view_key)::text,
	  jsonb_build_object('collection',s.name,'owner_user_id',s.owner_user_id,'group_priority',a.group_priority,'created_by',a.created_by))
	  FROM system_view_field_set_assignments a JOIN datasets d USING(table_uid)
	  JOIN system_table_views v ON v.id=a.view_id JOIN bundles s ON s.id=a.field_set_id
	  WHERE v.view_key=ANY(app_article_keys())),
	 'system_group_table_func_rights',(SELECT jsonb_object_agg(
	  jsonb_build_object('function',f.name,'user_group_id',r.user_group_id,'target_schema_name',r.target_schema_name,'target_dataset',d.dataset)::text,
	  jsonb_build_object('function',f.name,'user_group_id',r.user_group_id,'target_schema_name',r.target_schema_name,'target_dataset',d.dataset))
	  FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id
	  LEFT JOIN datasets d ON d.table_uid=r.target_table_uid
	  WHERE f.name IN('ui.view.image_first_view','ui.view.image_first_page_view')))::text`)
	var snapshot articleBundleStorageSnapshot
	if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

// Stable table/key/column ordering makes the first twenty differences useful
// without dumping either database. A missing row is distinct from JSON null.
func articleBundleStorageDiff(fresh, upgraded articleBundleStorageSnapshot) string {
	var differences []string
	add := func(table, key, column, freshValue, upgradedValue string) bool {
		if len(differences) == 20 {
			differences = append(differences, "... further differences omitted (limit 20)")
			return false
		}
		differences = append(differences, fmt.Sprintf("table=%s key=%s column=%s fresh=%s upgraded=%s",
			table, key, column, freshValue, upgradedValue))
		return true
	}
	for _, table := range articleBundleStorageKeys(fresh, upgraded) {
		for _, key := range articleBundleStorageKeys(fresh[table], upgraded[table]) {
			freshRow, freshExists := fresh[table][key]
			upgradedRow, upgradedExists := upgraded[table][key]
			if freshExists != upgradedExists {
				rowValue := func(row map[string]json.RawMessage, exists bool) string {
					if !exists {
						return "<missing>"
					}
					encoded, _ := json.Marshal(row)
					return string(encoded)
				}
				if !add(table, key, "<row>", rowValue(freshRow, freshExists), rowValue(upgradedRow, upgradedExists)) {
					return strings.Join(differences, "\n")
				}
				continue
			}
			for _, column := range articleBundleStorageKeys(freshRow, upgradedRow) {
				freshValue, upgradedValue := articleBundleStorageValue(freshRow[column]), articleBundleStorageValue(upgradedRow[column])
				if freshValue != upgradedValue && !add(table, key, column, freshValue, upgradedValue) {
					return strings.Join(differences, "\n")
				}
			}
		}
	}
	return strings.Join(differences, "\n")
}

func articleBundleStorageKeys[V any](fresh, upgraded map[string]V) []string {
	keys := make(map[string]bool, len(fresh)+len(upgraded))
	for key := range fresh {
		keys[key] = true
	}
	for key := range upgraded {
		keys[key] = true
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	slices.Sort(ordered)
	return ordered
}

func articleBundleStorageValue(raw json.RawMessage) string {
	if raw == nil {
		return "<missing>"
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		panic(err)
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func TestArticleBundleStorageDiff(t *testing.T) {
	if got := articleBundleStorageValue(json.RawMessage(`9007199254740993`)); got != "9007199254740993" {
		t.Fatal("diagnostics rounded an identity", got)
	}
	fresh := articleBundleStorageSnapshot{"members": {"public.example/title": {
		"sort_order": json.RawMessage(`1`), "presentation_values": json.RawMessage(`{"width_px":null,"visible":true}`),
	}}}
	upgraded := articleBundleStorageSnapshot{"members": {"public.example/title": {
		"sort_order": json.RawMessage(`2`), "presentation_values": json.RawMessage(`{"visible":true, "width_px":0}`),
	}}}
	want := "table=members key=public.example/title column=presentation_values fresh={\"visible\":true,\"width_px\":null} upgraded={\"visible\":true,\"width_px\":0}\n" +
		"table=members key=public.example/title column=sort_order fresh=1 upgraded=2"
	if got := articleBundleStorageDiff(fresh, upgraded); got != want {
		t.Fatalf("diff:\n%s\nwant:\n%s", got, want)
	}
	upgraded["members"]["public.example/title"] = map[string]json.RawMessage{
		"presentation_values": json.RawMessage(`{"visible":true, "width_px":null}`), "sort_order": json.RawMessage(`1`),
	}
	if got := articleBundleStorageDiff(fresh, upgraded); got != "" {
		t.Fatal("JSON formatting/key order changed equality", got)
	}
	delete(upgraded["members"]["public.example/title"], "sort_order")
	if got := articleBundleStorageDiff(fresh, upgraded); !strings.Contains(got, "column=sort_order fresh=1 upgraded=<missing>") {
		t.Fatal("missing column was not diagnosed", got)
	}
	fresh["members"]["public.example/title"]["sort_order"] = json.RawMessage(`null`)
	if got := articleBundleStorageDiff(fresh, upgraded); !strings.Contains(got, "fresh=null upgraded=<missing>") {
		t.Fatal("JSON null was confused with missing", got)
	}
	delete(upgraded["members"], "public.example/title")
	if got := articleBundleStorageDiff(fresh, upgraded); !strings.Contains(got, "column=<row> fresh={") || !strings.HasSuffix(got, "upgraded=<missing>") {
		t.Fatal("missing row was not diagnosed", got)
	}
	if got := articleBundleStorageDiff(upgraded, fresh); !strings.Contains(got, "column=<row> fresh=<missing> upgraded={") {
		t.Fatal("extra upgraded row was not diagnosed", got)
	}
	for i := range 25 {
		fresh["members"][fmt.Sprintf("row%02d", i)] = map[string]json.RawMessage{"sort_order": json.RawMessage(`1`)}
	}
	got := articleBundleStorageDiff(fresh, upgraded)
	if strings.Count(got, "table=") != 20 || !strings.HasSuffix(got, "... further differences omitted (limit 20)") {
		t.Fatal("diff was not bounded", got)
	}
}
