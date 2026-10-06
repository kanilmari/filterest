// additive_account_trigger_postgres_test.go
// Reproduces successful HTTP mutations beside unknown cached-name propagation.
// Uses real creation, rights and gallery handlers on the disposable bootstrap.
// Declares the trigger's downstream targets so required grants cannot disappear.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"testing"

	backend "easelect/backend/core_components"
	assets "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	. "easelect/backend/core_components/runtime_grants"
)

func TestUnknownAccountCacheTriggerKeepsCreationRightsAndGalleryGrantsPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	// This unreviewed physical account trigger writes cached usernames into
	// every test content table. The registry hook declares those downstream
	// dependencies as each new dataset is registered, before its reconciliation.
	// Both unknown triggers predate the requests and lie outside their closures.
	FixtureExec(t, f.owner, `CREATE FUNCTION fix5_unknown_username_sync() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE target record;
 BEGIN
   FOR target IN SELECT d.schema_name,d.table_name FROM public.system_db_tables d
     WHERE d.table_name LIKE 'fix5_%' AND EXISTS(SELECT 1 FROM pg_attribute a
       WHERE a.attrelid=to_regclass(format('%I.%I',d.schema_name,d.table_name))
       AND a.attname='cached_username' AND NOT a.attisdropped)
   LOOP
     EXECUTE format('UPDATE %I.%I SET cached_username=$1 WHERE created_by=$2',target.schema_name,target.table_name)
       USING NEW.username,OLD.id;
   END LOOP;
   RETURN NULL;
 END $$;
 CREATE TRIGGER fix5_unknown_username AFTER UPDATE OF username ON system_users
 FOR EACH ROW EXECUTE FUNCTION fix5_unknown_username_sync();
 CREATE FUNCTION fix5_declare_cache_target() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
   IF NEW.table_name LIKE 'fix5_%' THEN
     INSERT INTO public.system_triggers(source_table,target_table,condition,action_values)
       VALUES('system_users',NEW.table_name,'false','{}');
   END IF;
   RETURN NEW;
 END $$;
 CREATE TRIGGER fix5_declare_cache AFTER INSERT ON system_db_tables
 FOR EACH ROW EXECUTE FUNCTION fix5_declare_cache_target()`)

	uid := f.create("fix5_read", `,{"name":"cached_username","data_type":"TEXT"}`)
	f.privilege("fix5_read", "", "SELECT", true)
	rows, err := f.basic.Query(`SELECT title FROM fix5_read`)
	if err != nil {
		t.Fatal("created users-readable dataset is unreadable", err)
	}
	rows.Close()
	f.excess("fix5_read")
	// Resolve the installation's route IDs, rather than assuming bootstrap IDs.
	var readID, addID int64
	if err := f.owner.QueryRow(`SELECT
 (SELECT id FROM system_functions WHERE url_route_endpoint='/api/get-results' AND (disabled=false OR disabled IS NULL)),
 (SELECT id FROM system_functions WHERE url_route_endpoint='/api/add-row-multipart' AND (disabled=false OR disabled IS NULL))`).Scan(&readID, &addID); err != nil {
		t.Fatal(err)
	}
	f.request(func(w http.ResponseWriter, r *http.Request) {
		r.URL.RawQuery = fmt.Sprintf("dataset_uid=%d", uid)
		backend.PermissionsHandler(w, r)
	}, fmt.Sprintf(`{"permissions":[{"user_group_id":2,"function_id":%d,"target_table_uid":%d},
 {"user_group_id":2,"function_id":%d,"target_table_uid":%d}]}`, readID, uid, addID, uid), http.StatusCreated)
	f.privilege("fix5_read", "", "INSERT", true)
	f.privilege("fix5_read", "", "DELETE", true)
	if _, err := f.basic.Exec(`INSERT INTO fix5_read(title) VALUES('limited write works')`); err != nil {
		t.Fatal("saved add right did not permit an actual insert", err)
	}

	f.create("fix5_asset", `,{"name":"cached_username","data_type":"TEXT"}`)
	f.privilege("fix5_asset", "", "INSERT", false)
	f.right("fix5_asset", "/api/add-row-multipart")
	f.excess("fix5_asset")
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"fix5_asset"}`, http.StatusCreated)
	f.privilege("fix5_asset", "", "INSERT", true)
	f.privilege("fix5_asset", "", "DELETE", true)
	f.privilege("fix5_asset_assets", "", "INSERT", true)
	f.excess("fix5_asset_assets")
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"fix5_asset"}`, http.StatusOK)
	f.privilege("fix5_asset_assets", "", "DELETE", true)

	// Confirm the proof exercised uncertainty propagation rather than merely
	// an unrelated trigger with no path to the application's requested tables.
	tx, err := f.owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshot, err := LoadMutationSnapshot(context.Background(), tx, f.roles)
	if err != nil {
		t.Fatal(err)
	}
	var accountOID int64
	for oid, object := range snapshot.Objects {
		if object.Schema == "public" && object.Name == "system_users" {
			accountOID = oid
		}
	}
	blocked, targets := false, map[string]bool{}
	for _, finding := range snapshot.Blockers {
		blocked = blocked || finding.Kind == "trigger" && finding.Object == snapshot.Objects[accountOID].Identifier()
	}
	for _, dep := range snapshot.Dependencies {
		if dep.SourceOID == accountOID {
			targets[snapshot.Objects[dep.TargetOID].Name] = true
		}
	}
	if !blocked || !targets["fix5_read"] || !targets["fix5_asset"] || !targets["fix5_asset_assets"] {
		t.Fatal("unknown account cache paths not reproduced", blocked, targets)
	}
}
