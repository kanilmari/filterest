// foreign_keys_test_helpers_test.go
// Holds the helper-heavy foreign-key tests that would otherwise push the main
// foreign_keys_test.go above the repo's file-length guardrail.
// Keeps the same package so the shared mock DB helpers remain reusable.
// Exists to split large test coverage without changing behavior.

package dtt_foreign_keys

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"testing"
)

func TestTableColumnAndPrimaryKeyHelpers(t *testing.T) {
	t.Run("tableExists true", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				args:  []driver.Value{"posts"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
		}, nil)
		withForeignKeyDB(t, db)

		if !tableExists("posts") {
			t.Fatal("tableExists(posts) = false, want true")
		}
	})

	t.Run("tableExists error becomes false", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.tables",
				err:   fmt.Errorf("boom"),
			},
		}, nil)
		withForeignKeyDB(t, db)

		if tableExists("posts") {
			t.Fatal("tableExists(posts) = true, want false on query error")
		}
	})

	t.Run("columnExists true and error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM information_schema.columns",
				args:  []driver.Value{"posts", "author_id"},
				cols:  []string{"exists"},
				rows:  [][]driver.Value{{true}},
			},
			{
				match: "FROM information_schema.columns",
				err:   fmt.Errorf("boom"),
			},
		}, nil)
		withForeignKeyDB(t, db)

		if !columnExists("posts", "author_id") {
			t.Fatal("columnExists(posts, author_id) = false, want true")
		}
		if columnExists("posts", "missing") {
			t.Fatal("columnExists(posts, missing) = true, want false on query error")
		}
	})

	t.Run("hasSingleColumnPK true false and error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"posts"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"id"}},
			},
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"post_tags_relation"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"post_id"}, {"tag_id"}},
			},
			{
				match: "FROM pg_index i",
				err:   fmt.Errorf("boom"),
			},
		}, nil)

		ok, err := hasSingleColumnPK(db, "posts")
		if err != nil || !ok {
			t.Fatalf("hasSingleColumnPK(posts) = (%v, %v), want (true, nil)", ok, err)
		}

		ok, err = hasSingleColumnPK(db, "post_tags_relation")
		if err != nil || ok {
			t.Fatalf("hasSingleColumnPK(post_tags_relation) = (%v, %v), want (false, nil)", ok, err)
		}

		ok, err = hasSingleColumnPK(db, "broken")
		if err == nil || ok {
			t.Fatalf("hasSingleColumnPK(broken) = (%v, %v), want (false, error)", ok, err)
		}
	})
}

func TestGetPrimaryKeyColsAndIsLikelyM2MBridgingTable(t *testing.T) {
	t.Run("name guard", func(t *testing.T) {
		ok, reason, err := isLikelyM2MBridgingTable(nil, mmConstraint{
			BridgingTable: "user_team_links",
			ColA:          "user_id",
			ColB:          "team_id",
		})
		if err != nil || ok {
			t.Fatalf("isLikelyM2MBridgingTable(name guard) = (%v, %q, %v), want false with no error", ok, reason, err)
		}
		if !strings.Contains(reason, "name does not contain") {
			t.Fatalf("reason = %q, want name-guard explanation", reason)
		}
	})

	t.Run("column count too large", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "SELECT COUNT(*)",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"count"},
				rows:  [][]driver.Value{{7}},
			},
		}, nil)

		ok, reason, err := isLikelyM2MBridgingTable(db, mmConstraint{
			BridgingTable: "user_team_relation",
			ColA:          "user_id",
			ColB:          "team_id",
		})
		if err != nil || ok {
			t.Fatalf("isLikelyM2MBridgingTable(col count) = (%v, %q, %v), want false with no error", ok, reason, err)
		}
		if !strings.Contains(reason, "more than 6") {
			t.Fatalf("reason = %q, want column-count explanation", reason)
		}
	})

	t.Run("pk mismatch", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "SELECT COUNT(*)",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"count"},
				rows:  [][]driver.Value{{2}},
			},
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"id"}, {"tenant_id"}},
			},
		}, nil)

		ok, reason, err := isLikelyM2MBridgingTable(db, mmConstraint{
			BridgingTable: "user_team_relation",
			ColA:          "user_id",
			ColB:          "team_id",
		})
		if err != nil || ok {
			t.Fatalf("isLikelyM2MBridgingTable(pk mismatch) = (%v, %q, %v), want false with no error", ok, reason, err)
		}
		if !strings.Contains(reason, "do not match bridging cols") {
			t.Fatalf("reason = %q, want pk-mismatch explanation", reason)
		}
	})

	t.Run("success plus getPrimaryKeyCols", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"user_id"}, {"team_id"}},
			},
			{
				match: "SELECT COUNT(*)",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"count"},
				rows:  [][]driver.Value{{2}},
			},
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"user_id"}, {"team_id"}},
			},
		}, nil)

		pkCols, err := getPrimaryKeyCols(db, "user_team_relation")
		if err != nil {
			t.Fatalf("getPrimaryKeyCols returned error: %v", err)
		}
		if len(pkCols) != 2 || pkCols[0] != "user_id" || pkCols[1] != "team_id" {
			t.Fatalf("pkCols = %#v, want [user_id team_id]", pkCols)
		}

		ok, reason, err := isLikelyM2MBridgingTable(db, mmConstraint{
			BridgingTable: "user_team_relation",
			ColA:          "user_id",
			TableA:        "users",
			ColARef:       "id",
			ColB:          "team_id",
			TableB:        "teams",
			ColBRef:       "id",
		})
		if err != nil || !ok || reason != "" {
			t.Fatalf("isLikelyM2MBridgingTable(success) = (%v, %q, %v), want (true, \"\", nil)", ok, reason, err)
		}
	})
}

