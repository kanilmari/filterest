// composite.go
// Shares the multi-column FK fixture and exact lock proof between row writers.
// Uses an opt-in disposable cluster and the production row-policy resolver.
// Never reads installation settings; cluster cleanup removes every fixture.
package referencetest

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/lib/pq"
)

// CompositeFixture creates the gate's two targets with a shared x component,
// hidden row 2, and source 41's incomplete (NULL,'B') key.
func CompositeFixture(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL verification")
	}
	owner, dsn := cluster(t)
	execSQL(t, owner, compositeFixture)
	reader, err := sql.Open("postgres", dsn+" user=reference_reader")
	if err != nil {
		t.Fatal(err)
	}
	reader.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = reader.Close() })
	return owner, reader
}

// AssertCompositeLocks uses a second connection while the writer still holds
// (101,'B'). Row 1 must be freely update-lockable and row 2 must be protected.
func AssertCompositeLocks(t *testing.T, owner *sql.DB) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, id := range []int{1, 2} {
		tx, err := owner.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.ExecContext(ctx, `SELECT id FROM composite_targets WHERE id=$1 FOR UPDATE NOWAIT`, id)
		_ = tx.Rollback()
		if id == 1 {
			if err != nil {
				t.Fatalf("unrelated row 1 was locked: %v", err)
			}
			continue
		}
		var pgErr *pq.Error
		if !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
			t.Fatalf("referenced row 2 lock: %v; want lock_not_available", err)
		}
	}
}

const compositeFixture = `
ALTER TABLE system_column_details
 ADD COLUMN hide_everywhere boolean DEFAULT false,
 ADD COLUMN client_delivery_mode text DEFAULT 'include',
 ADD COLUMN co_number integer,
 ADD COLUMN insertable boolean DEFAULT true,
 ADD COLUMN is_multilingual boolean DEFAULT false;
CREATE TABLE system_languages(language_code text,english_name text,native_name text,is_default boolean,sort_order integer,is_enabled boolean,public_selector_ready boolean,coverage_status text,review_status text);
CREATE TABLE system_foreign_key_relations_1_m(source_table_uid bigint,source_column_name text,insert_new_target_with_source boolean,insert_new_source_with_target boolean,source_insert_specs text,target_insert_specs text);
CREATE TABLE composite_targets(id integer PRIMARY KEY,x integer,y text,published boolean,UNIQUE(x,y));
CREATE TABLE composite_sources(id integer PRIMARY KEY,target_x integer,target_y text,
 FOREIGN KEY(target_x,target_y) REFERENCES composite_targets(x,y));
INSERT INTO composite_targets VALUES(1,101,'A',true),(2,101,'B',false);
INSERT INTO composite_sources VALUES(41,NULL,'B');
INSERT INTO system_db_tables(table_uid,table_name) VALUES(101,'composite_sources'),(102,'composite_targets');
INSERT INTO system_column_details(table_uid,column_name,must_be_true_unless_own) VALUES(102,'published',true);
INSERT INTO system_permission_actions VALUES(2,'update',true,'row');
CREATE ROLE reference_reader LOGIN NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO reference_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reference_reader;
GRANT INSERT,UPDATE ON composite_sources TO reference_reader;
GRANT UPDATE(id) ON composite_targets TO reference_reader;
`
