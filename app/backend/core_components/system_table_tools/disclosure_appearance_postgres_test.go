// disclosure_appearance_postgres_test.go
// Verifies the one-time closed-default cutover against the real historical migrations.
// Reuses isolated Unix-socket PostgreSQL and checks audit, replay and future inheritance.
// Does not contact installation databases or launch browsers.
package system_table_tools

import (
	"database/sql"
	store "easelect/backend/core_components/dataset_appearance_store"
	"encoding/json"
	"strings"
	"testing"
)

const disclosureAppearanceMigration = "20261106000100_move_disclosure_defaults_to_appearance.sql"

// The minimal authorization fixture needs only the actual rule/schema migrations.
// Bundle/editor and cutover proofs additionally run the complete new migration.
func installDisclosureAppearanceFixture(t *testing.T, db *sql.DB, cutover bool) {
	t.Helper()
	// sitePresentationDisposableDB already owns system_config for both callers.
	for _, name := range []string{datasetAppearanceMigration, datasetAppearanceSchemaMigration,
		"20261015000020_add_row_group_heading_order_appearance_field.sql"} {
		frontPageExec(t, db, articleBundleSQL(t, name))
	}
	source := articleBundleSQL(t, disclosureAppearanceMigration)
	if !cutover {
		source = strings.Split(source, "-- Complete derived article projection;")[0]
	}
	frontPageExec(t, db, source)
}

func TestDisclosureAppearanceClosedCutoverAuditReplayAndInheritancePostgres(t *testing.T) {
	db := articleBundleFixture(t, true)
	legacy := articleBundleText(t, db, `SELECT article_section_initial_open::text FROM system_db_tables WHERE table_uid=10`)
	installDisclosureAppearanceFixture(t, db, true)
	if n := frontPageCount(t, db, `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='system_db_tables' AND column_name='article_section_initial_open'`); n != 0 {
		t.Fatal("legacy owner survived", n)
	}
	audited := articleBundleText(t, db, `SELECT (detail->'values')::text FROM system_data_repair_records WHERE migration='disclosure_appearance_defaults' AND action='legacy_article_values' AND detail->>'dataset_uid'='10'`)
	if audited != legacy {
		t.Fatal("legacy evidence lost", audited, legacy)
	}
	var blocks map[string]map[string]bool
	raw := articleBundleText(t, db, `SELECT app_article_disclosure_defaults(10)::text`)
	if err := json.Unmarshal([]byte(raw), &blocks); err != nil {
		t.Fatal(err)
	}
	for presentation, values := range blocks {
		for block, open := range values {
			if open {
				t.Fatal("old open state survived cutover", presentation, block)
			}
		}
	}
	if len(blocks) != 3 || len(blocks["article_view"]) != 5 {
		t.Fatal("projection incomplete", blocks)
	}
	first, err := readArticleSectionAppearance(db, 10)
	if err != nil || len(first.Overrides) != 0 {
		t.Fatal("cutover must retain inheritance", first, err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = store.SaveDatasetAppearance(tx, 10, store.DatasetAppearancePatch{Set: map[string]any{"shared.article_view_details_initial_open": true}}, first.Version, first.SharedVersion, false); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, articleBundleSQL(t, disclosureAppearanceMigration))
	after, err := readArticleSectionAppearance(db, 10)
	if err != nil || !after.Effective.Shared.ArticleViewDetailsInitialOpen {
		t.Fatal("replay reset a new explicit admin choice", after, err)
	}
	if n := frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='disclosure_appearance_defaults' AND action='completed'`); n != 1 {
		t.Fatal("replay duplicated marker", n)
	}
	if n := frontPageCount(t, db, `SELECT count(*) FROM app_check_article_bundles()`); n != 0 {
		t.Fatal("cutover broke article invariants", n)
	}
	// Existing lifecycle triggers still create usable datasets after the column removal.
	frontPageExec(t, db, `INSERT INTO system_db_tables(table_uid,table_name,schema_name) VALUES(20,'new_after_disclosure_cutover','public')`)
	if value := articleBundleText(t, db, `SELECT app_article_disclosure_defaults(20)->'article_view'->>'details'`); value != "false" {
		t.Fatal("new dataset default", value)
	}
}