func TestSyncOneToManyFKConstraintsHandlesQueryErrorAndNoopSuccess(t *testing.T) {
	t.Run("initial query error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM pg_constraint c",
				err:   fmt.Errorf("boom"),
			},
		}, nil)

		err := SyncOneToManyFKConstraints(db)
		if err == nil || !strings.Contains(err.Error(), "cannot query existing fk constraints from DB") {
			t.Fatalf("err = %v, want wrapped query failure", err)
		}
	})

	t.Run("no-op success", func(t *testing.T) {
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "FROM pg_constraint c",
				cols:  []string{"source_table", "source_column", "target_table", "target_column"},
				rows:  [][]driver.Value{{"posts", "author_id", "users", "id"}},
			},
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"posts"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"id"}},
			},
			{
				match: "FROM system_foreign_key_relations_1_m fr",
				cols:  []string{"id", "source_table_name", "source_column_name", "target_table_name", "target_column_name"},
				rows:  [][]driver.Value{{int64(1), "posts", "author_id", "users", "id"}},
			},
		}, nil)

		if err := SyncOneToManyFKConstraints(db); err != nil {
			t.Fatalf("SyncOneToManyFKConstraints returned error: %v", err)
		}
		if len(state.execCalls) != 0 {
			t.Fatalf("exec calls = %d, want 0 for no-op sync", len(state.execCalls))
		}
	})
}

func TestSyncManyToManyFKConstraintsHandlesQueryErrorAndNoopSuccess(t *testing.T) {
	t.Run("initial query error", func(t *testing.T) {
		db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "WITH all_fk_info AS",
				err:   fmt.Errorf("boom"),
			},
		}, nil)

		err := SyncManyToManyFKConstraints(db)
		if err == nil || !strings.Contains(err.Error(), "cannot query bridging tables for m–m detection") {
			t.Fatalf("err = %v, want wrapped query failure", err)
		}
	})

	t.Run("no-op success", func(t *testing.T) {
		fksJSON := `[{"constraint_name":"fk_user","bridging_col":"user_id","foreign_table":"users","foreign_col":"id"},{"constraint_name":"fk_team","bridging_col":"team_id","foreign_table":"teams","foreign_col":"id"}]`
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "WITH all_fk_info AS",
				cols:  []string{"bridging_table", "fks"},
				rows:  [][]driver.Value{{"user_team_relation", []byte(fksJSON)}},
			},
			{
				match: "SELECT COUNT(*)",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"count"},
				rows:  [][]driver.Value{{2}},
			},
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"user_id"}, {"team_id"}},
			},
			{
				match: "FROM system_foreign_key_relations_m_m fr",
				cols: []string{
					"id",
					"bridging_table_name",
					"bridging_col_a",
					"bridging_col_b",
					"table_a_name",
					"table_a_column",
					"table_b_name",
					"table_b_column",
				},
				rows: [][]driver.Value{{int64(1), "user_team_relation", "user_id", "team_id", "users", "id", "teams", "id"}},
			},
		}, nil)

		if err := SyncManyToManyFKConstraints(db); err != nil {
			t.Fatalf("SyncManyToManyFKConstraints returned error: %v", err)
		}
		if len(state.execCalls) != 0 {
			t.Fatalf("exec calls = %d, want 0 for no-op sync", len(state.execCalls))
		}
	})

	t.Run("insert includes legacy bridging table name", func(t *testing.T) {
		fksJSON := `[{"constraint_name":"fk_user","bridging_col":"user_id","foreign_table":"users","foreign_col":"id"},{"constraint_name":"fk_team","bridging_col":"team_id","foreign_table":"teams","foreign_col":"id"}]`
		db, state := openForeignKeyMockDB(t, []foreignKeyQueryResponse{
			{
				match: "WITH all_fk_info AS",
				cols:  []string{"bridging_table", "fks"},
				rows:  [][]driver.Value{{"user_team_relation", []byte(fksJSON)}},
			},
			{
				match: "SELECT COUNT(*)",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"count"},
				rows:  [][]driver.Value{{2}},
			},
			{
				match: "FROM pg_index i",
				args:  []driver.Value{"user_team_relation"},
				cols:  []string{"attname"},
				rows:  [][]driver.Value{{"user_id"}, {"team_id"}},
			},
			{
				match: "FROM system_foreign_key_relations_m_m fr",
				cols: []string{
					"id",
					"bridging_table_name",
					"bridging_col_a",
					"bridging_col_b",
					"table_a_name",
					"table_a_column",
					"table_b_name",
					"table_b_column",
				},
			},
		}, []foreignKeyExecResponse{
			{
				match: "bridging_table_name",
				args: []driver.Value{
					"user_team_relation",
					"user_id",
					"team_id",
					"users",
					"id",
					"teams",
					"id",
				},
				rowsAffected: 1,
			},
		})

		if err := SyncManyToManyFKConstraints(db); err != nil {
			t.Fatalf("SyncManyToManyFKConstraints returned error: %v", err)
		}
		if len(state.execCalls) != 1 {
			t.Fatalf("exec calls = %d, want 1", len(state.execCalls))
		}
		if !strings.Contains(state.execCalls[0].query, "bridging_table_name") {
			t.Fatalf("insert query = %q, want bridging_table_name column", state.execCalls[0].query)
		}
	})
}
