// article_bundle_postgres_test.go
// Proves materialization, replay and storage boundaries on disposable PostgreSQL.
// Connects the real release migrations and shared mutation service to legacy evidence.
// Never uses installation credentials; each fixture cluster is removed on every exit.
package system_table_tools

import (
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	contract "easelect/frontend/shared/article_presentations"
)

var articleBundleMigrations = []string{
	"20261015000010_add_article_bundle_storage.sql",
	"20261015000011_add_article_bundle_mutations.sql",
	"20261015000012_materialize_article_bundles.sql",
}

func articleBundleSQL(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func articleBundleFixture(t *testing.T, upgrade bool) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testing", "fixtures", "article_bundle_legacy.sql"))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, string(raw))
	for _, name := range articleBundleMigrations[:2] {
		frontPageExec(t, db, articleBundleSQL(t, name))
	}
	if upgrade {
		frontPageExec(t, db, articleBundleSQL(t, articleBundleMigrations[2]))
	}
	return db
}

func articleBundleText(t *testing.T, q interface{ QueryRow(string, ...any) *sql.Row }, query string, args ...any) string {
	t.Helper()
	var value string
	if err := q.QueryRow(query, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func articleBundleTransaction(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(query); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// Bootstrap boundaries must neither drop a trigger nor leave runtime writes
// immediate: incomplete sections may be written, but cannot survive commit.
func articleBundleAssertDeferredCommit(t *testing.T, db *sql.DB) {
	t.Helper()
	if got := frontPageCount(t, db, `SELECT count(*) FROM pg_constraint
	 WHERE conname='article_bundle_invariant' AND condeferrable AND condeferred`); got != 6 {
		t.Fatal("six deferred runtime constraints required", got)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE system_db_tables SET article_section_initial_open='{}'
	 WHERE table_uid=(SELECT min(table_uid) FROM system_db_tables)`); err != nil {
		t.Fatal("invariant must allow intermediate writes until commit", err)
	}
	if err := tx.Commit(); err == nil || !strings.Contains(err.Error(), "article bundle invariant") {
		t.Fatal("incomplete sections must fail at commit", err)
	}
}

func TestArticleBundleStoredSettingsNothingChangesPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	for key, expected := range map[string]string{
		"article_view":          `[[3, 0], [1, null]]`,
		"image_first_view":      `[[3, 220], [1, null], [2, 0]]`,
		"image_first_page_view": `[[3, 220], [1, null], [2, 0]]`,
	} {
		actual := articleBundleText(t, db, `SELECT jsonb_agg(jsonb_build_array(m.column_uid,(m.presentation_values->$1->>'width_px')::int) ORDER BY m.sort_order)::text
		 FROM system_view_field_set_assignments a JOIN system_table_views v ON v.id=a.view_id JOIN system_column_field_set_members m ON m.field_set_id=a.field_set_id
		 WHERE a.table_uid=10 AND a.user_id IS NULL AND a.group_id IS NULL AND v.view_key=$1 AND (m.presentation_values->$1->>'visible')::boolean`, key)
		if actual != expected {
			t.Fatalf("%s preservation: %s", key, actual)
		}
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM app_check_article_bundles()`); got != 0 {
		t.Fatal("invariants", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_sets WHERE article_family`); got != 5 {
		t.Fatal("one bundle per existing target plus metadata site", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_set_members WHERE field_set_id=100 AND presentation_values IS NULL`); got != 2 {
		t.Fatal("shared table/legacy collection changed", got)
	}
	if got := articleBundleText(t, db, `SELECT string_agg(column_uid::text,',' ORDER BY m.sort_order) FROM system_column_field_set_members m
	 JOIN system_view_field_set_assignments a ON a.field_set_id=m.field_set_id JOIN system_table_views v ON v.id=a.view_id
	 WHERE a.table_uid=11 AND v.view_key='article_view'`); got != "4,5" {
		t.Fatal("metadata order", got)
	}
	if got := articleBundleText(t, db, `SELECT article_section_initial_open::text FROM system_db_tables WHERE table_uid=10`); strings.Contains(got, "classic") || strings.Contains(got, "image_first\"") || !strings.Contains(got, `"attachments": false`) || strings.Count(got, `"details": false`) != 3 {
		t.Fatal("canonical explicit blocks", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id WHERE f.name IN('ui.view.image_first_view','ui.view.image_first_page_view')`); got != 4 {
		t.Fatal("null-safe one-time audience", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights WHERE user_group_id=3`); got != 0 {
		t.Fatal("invented guest grants", got)
	}
	for role, key := range contract.Read().OpenerDefaults {
		if got := articleBundleText(t, db, `SELECT article_opener_policy->>$1 FROM system_db_tables WHERE table_uid=10`, role); got != key {
			t.Fatal("policy contract drift", role, got)
		}
	}
	// Explicitly record the source-dependent difference: a group's formerly
	// unassigned IFAV inherited the site projection [image,title,body], whereas
	// materialization selects that exact group's Article [body,title], widths 280/90.
	// Ordinary IFAV still consumes the opener's supplied row until batch 4.
	if got := articleBundleText(t, db, `SELECT jsonb_agg(jsonb_build_array(m.column_uid,(m.presentation_values->'image_first_view'->>'width_px')::int) ORDER BY m.sort_order)::text
	 FROM system_column_field_set_members m JOIN system_view_field_set_assignments a ON a.field_set_id=m.field_set_id
	 JOIN system_table_views v ON v.id=a.view_id WHERE a.group_id=8 AND v.view_key='image_first_view'`); got != `[[2, 280], [1, 90]]` {
		t.Fatal("exact-target IFAV materialization", got)
	}
	t.Log("IFAV difference: group 8 site fallback [3:220,1:null,2:0] becomes explicit [2:280,1:90]; supplied-row/history behavior remains source-dependent")
}

func TestArticleBundlePrecedenceWidthsGuestPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	for _, key := range []string{"article_view", "image_first_view", "image_first_page_view"} {
		var view int
		if err := db.QueryRow(`SELECT id FROM system_table_views WHERE view_key=$1`, key).Scan(&view); err != nil {
			t.Fatal(err)
		}
		_, scope, columns, err := resolveEffectiveViewFieldSet(db, 10, view, 42, key)
		if err != nil || scope != "personal" || !reflect.DeepEqual(columns, []string{"image", "title"}) {
			t.Fatal(scope, columns, err)
		}
		if _, scope, _, err := resolveEffectiveViewFieldSet(db, 10, view, 1, key); err != nil || scope != "site" {
			t.Fatal("guest must use site", scope, err)
		}
	}
	if err := resetArticleTarget(db, 10, int64(42), nil); err != nil {
		t.Fatal(err)
	}
	_, scope, columns, err := resolveEffectiveViewFieldSet(db, 10, 1, 42, "article_view")
	if err != nil || scope != "group" || !reflect.DeepEqual(columns, []string{"body", "title"}) {
		t.Fatal("tied groups must use lower group ID", scope, columns, err)
	}
}

func TestArticleBundleDatasetFieldLifecyclePostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	frontPageExec(t, db, `INSERT INTO system_db_tables(table_uid,table_name) VALUES(12,'new_dataset');
	 INSERT INTO system_column_details(column_uid,table_uid,column_name,co_number) VALUES(7,12,'new_field',1);`)
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_view_field_set_assignments WHERE table_uid=12`); got != 3 {
		t.Fatal("new dataset links", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_set_members WHERE table_uid=12 AND presentation_values=app_article_values(true)`); got != 1 {
		t.Fatal("new field explicit values", got)
	}
	frontPageExec(t, db, `UPDATE system_column_details SET client_delivery_mode='server_only' WHERE column_uid=7`)
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_set_members WHERE table_uid=12 AND presentation_values=app_article_values(false)`); got != 1 {
		t.Fatal("restricted field stayed visible", got)
	}
	frontPageExec(t, db, `DELETE FROM system_column_details WHERE column_uid=7`)
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_set_members WHERE table_uid=12`); got != 0 {
		t.Fatal("deleted field remained", got)
	}
}

// Both paths execute the identical data step. The snapshot resolves generated
// identities to dataset/field names, retaining order, widths, targets and audiences.
func TestArticleBundleFreshBootstrapEquivalencePostgres(t *testing.T) {
	var upgraded, freshStorage articleBundleStorageSnapshot
	for _, fresh := range []bool{false, true} {
		db := sitePresentationDisposableDB(t)
		frontPageExec(t, db, `DROP TABLE public.system_config`)
		root := filepath.Join("..", "..", "..", "server_tools", "public_bootstrap")
		schema, err := os.ReadFile(filepath.Join(root, "schema.sql"))
		if err != nil {
			t.Fatal(err)
		}
		seed, err := os.ReadFile(filepath.Join(root, "seed_data.sql"))
		if err != nil {
			t.Fatal(err)
		}
		schemaSQL := string(schema)
		if !fresh {
			for _, name := range articleBundleMigrations[:2] {
				data := articleBundleSQL(t, name)
				if !strings.Contains(schemaSQL, data) {
					t.Fatal("bootstrap does not embed exact schema migration", name)
				}
				schemaSQL = strings.Replace(schemaSQL, data, "", 1)
			}
		}
		// Each complete file has its own explicit transaction. Splitting the
		// seed into statements would hide pending-trigger failures before DDL.
		articleBundleTransaction(t, db, schemaSQL)
		if fresh {
			articleBundleTransaction(t, db, string(seed))
		} else {
			data := articleBundleSQL(t, articleBundleMigrations[2])
			before, _, found := strings.Cut(string(seed), data)
			if !found {
				t.Fatal("bootstrap does not embed exact data migration")
			}
			articleBundleTransaction(t, db, before)
			// Upgrade the genuinely old schema and seeded defaults; the fresh
			// path above instead installs the folded schema before the seeds.
			for _, name := range articleBundleMigrations[:2] {
				articleBundleTransaction(t, db, articleBundleSQL(t, name))
			}
			articleBundleTransaction(t, db, data)
		}
		articleBundleAssertDeferredCommit(t, db)
		if fresh {
			freshStorage = articleBundleStorage(t, db)
		} else {
			upgraded = articleBundleStorage(t, db)
		}
	}
	if diff := articleBundleStorageDiff(freshStorage, upgraded); diff != "" {
		t.Fatalf("fresh and upgraded article storage differs:\n%s", diff)
	}
}

// The instance and legacy Docker bootstrap callers share this exact importer.
// It streams schema then seed through psql with ON_ERROR_STOP, without -1.
func TestArticleBundlePackageImportPostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	frontPageExec(t, db, `DROP TABLE public.system_config`)
	var socket, port, user, database string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port'),current_user,current_database()`).Scan(&socket, &port, &user, &database); err != nil {
		t.Fatal(err)
	}
	tools, err := filepath.Abs(filepath.Join("..", "..", "..", "server_tools"))
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("bash", "-c", `source "$1"; import_bootstrap_package "$2/schema.sql" "$2/seed_data.sql" 1 "$3" -X -h "$4" -p "$5" -U "$6" -d "$7"`,
		"article-bundle-import", filepath.Join(tools, "lib", "public_bootstrap.sh"), filepath.Join(tools, "public_bootstrap"),
		"/usr/lib/postgresql/16/bin/psql", socket, port, user, database)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("real bootstrap package import: %v: %s", err, output)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM app_check_article_bundles()`); got != 0 {
		t.Fatal("imported bundle invariant", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records
	 WHERE migration='article_bundle_materialization' AND action='completed'`); got != 1 {
		t.Fatal("import did not finish materialization", got)
	}
	articleBundleAssertDeferredCommit(t, db)
}

