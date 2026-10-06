// front_page_security_postgres_test.go
// Proves gallery isolation and protected revision lifecycles on disposable PostgreSQL.
// Connects actual column grants, canonical reads and concurrent account deletion.
// Reuses the front page bootstrap fixture; never connects to an installation database.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"github.com/lib/pq"
)

func frontPageRuntimeDB(t *testing.T, db *sql.DB) *sql.DB {
	t.Helper()
	frontPageExec(t, db, `CREATE ROLE front_page_runtime LOGIN;
        GRANT USAGE ON SCHEMA public TO front_page_runtime;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO front_page_runtime;
        REVOKE ALL ON system_front_page_revisions FROM front_page_runtime;`)
	var socket, port string
	if err := db.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	roleDB, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=front_page_runtime dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { roleDB.Close() })
	backend.DbBasic, backend.DbGuest = roleDB, roleDB
	return roleDB
}

func TestFrontPagePostgresTextBlocksNeverReadDeniedHiddenOrRowDeniedGallery(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `CREATE TABLE wl143_media(id bigint PRIMARY KEY,title text,cached_image text);
        CREATE TABLE wl143_media_assets(id bigint PRIMARY KEY,parent_id bigint REFERENCES wl143_media(id),
            asset_kind text,filename text,title text,original_name text,metadata_json jsonb);
        INSERT INTO wl143_media VALUES(1,'Readable text',NULL);
        INSERT INTO wl143_media_assets VALUES(1,1,'image','private-picture.webp','private gallery title',
            'private-original.webp','{"private_metadata":"gallery secret"}');
        INSERT INTO system_db_tables(table_name,schema_name,folder_id) VALUES('wl143_media','public',1),('wl143_media_assets','public',1);
        INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,card_element,hide_everywhere)
            SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,
                CASE col.column_name WHEN 'title' THEN 'header' WHEN 'cached_image' THEN 'image' ELSE '' END,
                col.column_name='cached_image'
            FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
            WHERE col.table_schema='public' AND col.table_name IN ('wl143_media','wl143_media_assets');
        INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name,target_insert_specs)
            SELECT src.table_uid,tgt.table_uid,'parent_id','id',
                '{"file_upload":{"profile_key":"asset_linking","profiles":{"image":{"asset_kinds":["image"]}}}}'::jsonb
            FROM system_db_tables src CROSS JOIN system_db_tables tgt
            WHERE src.table_name='wl143_media_assets' AND tgt.table_name='wl143_media';
        INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
            SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name='wl143_media';`)
	roleDB := frontPageRuntimeDB(t, db)
	frontPageExec(t, db, `REVOKE SELECT ON wl143_media_assets FROM front_page_runtime`)
	read.InvalidateSchemaCache("wl143_media")
	read.InvalidatePermissionsCache("wl143_media")
	read.InvalidateUserColumnSettingsCache("wl143_media", "card")
	for _, mode := range []string{"denied gallery", "hidden gallery", "denied child row", "denied image column"} {
		t.Run(mode, func(t *testing.T) {
			switch mode {
			case "hidden gallery":
				frontPageExec(t, db, `GRANT SELECT ON wl143_media_assets TO front_page_runtime;
                    UPDATE system_db_tables SET ui_hidden=true WHERE table_name='wl143_media_assets'`)
			case "denied child row":
				frontPageExec(t, db, `UPDATE system_db_tables SET ui_hidden=false WHERE table_name='wl143_media_assets';
                    ALTER TABLE wl143_media_assets ENABLE ROW LEVEL SECURITY;
                    CREATE POLICY no_gallery_rows ON wl143_media_assets FOR SELECT USING(false)`)
			case "denied image column":
				frontPageExec(t, db, `REVOKE SELECT ON wl143_media FROM front_page_runtime;
                    GRANT SELECT(id,title) ON wl143_media TO front_page_runtime`)
				read.InvalidatePermissionsCache("wl143_media")
			}
			lazy := dbutils.NewLazyTxWithBeginHook(roleDB, func(tx *sql.Tx) error {
				return dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(42, "basic"))
			})
			defer lazy.Rollback()
			request := frontPageSessionRequest(t, 42, "basic", "GET", "/api/front-page").WithContext(dbutils.SetLazyTx(context.Background(), lazy))
			result, ok := delegateFrontPageBlock(request, frontPageBlock{Dataset: "wl143_media", ResultLimit: 5, Enabled: true})
			if !ok || len(result.Data) != 1 {
				t.Fatal("readable text block disappeared", result, ok)
			}
			var row map[string]any
			if err := json.Unmarshal(result.Data[0], &row); err != nil {
				t.Fatal(err)
			}
			if row["title"] != "Readable text" {
				t.Fatal(row)
			}
			// Only text and its transport ID can leave the facade; this catches
			// filenames, titles, original names and every image companion value.
			if len(row) != 2 || row["id"] != float64(1) {
				t.Fatal("gallery information leaked", row)
			}
		})
	}
}

