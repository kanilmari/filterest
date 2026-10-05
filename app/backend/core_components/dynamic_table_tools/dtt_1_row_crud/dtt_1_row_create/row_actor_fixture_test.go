// row_actor_fixture_test.go
// Adds the actor registry contract to the hand-built PostgreSQL fixtures.
// Uses the shipped marks reader so fixture queries follow the production function.
// Keeps the replay and account-reference tests aligned with the table_uid schema.
package dtt_1_row_create

import (
	"database/sql"
	"os"
	"strings"
	"testing"
)

func loadRowActorFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE public.system_row_actor_columns (
		table_uid integer NOT NULL REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
		actor_role text NOT NULL CHECK (actor_role IN ('creator', 'owner')),
		column_name text NOT NULL,
		marked_at timestamptz NOT NULL DEFAULT now(),
		PRIMARY KEY (table_uid, actor_role)
	)`); err != nil {
		t.Fatalf("load actor registry: %v", err)
	}
	migration, err := os.ReadFile("../../../../../server_tools/migrations/20261005000002_key_row_actor_marks_by_table_uid.sql")
	if err != nil {
		t.Fatal(err)
	}
	source := string(migration)
	start := strings.Index(source, "CREATE OR REPLACE FUNCTION public.app_row_actor_column(")
	if start < 0 {
		t.Fatal("actor reader definition not found in its migration")
	}
	end := strings.Index(source[start:], "$$;")
	if end < 0 {
		t.Fatal("actor reader definition is incomplete")
	}
	if _, err := db.Exec(source[start : start+end+len("$$;")]); err != nil {
		t.Fatalf("load actor reader: %v", err)
	}
}