func TestArticleBundleSharedMutationForbiddenAndRollbackPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	id, err := saveArticleProjection(tx, 10, "article_view", nil, nil, 0, []int{1}, "Site", 73, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := articleBundleText(t, tx, `SELECT presentation_values->'image_first_view'->>'width_px' FROM system_column_field_set_members WHERE field_set_id=$1 AND column_uid=3`, id); got != "220" {
		t.Fatal("sibling width changed", got)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_set_members WHERE (presentation_values->'article_view'->>'visible')::boolean AND column_uid=3`); got != 2 {
		t.Fatal("rollback lost settings", got)
	}
	for _, statement := range []string{
		`UPDATE system_view_field_set_assignments SET group_priority=8 WHERE group_id=8 AND view_id=1`,
		`DELETE FROM system_view_field_set_assignments WHERE table_uid=10 AND user_id IS NULL AND group_id IS NULL AND view_id=1`,
		`UPDATE system_column_field_set_members SET presentation_values='{}' WHERE presentation_values IS NOT NULL`,
		`UPDATE system_column_field_set_members SET column_width_px=88 WHERE presentation_values IS NOT NULL`,
		`UPDATE system_db_tables SET article_opener_policy='{}' WHERE table_uid=10`,
		`UPDATE system_db_tables SET article_opener_policy=article_opener_policy WHERE table_uid=10`,
		`UPDATE system_db_tables SET article_opener_policy=jsonb_set(article_opener_policy,'{card-body}','"image_first_view"') WHERE table_uid=10`,
		`UPDATE system_column_field_sets SET name=name||' bypass' WHERE article_family`,
		`UPDATE system_column_field_set_members SET presentation_values=jsonb_set(presentation_values,'{article_view,width_px}','99') WHERE presentation_values IS NOT NULL`,
		`UPDATE system_view_field_set_assignments SET group_priority=8 WHERE group_id=8`,
		`INSERT INTO system_db_tables(table_uid,table_name,article_opener_policy) VALUES(12,'generic_policy',jsonb_set(app_article_opener_defaults(),'{card-body}','"image_first_view"'))`,
	} {
		if _, err := db.Exec(statement); err == nil {
			t.Fatal("generic writer bypass", statement)
		}
	}
	// The guard must outlive neither a successful call nor a rolled-back save.
	if got := articleBundleText(t, db, `SELECT COALESCE(current_setting('filterest.article_bundle_mutation',true),'')`); got == "on" {
		t.Fatal("mutation service leaked its write scope")
	}
	frontPageExec(t, db, `SELECT app_save_article_opener_policy(10,jsonb_set(app_article_opener_defaults(),'{card-body}','"image_first_view"'))`)
	if got := articleBundleText(t, db, `SELECT article_opener_policy->>'card-body' FROM system_db_tables WHERE table_uid=10`); got != "image_first_view" {
		t.Fatal("opener service did not save", got)
	}
	if _, err := db.Exec(`UPDATE system_db_tables SET article_opener_policy=app_article_opener_defaults() WHERE table_uid=10`); err == nil {
		t.Fatal("successful service call authorized a later generic write")
	}
	for _, user := range []interface{}{int64(1), nil} {
		tx, _ := db.Begin()
		_, err := saveArticleProjection(tx, 10, "article_view", user, nil, 0, []int{6}, "Forbidden", 73, nil)
		tx.Rollback()
		if err == nil {
			t.Fatal("guest/forbidden field accepted", user)
		}
	}
}

func TestArticleBundleIndependentWidthsAndLegacySelectionPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	id, err := saveArticleProjection(tx, 10, "image_first_view", nil, nil, 0, nil, "Select legacy", 73, int64(100))
	if err != nil {
		t.Fatal(err)
	}
	if got := articleBundleText(t, tx, `SELECT presentation_values->'image_first_page_view'->>'width_px' FROM system_column_field_set_members WHERE field_set_id=$1 AND column_uid=3`, id); got != "220" {
		t.Fatal("legacy selection changed Page width", got)
	}
	if got := articleBundleText(t, tx, `SELECT presentation_values->'image_first_view'->>'width_px' FROM system_column_field_set_members WHERE field_set_id=$1 AND column_uid=3`, id); got != "0" {
		t.Fatal("legacy selection lost stored zero width", got)
	}
	// A legacy collection supplies an automatic Article width through the same
	// service as selection; direct bundle edits are forbidden even when valid.
	if _, err := tx.Exec(`UPDATE system_column_field_set_members SET column_width_px=NULL WHERE field_set_id=100 AND column_uid=3`); err != nil {
		t.Fatal(err)
	}
	id, err = saveArticleProjection(tx, 10, "article_view", nil, nil, 0, nil, "", 73, int64(100))
	if err != nil {
		t.Fatal(err)
	}
	if got := articleBundleText(t, tx, `SELECT (presentation_values->'article_view'->'width_px')::text FROM system_column_field_set_members WHERE field_set_id=$1 AND column_uid=3`, id); got != "null" {
		t.Fatal("automatic width inherited", got)
	}
	// An empty label edits this active bundle; a new label saves a distinct choice.
	if _, err := saveArticleProjection(tx, 10, "image_first_view", nil, nil, 0, []int{}, "", 73, nil); err != nil {
		t.Fatal(err)
	}
	if got := articleBundleText(t, tx, `SELECT count(*)::text FROM system_column_field_set_members WHERE field_set_id=$1 AND (presentation_values->'image_first_view'->>'visible')::boolean`, id); got != "0" {
		t.Fatal("empty projection", got)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestArticleBundleGenericValuesValidationPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	for _, expression := range []string{`'{}'::jsonb`, `'null'::jsonb`, `app_article_opener_defaults()-'card-body'`, `jsonb_set(app_article_opener_defaults(),'{card-body}','null')`} {
		if got := articleBundleText(t, db, `SELECT app_valid_article_opener_policy(`+expression+`)::text`); got != "false" {
			t.Fatal("invalid opener policy must return false, never SQL NULL", expression, got)
		}
		if _, err := db.Exec(`SELECT app_save_article_opener_policy(10,` + expression + `)`); err == nil {
			t.Fatal("service accepted invalid opener policy", expression)
		}
	}
	for _, expression := range []string{
		`NULL`, `'{}'::jsonb`, `app_article_values(true)-'article_view'`,
		`jsonb_set(app_article_values(true),'{article_view,visible}','null')`,
		`jsonb_set(app_article_values(true),'{article_view,width_px}','-1')`,
		`jsonb_set(app_article_values(true),'{article_view,width_px}','1.5')`,
		`jsonb_set(app_article_values(true),'{article_view,width_px}','"inherit"')`,
		`jsonb_set(app_article_values(true),'{article_view}', '{"visible":true}')`,
		`app_article_values(true)||'{"unknown":{}}'::jsonb`,
	} {
		if _, err := db.Exec(`UPDATE system_column_field_set_members SET presentation_values=` + expression + ` WHERE field_set_id=(SELECT field_set_id FROM system_view_field_set_assignments WHERE table_uid=10 AND user_id IS NULL AND group_id IS NULL AND view_id=1)`); err == nil {
			t.Fatal("invalid explicit values accepted", expression)
		}
	}
	for _, statement := range []string{
		`UPDATE system_view_field_set_assignments SET field_set_id=100 WHERE table_uid=10 AND user_id IS NULL AND group_id IS NULL AND view_id=1`,
		`UPDATE system_view_field_set_assignments SET field_set_id=(SELECT field_set_id FROM system_view_field_set_assignments WHERE table_uid=10 AND user_id IS NULL AND group_id IS NULL AND view_id=1) WHERE user_id=42`,
		`UPDATE system_db_tables SET article_section_initial_open='{}' WHERE table_uid=10`,
		`UPDATE system_db_tables SET article_opener_policy=jsonb_set(article_opener_policy,'{card-body}','null') WHERE table_uid=10`,
	} {
		if _, err := db.Exec(statement); err == nil {
			t.Fatal("generic family/target/section/policy bypass", statement)
		}
	}
}

func TestArticleBundleReplayRevocationPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE user_group_id=8 AND function_id=(SELECT id FROM system_functions WHERE name='ui.view.image_first_view')`)
	before := articleBundleText(t, db, `SELECT jsonb_agg(to_jsonb(m) ORDER BY field_set_id,sort_order)::text FROM system_column_field_set_members m`)
	for _, name := range articleBundleMigrations {
		frontPageExec(t, db, articleBundleSQL(t, name))
	}
	if after := articleBundleText(t, db, `SELECT jsonb_agg(to_jsonb(m) ORDER BY field_set_id,sort_order)::text FROM system_column_field_set_members m`); before != after {
		t.Fatal("replay recopied settings")
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights WHERE user_group_id=8 AND function_id=(SELECT id FROM system_functions WHERE name='ui.view.image_first_view')`); got != 0 {
		t.Fatal("revoked audience resurrected")
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='article_bundle_materialization' AND action='completed'`); got != 1 {
		t.Fatal("durable marker", got)
	}
}

