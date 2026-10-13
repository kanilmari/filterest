// related_pool_starvation_postgres_test.go
// Runs the saturated-pool HTTP and request-enrichment regressions on PostgreSQL.
// Extends the existing disposable owner/reader harness with a real gallery.
// Checks the same schema queries, response data and consistency as production.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	"easelect/backend/core_components/dataset_kinds"
	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

const relatedPoolPostgresFixture = `
ALTER TABLE system_db_tables ADD COLUMN multi_lang_embeddings boolean DEFAULT false,
 ADD COLUMN fk_display_column text, ADD COLUMN ui_hidden boolean DEFAULT false;
ALTER TABLE system_column_details ADD COLUMN card_element text,
 ADD COLUMN show_key_on_card boolean, ADD COLUMN show_value_on_card boolean DEFAULT false,
 ADD COLUMN hide_in_filter_panel boolean DEFAULT false, ADD COLUMN hide_everywhere boolean DEFAULT false,
 ADD COLUMN hide_on_small_card boolean DEFAULT false, ADD COLUMN hide_false_null_on_sml_crd boolean DEFAULT false,
 ADD COLUMN hide_false_null_on_big_crd boolean DEFAULT false, ADD COLUMN hide_on_bg_crd_if_not_own boolean DEFAULT false,
 ADD COLUMN co_number integer DEFAULT 0, ADD COLUMN fco_number integer DEFAULT 0,
 ADD COLUMN is_multilingual boolean DEFAULT false, ADD COLUMN editable_in_ui boolean DEFAULT false,
 ADD COLUMN client_delivery_mode text DEFAULT 'include';
CREATE TABLE system_row_actor_columns(table_uid bigint, column_name text, actor_role text);
CREATE TABLE system_functions(id integer PRIMARY KEY, url_route_endpoint text, disabled boolean DEFAULT false);
CREATE TABLE system_group_table_func_rights(user_group_id bigint, function_id integer, target_table_uid bigint);
CREATE TABLE system_foreign_key_relations_1_m(id integer PRIMARY KEY, source_table_uid bigint,
 target_table_uid bigint, source_column_name text, target_insert_specs jsonb);
CREATE TABLE system_config(key text PRIMARY KEY, json_value jsonb, updated timestamptz);
CREATE TABLE system_dataset_appearance(table_uid bigint PRIMARY KEY, schema_version integer,
 tab_values jsonb, overrides jsonb, revision bigint);
CREATE TABLE parent_rows(id bigint PRIMARY KEY, title text, cached_image text);
CREATE TABLE parent_rows_assets(id bigint PRIMARY KEY, parent_rows_id bigint REFERENCES parent_rows(id),
 filename text, asset_kind text, is_primary boolean, sort_order integer);
CREATE TABLE parent_rows_notes(id bigint PRIMARY KEY, parent_rows_id bigint REFERENCES parent_rows(id), title text);
INSERT INTO system_db_tables(table_uid,table_name) VALUES
 (20,'parent_rows'),(21,'parent_rows_notes'),(22,'parent_rows_assets');
INSERT INTO parent_rows VALUES(7,'Parent','own.png');
INSERT INTO parent_rows_assets VALUES(1,7,'own.png','image',true,0),(2,7,'file.pdf','attachment',false,1);
INSERT INTO parent_rows_notes VALUES(9,7,'Note');
INSERT INTO system_foreign_key_relations_1_m VALUES
 (1,22,20,'parent_rows_id','{"file_upload":{"filename_column":"filename","profiles":{"image":{},"attachment":{}}}}');
INSERT INTO system_functions VALUES(1,'/api/fetch-dynamic-children',false),(2,'/api/get-results',false);
INSERT INTO system_user_group_memberships VALUES(42,1);
INSERT INTO system_group_table_func_rights
 SELECT 1,function_id,table_uid FROM (VALUES(1),(2)) f(function_id) CROSS JOIN (VALUES(20),(21),(22)) d(table_uid);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;
`

