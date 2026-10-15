// article_baseline_fixture_test.go
// Builds an opt-in Unix-socket-only PostgreSQL fixture for compatibility evidence.
// Connects current settings tables and limited SELECT readers without installation state.
// Cleanup stops the cluster and removes all disposable data, including after failures.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func articleBaselinePostgres(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL baseline proofs")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", name, err, output)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		if output, err := exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput(); err != nil {
			t.Errorf("stop disposable PostgreSQL: %v: %s", err, output)
		}
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15487", "-w", "start")
	open := func(user, database string) *sql.DB {
		t.Helper()
		db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=15487 user=%s dbname=%s sslmode=disable", socket, user, database))
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { db.Close() })
		return db
	}
	owner := open("fixture_owner", "postgres")
	baselineExec(t, owner, articleBaselineFixture)
	baselineExec(t, owner, `CREATE ROLE baseline_reader LOGIN NOSUPERUSER; GRANT USAGE ON SCHEMA public TO baseline_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO baseline_reader;`)
	reader := open("baseline_reader", "postgres")
	baselineExec(t, owner, `CREATE DATABASE baseline_other;`)
	other := open("fixture_owner", "baseline_other")
	baselineExec(t, other, articleBaselineFixture)
	baselineExec(t, other, `UPDATE system_column_field_set_members SET column_width_px=444 WHERE field_set_id=104;`)
	return reader, other
}
func baselineExec(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	if _, err := db.Exec(query); err != nil {
		t.Fatalf("fixture SQL: %v", err)
	}
}

// The shape retains real principal, UID, ordering and assignment constraints.
// Only tables read by the tool are present; no migration or production bootstrap runs.
const articleBaselineFixture = `
CREATE TABLE system_users(id bigint PRIMARY KEY);
CREATE TABLE system_user_groups(id bigint PRIMARY KEY,name text NOT NULL);
CREATE TABLE system_user_group_memberships(user_id bigint REFERENCES system_users,group_id bigint REFERENCES system_user_groups,PRIMARY KEY(user_id,group_id));
CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY,table_name text NOT NULL,schema_name text,article_section_initial_open jsonb);
CREATE TABLE system_table_views(id integer PRIMARY KEY,view_key text UNIQUE NOT NULL);
CREATE TABLE system_column_details(column_uid integer PRIMARY KEY,table_uid integer REFERENCES system_db_tables,column_name text NOT NULL,
    co_number integer,card_element text,hide_everywhere boolean,client_delivery_mode text,hide_on_small_card boolean,
    hide_on_bg_crd_if_not_own boolean,hide_false_null_on_big_crd boolean,UNIQUE(table_uid,column_name));
CREATE TABLE system_column_field_sets(id bigint PRIMARY KEY,table_uid integer REFERENCES system_db_tables);
CREATE TABLE system_column_field_set_members(field_set_id bigint REFERENCES system_column_field_sets,column_uid integer REFERENCES system_column_details,
    sort_order integer NOT NULL,column_width_px integer,PRIMARY KEY(field_set_id,column_uid),UNIQUE(field_set_id,sort_order));
CREATE TABLE system_view_field_set_assignments(id bigint PRIMARY KEY,user_id bigint REFERENCES system_users,group_id bigint REFERENCES system_user_groups,
    table_uid integer REFERENCES system_db_tables,view_id integer REFERENCES system_table_views,field_set_id bigint REFERENCES system_column_field_sets,
    group_priority integer NOT NULL DEFAULT 0,UNIQUE NULLS NOT DISTINCT(user_id,group_id,table_uid,view_id),
    CHECK(user_id IS NULL OR (user_id<>1 AND group_id IS NULL)));
CREATE TABLE system_functions(id bigint PRIMARY KEY,url_route_endpoint text,disabled boolean,specific_table_related boolean);
CREATE TABLE system_group_table_func_rights(id bigint PRIMARY KEY,user_group_id bigint REFERENCES system_user_groups,
    function_id bigint REFERENCES system_functions,target_schema_name text,target_table_uid integer);
CREATE TABLE articles(id integer,title text,body text,picture text,extra text);
CREATE TABLE metadata_only(id integer,title text,body text,extra text,hidden text,server_only text);
CREATE TABLE metadata_gap(id integer,label text);
INSERT INTO system_users VALUES(1),(2),(3),(4),(5);
INSERT INTO system_user_groups VALUES(1,'admins'),(2,'guests'),(10,'ten'),(11,'eleven'),(12,'twelve');
-- Guest account membership intentionally disagrees with the named guests group.
INSERT INTO system_user_group_memberships VALUES(1,10),(2,10),(2,11),(3,10),(3,11),(4,10),(4,12);
INSERT INTO system_db_tables VALUES
    (10,'articles','public','{"classic":{"details":false},"image_first":{"details":false}}'),
    (20,'metadata_only','public','{}'),(30,'metadata_gap','public','{"classic":{"details":null}}');
INSERT INTO system_table_views VALUES(1,'article_view'),(2,'card'),(3,'image_first_view'),(4,'table'),(5,'big_card');
INSERT INTO system_column_details(column_uid,table_uid,column_name,co_number,card_element) VALUES
    (101,10,'id',1,'hidden'),(102,10,'title',4,'header'),(103,10,'body',2,'description2'),(104,10,'picture',3,'image'),(105,10,'extra',5,'details1'),
    (201,20,'id',3,'hidden'),(202,20,'title',NULL,'header'),(203,20,'body',1,'description'),(204,20,'extra',1,'details'),
    (205,20,'hidden',4,'details'),(206,20,'server_only',5,'details');
UPDATE system_column_details SET hide_on_small_card=true,hide_on_bg_crd_if_not_own=true WHERE column_uid=204;
UPDATE system_column_details SET hide_everywhere=true WHERE column_uid=205;
UPDATE system_column_details SET client_delivery_mode='exclude' WHERE column_uid=206;
INSERT INTO system_column_field_sets VALUES(100,10),(101,10),(102,10),(103,10),(104,10),(200,10),(300,10);
INSERT INTO system_column_field_set_members VALUES
    (100,102,1,NULL),(100,103,2,0),(101,103,1,180),(101,102,2,NULL),(102,102,1,80),
    (103,104,1,200),(104,103,1,0),(200,102,1,90),(200,104,2,NULL),(300,105,1,40);
INSERT INTO system_view_field_set_assignments VALUES
    (1,NULL,NULL,10,1,100,0),(2,NULL,10,10,1,102,4),(3,NULL,11,10,1,101,4),
    (4,NULL,12,10,1,103,9),(5,2,NULL,10,1,104,0),(6,NULL,NULL,10,2,200,0),(7,NULL,NULL,10,3,300,0);
INSERT INTO system_functions VALUES
    (1,'/ui/view/article_view',false,false),(2,'/ui/view/article_view',NULL,false),
    (3,'/ui/view/article_view',true,false),(4,'/ui/view/image_first_view',false,false);
INSERT INTO system_group_table_func_rights VALUES
    (1,2,1,NULL,NULL),(2,10,1,'public',10),(3,11,2,'public',NULL),(4,12,3,'public',NULL),(5,12,4,'public',NULL);
`