func TestFrontPagePostgresRevisionsStayOutOfSettingsAndCascadeAfterSavedOrResetAccount(t *testing.T) {
	db := frontPageDisposableDB(t)
	inputs := []frontPageBlockInput{{Dataset: "wl143_content", ResultLimit: 5, SortOrder: 1, Enabled: true}}
	reset := true
	for _, user := range []int{42, 73} {
		version, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: "none", Blocks: &inputs})
		if err != nil {
			t.Fatal(err)
		}
		if user == 73 {
			version, err = frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: version, Reset: &reset})
			if err != nil {
				t.Fatal(err)
			}
		}
		if frontPageCount(t, db, `SELECT count(*) FROM system_config WHERE left(key,25)='front_page_scope_version:'`) != 0 {
			t.Fatal("revision became a setting")
		}
		result, ok := delegateFrontPageBlock(frontPageSessionRequest(t, 42, "admin", "GET", "/api/front-page"), frontPageBlock{Dataset: "system_config", ResultLimit: 20})
		if !ok {
			t.Fatal("settings read failed")
		}
		payload, _ := json.Marshal(result)
		if strings.Contains(string(payload), version) || strings.Contains(string(payload), "front_page_scope_version:") {
			t.Fatal("settings listed editor revision", string(payload))
		}
		frontPageExec(t, db, fmt.Sprintf(`DELETE FROM system_users WHERE id=%d`, user))
		if frontPageCount(t, db, fmt.Sprintf(`SELECT count(*) FROM system_front_page_revisions WHERE user_id=%d`, user)) != 0 {
			t.Fatal("revision outlived account")
		}
		if frontPageCount(t, db, fmt.Sprintf(`SELECT count(*) FROM system_front_page_blocks WHERE user_id=%d`, user)) != 0 {
			t.Fatal("list outlived account")
		}
		if _, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: version, Reset: &reset}); !errors.Is(err, errFrontPageInput) {
			t.Fatal("deleted-account reset accepted", err)
		}
		// Even if an operator deliberately reuses the ID, an old reset is stale.
		frontPageExec(t, db, fmt.Sprintf(`INSERT INTO system_users(id,username,enabled) VALUES(%d,'Recreated fixture account %d',true)`, user, user))
		if _, err := frontPageTestSave(db, frontPageAdminRequest{UserID: &user, Version: version, Reset: &reset}); !errors.Is(err, errFrontPageConflict) {
			t.Fatal("reset crossed account deletion", err)
		}
	}
}

func TestFrontPagePostgresSavingLocksAccountUntilDeletionCanCascade(t *testing.T) {
	db := frontPageDisposableDB(t)
	user, reset := 42, true
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	if _, err := saveFrontPageAdminRequest(dbutils.SetLazyTx(context.Background(), lazy), frontPageAdminRequest{UserID: &user, Version: "none", Reset: &reset}); err != nil {
		t.Fatal(err)
	}
	deleting, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer deleting.Rollback()
	if _, err := deleting.Exec(`SET LOCAL lock_timeout='100ms'`); err != nil {
		t.Fatal(err)
	}
	_, err = deleting.Exec(`DELETE FROM system_users WHERE id=42`)
	var pgError *pq.Error
	if !errors.As(err, &pgError) || pgError.Code != "55P03" {
		t.Fatal("save did not hold account existence", err)
	}
	if err := deleting.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, `DELETE FROM system_users WHERE id=42`)
	if frontPageCount(t, db, `SELECT count(*) FROM system_front_page_revisions WHERE user_id=42`) != 0 {
		t.Fatal("concurrent deletion left orphan revision")
	}
}