func TestArticleBundleAudienceScopesPreservedPostgres(t *testing.T) {
	db := articleBundleFixture(t, false)
	frontPageExec(t, db, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_schema_name,target_table_uid,creation_spec)
	 VALUES(9,1,NULL,NULL,'Global Article'),(9,2,'public',NULL,'Different authored IFAV scope');`)
	frontPageExec(t, db, articleBundleSQL(t, articleBundleMigrations[2]))
	for _, name := range []string{"ui.view.image_first_view", "ui.view.image_first_page_view"} {
		if got := articleBundleText(t, db, `SELECT count(*)::text FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id
		 WHERE f.name=$1 AND r.user_group_id=9 AND r.target_table_uid IS NULL`, name); got != "2" {
			t.Fatal("nullable scopes flattened", name, got)
		}
	}
}

func TestArticleBundleActualRouteAudiencePostgres(t *testing.T) {
	db := articleBundleFixture(t, false)
	frontPageExec(t, db, `INSERT INTO system_functions(name,url_route_endpoint,disabled)
	 VALUES('authored_article_alias','/ui/view/article_view',false),('disabled_article_alias','/ui/view/article_view',true);
	 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
	 SELECT CASE WHEN disabled THEN 9 ELSE 8 END,id,11 FROM system_functions WHERE name LIKE '%article_alias';
	 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_schema_name) VALUES(3,1,NULL);`)
	frontPageExec(t, db, articleBundleSQL(t, articleBundleMigrations[2]))
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id
	 WHERE f.name IN('ui.view.image_first_view','ui.view.image_first_page_view') AND r.target_table_uid=11 AND r.user_group_id=8`); got != 2 {
		t.Fatal("actual enabled alias audience lost", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id
	 WHERE f.name IN('ui.view.image_first_view','ui.view.image_first_page_view') AND r.target_table_uid=11 AND r.user_group_id=9`); got != 0 {
		t.Fatal("disabled source became a new audience", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id
	 WHERE f.name IN('ui.view.image_first_view','ui.view.image_first_page_view') AND r.user_group_id=3`); got != 2 {
		t.Fatal("existing Article guest audience was lost", got)
	}
	frontPageExec(t, db, `DELETE FROM system_group_table_func_rights WHERE user_group_id=3 AND function_id=(SELECT id FROM system_functions WHERE name='ui.view.image_first_view')`)
	frontPageExec(t, db, articleBundleSQL(t, articleBundleMigrations[2]))
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights r JOIN system_functions f ON f.id=r.function_id WHERE f.name='ui.view.image_first_view' AND r.user_group_id=3`); got != 0 {
		t.Fatal("revoked guest grant resurrected", got)
	}
}

func TestArticleBundleLimitedWriterPostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	frontPageExec(t, db, `CREATE ROLE article_bundle_writer;
	 GRANT SELECT ON system_db_tables,system_column_details,system_table_views,system_column_field_sets,system_column_field_set_members,system_view_field_set_assignments TO article_bundle_writer;
	 GRANT INSERT,UPDATE,DELETE ON system_column_field_sets,system_column_field_set_members,system_view_field_set_assignments TO article_bundle_writer;
	 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO article_bundle_writer;`)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`SET LOCAL ROLE article_bundle_writer`); err != nil {
		t.Fatal(err)
	}
	if _, err := saveArticleProjection(tx, 10, "article_view", int64(42), nil, 0, []int{1}, "Personal", 42, nil); err != nil {
		t.Fatal("preference writer must need neither registry UPDATE nor repair-record SELECT", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestArticleBundleConflictingLegacyAtomicPostgres(t *testing.T) {
	for _, conflict := range []string{
		`UPDATE system_column_field_set_members SET sort_order=sort_order+100 WHERE field_set_id=102; UPDATE system_column_field_set_members SET sort_order=CASE column_uid WHEN 1 THEN 1 WHEN 3 THEN 2 ELSE 3 END WHERE field_set_id=102`,
		`UPDATE system_view_field_set_assignments SET group_priority=9 WHERE view_id=3`,
		`UPDATE system_db_tables SET article_section_initial_open='{"image_first":{"details":null}}' WHERE table_uid=10`,
	} {
		db := articleBundleFixture(t, false)
		frontPageExec(t, db, conflict)
		before := articleBundleText(t, db, `SELECT jsonb_agg(to_jsonb(a) ORDER BY id)::text FROM system_view_field_set_assignments a`)
		if _, err := db.Exec(articleBundleSQL(t, articleBundleMigrations[2])); err == nil {
			t.Fatal("conflict accepted", conflict)
		}
		if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_sets WHERE article_family`); got != 0 {
			t.Fatal("partial materialization", got)
		}
		if got := frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='article_bundle_materialization'`); got != 0 {
			t.Fatal("failed migration marked complete")
		}
		if after := articleBundleText(t, db, `SELECT jsonb_agg(to_jsonb(a) ORDER BY id)::text FROM system_view_field_set_assignments a`); before != after {
			t.Fatal("failed migration changed assignments")
		}
		if got := frontPageCount(t, db, `SELECT count(*) FROM system_group_table_func_rights`); got != 3 {
			t.Fatal("failed migration changed grants", got)
		}
	}
}
