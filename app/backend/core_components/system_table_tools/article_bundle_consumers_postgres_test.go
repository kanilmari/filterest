// article_bundle_consumers_postgres_test.go
// Exercises existing editor and named-picker sequences against committed bundles.
// Connects actual mutation JSON and SQL readback to the browser's real state helpers.
// Disposable fixtures clean up all synthetic collections, users and languages.
package system_table_tools

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func articleConsumerReadback(t *testing.T, db *sql.DB) viewFieldSetsResponse {
	t.Helper()
	sets, err := listAccessibleViewFieldSets(db, 10, 42, "article_view")
	if err != nil {
		t.Fatal(err)
	}
	groups, err := listViewFieldSetGroupAssignments(db, 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	personal, site, err := resolveViewFieldSetAssignments(db, 10, 1, 42)
	if err != nil {
		t.Fatal(err)
	}
	active, scope, columns, err := resolveEffectiveViewFieldSet(db, 10, 1, 42, "article_view")
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := metadataVisibleViewFieldColumns(db, 10, "article_view")
	if err != nil {
		t.Fatal(err)
	}
	return viewFieldSetsResponse{Dataset: "article_fixture", ViewKey: "article_view",
		FieldSets: sets, GroupAssignments: groups, SiteFieldSetID: site,
		PersonalFieldSetID: personal, ActiveFieldSetID: active, EffectiveScope: scope,
		VisibleColumns: columns, MetadataColumns: metadata}
}

func articleConsumerSave(t *testing.T, db *sql.DB, site bool, request saveViewFieldSetRequest, columns []int) map[string]any {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	r := httptest.NewRequest("POST", "/api/view-field-settings/save", nil)
	w := httptest.NewRecorder()
	respondArticleProjectionSave(w, r, tx, 10, 1, "article_view", "article_fixture", 42, site, request, columns)
	if w.Code != 200 {
		t.Fatal("mutation failed", w.Code, w.Body.String())
	}
	if err := tx.Commit(); err != nil {
		t.Fatal("deferred bundle checks failed", err)
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

// Node imports the production functions unchanged: assertions run on the actual
// serialized HTTP response and committed SQL readback, not reconstructed strings.
func articleConsumerBrowserProof(t *testing.T, data map[string]any) {
	t.Helper()
	path, err := filepath.Abs("../../../frontend/core_components/admin_tools/view_field_assignments_state.js")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", "--input-type=module", "-e", `
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const state = await import(pathToFileURL(process.argv[1]));
const { operation, response, payload, saved } = JSON.parse(readFileSync(0, 'utf8'));
const accepted = operation === 'save'
    ? state.savedAssignmentMatches(response, payload, saved.field_set_id, saved.group_variants)
    : state.resetAssignmentMatches(response, { targetScope: 'site', targetGroupIDs: [] });
if (!accepted) throw new Error('existing editor rejected actual database readback');
`, path)
	cmd.Stdin = bytes.NewReader(raw)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("browser state contract: %v\n%s", err, output)
	}
}

func TestArticleBundleUniformGroupSaveReadbackPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	request := saveViewFieldSetRequest{Name: "Teams", TargetScope: "groups", TargetGroupIDs: []int64{8, 9}, GroupPriority: 7, VisibleColumns: []string{"title"}}
	first := articleConsumerSave(t, db, true, request, []int{1})
	// Two identical groups are the ordinary editor path; group 3 stays unselected.
	request.FieldSetID = int64(first["field_set_id"].(float64))
	request.VisibleColumns = []string{"image", "body"}
	saved := articleConsumerSave(t, db, true, request, []int{3, 2})
	variants := saved["group_variants"].([]any)
	if len(variants) != 2 || variants[0].(map[string]any)["field_set_id"] == variants[1].(map[string]any)["field_set_id"] {
		t.Fatal("uniform save must return both target-owned identities", saved)
	}
	readback := articleConsumerReadback(t, db)
	for _, group := range readback.GroupAssignments {
		if group.GroupID == 3 && group.FieldSetID != nil {
			t.Fatal("unselected group changed")
		}
	}
	articleConsumerBrowserProof(t, map[string]any{"operation": "save", "response": readback, "payload": request, "saved": saved})
}

func TestArticleBundleSiteRestoreReadbackPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	saved := articleConsumerSave(t, db, true, saveViewFieldSetRequest{Name: "Custom site", TargetScope: "site", VisibleColumns: []string{"title"}}, []int{1})
	id := int64(saved["field_set_id"].(float64))
	widthBefore := articleBundleText(t, db, `SELECT presentation_values->'image_first_view'->>'width_px' FROM system_column_field_set_members WHERE field_set_id=$1 AND column_uid=3`, id)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := restoreArticleSiteProjection(tx, 10, "article_view", 42); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	readback := articleConsumerReadback(t, db)
	if readback.SiteFieldSetID == nil || *readback.SiteFieldSetID != id {
		t.Fatal("restore must retain the explicit site bundle", readback)
	}
	if got := articleBundleText(t, db, `SELECT count(*)::text FROM system_view_field_set_assignments WHERE field_set_id=$1`, id); got != "3" {
		t.Fatal("restore broke sibling links", got)
	}
	if got := articleBundleText(t, db, `SELECT presentation_values->'image_first_view'->>'width_px' FROM system_column_field_set_members WHERE field_set_id=$1 AND column_uid=3`, id); got != widthBefore {
		t.Fatal("restore changed sibling width", got)
	}
	articleConsumerBrowserProof(t, map[string]any{"operation": "restore", "response": readback})
}

func TestArticleBundleNamedCollectionsAndReplayPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	save := func(name string, columns []string, uids []int) int64 {
		return int64(articleConsumerSave(t, db, false, saveViewFieldSetRequest{Name: name, VisibleColumns: columns}, uids)["field_set_id"].(float64))
	}
	a := save("A", []string{"title"}, []int{1})
	b := save("B", []string{"body"}, []int{2})
	if a == b {
		t.Fatal("a new name overwrote the earlier saved collection")
	}
	readback := articleConsumerReadback(t, db)
	if readback.PersonalFieldSetID == nil || *readback.PersonalFieldSetID != b || readback.ActiveFieldSetID == nil || *readback.ActiveFieldSetID != b {
		t.Fatal("preset builder cannot identify newly active B", readback)
	}
	for name, columns := range map[string][]string{"A": {"title"}, "B": {"body"}} {
		found := false
		for _, set := range readback.FieldSets {
			if set.Name == name && set.Scope == "personal" {
				found = reflect.DeepEqual(set.VisibleColumns, columns)
			}
		}
		if !found {
			t.Fatal("preset builder lost named collection", name, readback.FieldSets)
		}
	}
	if save("B", []string{"body"}, []int{2}) != b {
		t.Fatal("same-name save did not reuse its collection")
	}
	// Choosing A copies only its requested projection and preserves B as saved.
	if _, err := saveArticleProjection(db, 10, "article_view", int64(42), nil, 0, nil, "Article selection", 42, a); err != nil {
		t.Fatal(err)
	}
	if names, err := viewFieldSetMemberNames(db, b, "article_view"); err != nil || !reflect.DeepEqual(names, []string{"body"}) {
		t.Fatal("selecting A rewrote saved B", names, err)
	}
	if err := resetArticleTarget(db, 10, int64(42), nil); err != nil {
		t.Fatal(err)
	}
	if got := articleBundleText(t, db, `SELECT count(*)::text FROM system_column_field_sets WHERE id IN ($1,$2)`, a, b); got != "2" {
		t.Fatal("reset removed saved choices", got)
	}
	// Existing table/card names remain intact and do not block Article names.
	shared := saveViewFieldSetRequest{Name: "Shared legacy", TargetScope: "site", VisibleColumns: []string{"title"}}
	firstShared := articleConsumerSave(t, db, true, shared, []int{1})
	secondShared := articleConsumerSave(t, db, true, shared, []int{1})
	if firstShared["field_set_id"] != secondShared["field_set_id"] || firstShared["field_set_id"] == float64(100) {
		t.Fatal("legacy-name collision lost independent same-name collection", firstShared, secondShared)
	}
	if names, err := viewFieldSetMemberNames(db, 100, "table"); err != nil || !reflect.DeepEqual(names, []string{"image", "title"}) {
		t.Fatal("Article save changed legacy listing collection", names, err)
	}
	const snapshot = `SELECT jsonb_build_object(
	 'sets',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM system_column_field_sets s),
	 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY field_set_id,sort_order) FROM system_column_field_set_members m),
	 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM system_view_field_set_assignments a),
	 'repairs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY migration,action) FROM system_data_repair_records r))::text`
	before := articleBundleText(t, db, snapshot)
	for _, migration := range articleBundleMigrations {
		frontPageExec(t, db, articleBundleSQL(t, migration))
	}
	if got := articleBundleText(t, db, snapshot); got != before {
		t.Fatal("000010–000012 replay changed saved choices or completion evidence")
	}
	if _, err := db.Exec(`DELETE FROM system_column_field_sets WHERE id=$1`, a); err == nil {
		t.Fatal("generic writer deleted a detached named article collection")
	}
	if got := articleBundleText(t, db, `SELECT app_delete_article_collection($1,73)::text`, a); got != "0" {
		t.Fatal("collection service deleted another user's choice", got)
	}
	if got := articleBundleText(t, db, `SELECT app_delete_article_collection($1,42)::text`, a); got != "1" {
		t.Fatal("collection service could not delete the owner's detached choice", got)
	}
	if names, err := viewFieldSetMemberNames(db, b, "article_view"); err != nil || !reflect.DeepEqual(names, []string{"body"}) {
		t.Fatal("deleting A changed saved B", names, err)
	}
}