func relatedPoolPostgresConnector(t *testing.T) driver.Connector {
	t.Helper()
	owner, _ := ownerResolverPostgres(t)
	if _, err := owner.Exec(relatedPoolPostgresFixture); err != nil {
		t.Fatal("load gallery fixture", err)
	}
	loadRelatedPoolFunction(t, owner, "20261005000002_key_row_actor_marks_by_table_uid.sql", "app_row_actor_column", "$$")
	loadRelatedPoolFunction(t, owner, "20260914000005_inherit_card_field_labels.sql", "resolve_card_label_visibility", "$policy$")
	var socket, port string
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	connector, err := pq.NewConnector(fmt.Sprintf("host=%s port=%s user=test_owner dbname=postgres sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	return connector
}

// Load the canonical definitions, rather than fake the metadata functions that
// the endpoint calls inside its snapshot. No installed application is touched.
func loadRelatedPoolFunction(t *testing.T, db *sql.DB, migration, name, delimiter string) {
	t.Helper()
	source, err := os.ReadFile("../../../../../server_tools/migrations/" + migration)
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "CREATE OR REPLACE FUNCTION public."+name+"(")
	if start < 0 {
		t.Fatal("function missing from migration", name)
	}
	opening := strings.Index(text[start:], "AS "+delimiter)
	if opening < 0 {
		t.Fatal("function body missing", name)
	}
	body := start + opening + len("AS "+delimiter)
	closing := strings.Index(text[body:], delimiter+";")
	if closing < 0 {
		t.Fatal("function body unterminated", name)
	}
	if _, err := db.Exec(text[start : body+closing+len(delimiter+";")]); err != nil {
		t.Fatal("load function", name, err)
	}
}

func TestRelatedReadsCompleteWithSaturatedPoolPostgres(t *testing.T) {
	runRelatedPoolProof(t, relatedPoolPostgresConnector(t))
}

func TestKindCapabilitiesReuseSaturatedRequestTransactionsPostgres(t *testing.T) {
	connector := relatedPoolPostgresConnector(t)
	runRequestKindPoolProof(t, connector)
	t.Run("reader_snapshot_data", func(t *testing.T) {
		owner := sql.OpenDB(connector)
		t.Cleanup(func() { _ = owner.Close() })
		ctx := context.Background()
		want, err := dataset_kinds.ReadForName(ctx, owner, "parent_rows_assets")
		if err != nil {
			t.Fatal(err)
		}
		var socket, port string
		if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
			t.Fatal(err)
		}
		reader, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=wl58_reader dbname=postgres sslmode=disable", socket, port))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = reader.Close() })
		tx, err := reader.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		requestContext := dbutils.SetTx(ctx, tx)
		got := readDatasetKindCapabilities(requestContext, "parent_rows_assets")
		if got == nil || !reflect.DeepEqual(*got, want) {
			t.Fatalf("reader transaction changed capabilities: got=%+v want=%+v", got, want)
		}
		results := []RelatedTableResult{{DatasetUID: 22}}
		populateRelatedKindCapabilities(requestContext, results)
		if results[0].KindCapabilities == nil || !reflect.DeepEqual(*results[0].KindCapabilities, want) {
			t.Fatal("related reader transaction changed capabilities", results)
		}
	})
}

// galleryEditConnector commits an edit after PostgreSQL has selected the
// gallery rows, before the actual handler reads the parent's shown picture.
type galleryEditConnector struct {
	driver.Connector
	afterGalleryRead func()
}

func (c galleryEditConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return galleryEditConn{Conn: conn, afterGalleryRead: c.afterGalleryRead}, nil
}

type galleryEditConn struct {
	driver.Conn
	afterGalleryRead func()
}

func (c galleryEditConn) BeginTx(ctx context.Context, options driver.TxOptions) (driver.Tx, error) {
	return c.Conn.(driver.ConnBeginTx).BeginTx(ctx, options)
}

func (c galleryEditConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rows, err := c.Conn.(driver.QueryerContext).QueryContext(ctx, query, args)
	if err == nil && strings.Contains(query, `FROM "parent_rows_assets"`) {
		c.afterGalleryRead()
	}
	return rows, err
}

func TestRelatedGallerySnapshotKeepsPictureConsistentPostgres(t *testing.T) {
	connector := relatedPoolPostgresConnector(t)
	writer := sql.OpenDB(connector)
	t.Cleanup(func() { _ = writer.Close() })
	var edit sync.Once
	var editErr error
	mutating := galleryEditConnector{Connector: connector, afterGalleryRead: func() {
		edit.Do(func() {
			_, editErr = writer.Exec(`BEGIN; DELETE FROM parent_rows_assets WHERE id=1; UPDATE parent_rows SET cached_image='' WHERE id=7; COMMIT;`)
		})
	}}
	db, _ := installRelatedPool(t, mutating)
	r := httptest.NewRequest("POST", "/api/fetch-dynamic-children?dataset=parent_rows", strings.NewReader(`{"parent_dataset":"parent_rows","parent_pk_value":"7"}`))
	r = r.WithContext(dbutils.SetRequestActorContext(r.Context(), dbutils.NewRequestActorContext(42, "admin")))
	w := httptest.NewRecorder()
	GetDynamicRelatedItemsHandler(w, r)
	if editErr != nil || w.Code != 200 {
		t.Fatalf("gallery edit=%v status=%d body=%s", editErr, w.Code, w.Body)
	}
	var response struct {
		Picture  string               `json:"card_picture"`
		Children []RelatedTableResult `json:"child_tables"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Picture != "own.png" {
		t.Fatalf("picture escaped the gallery snapshot: %s", w.Body)
	}
	found := false
	for _, child := range response.Children {
		if child.Table_name == "parent_rows_assets" {
			for _, row := range child.Rows {
				found = found || row["filename"] == response.Picture
			}
		}
	}
	if !found {
		t.Fatalf("shown picture missing from snapshot gallery: %s", w.Body)
	}
	var livePicture string
	if err := db.QueryRow(`SELECT cached_image FROM parent_rows WHERE id=7`).Scan(&livePicture); err != nil || livePicture != "" {
		t.Fatalf("concurrent edit did not commit: live picture=%q error=%v", livePicture, err)
	}
}
