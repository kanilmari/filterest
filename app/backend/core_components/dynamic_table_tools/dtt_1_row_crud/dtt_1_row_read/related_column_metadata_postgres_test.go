// Checks the raw foreign keys, selected column metadata and actual PostgreSQL plan for incoming relations.
package dtt_1_row_read

import (
	"database/sql"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

type columnMetadataQueryRecorder struct {
	dbutils.Querier
	orderedCandidates string
	query             string
}

func (r *columnMetadataQueryRecorder) Query(query string, args ...interface{}) (*sql.Rows, error) {
	if r.orderedCandidates != "" {
		query = strings.Replace(query, incomingForeignKeyCandidatesSQL, r.orderedCandidates, 1)
	}
	r.query = query
	return r.Querier.Query(query, args...)
}

type columnMetadataCandidate struct {
	source, table, column string
	keyWidth              int
}

func readMetadataCandidates(t *testing.T, db dbutils.Querier, query, table string) []columnMetadataCandidate {
	t.Helper()
	rows, err := db.Query(query, table)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var candidates []columnMetadataCandidate
	for rows.Next() {
		var candidate columnMetadataCandidate
		if err := rows.Scan(&candidate.source, &candidate.table, &candidate.column, &candidate.keyWidth); err != nil {
			t.Fatal(err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return candidates
}

func TestIncomingRelatedColumnMetadataPostgres(t *testing.T) {
	db := sql.OpenDB(relatedPoolPostgresConnector(t))
	t.Cleanup(func() { _ = db.Close() })
	const child = `Related "items"`
	baselineExec(t, db, `
CREATE TABLE z_direct (id integer PRIMARY KEY, code integer UNIQUE);
CREATE TABLE a_pair (first_key integer, second_key integer, PRIMARY KEY (second_key, first_key));
CREATE TABLE b_pair (id integer, code integer, PRIMARY KEY (id, code));
CREATE SCHEMA elsewhere;
CREATE TABLE elsewhere.z_direct (id integer PRIMARY KEY);
CREATE TABLE "Related ""items""" (
    id integer PRIMARY KEY, note text, group_id integer,
    shared_id integer CONSTRAINT shared_ref REFERENCES z_direct(id),
    same_target integer REFERENCES z_direct(id),
    self_id integer REFERENCES "Related ""items"""(id),
    other_schema integer REFERENCES elsewhere.z_direct(id),
    FOREIGN KEY (group_id, shared_id) REFERENCES a_pair(first_key, second_key),
    FOREIGN KEY (shared_id, group_id) REFERENCES b_pair(code, id),
    FOREIGN KEY (same_target) REFERENCES z_direct(code)
);
CREATE TABLE unrelated_source (shared_id integer CONSTRAINT shared_ref REFERENCES z_direct(code));
CREATE TABLE plain_columns (id integer PRIMARY KEY, note text);
CREATE TABLE single_fk (shared_id integer REFERENCES z_direct(id));`)

	// The legacy subquery is still used by every ordinary reader. Its complete
	// column descriptions agree wherever there is no competing target.
	for _, table := range []string{"plain_columns", "single_fk"} {
		record := &columnMetadataQueryRecorder{Querier: db}
		ordinary, err := getColumnDataTypesWithFK(table, record)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(strings.ToUpper(record.query), "AS MATERIALIZED") {
			t.Fatal("ordinary column metadata unexpectedly materialized the related lookup")
		}
		incoming, err := getIncomingRelatedColumnDataTypes(table, db)
		if err != nil || !reflect.DeepEqual(incoming, ordinary) {
			t.Fatalf("%s: incoming=%v, ordinary=%v, err=%v", table, incoming, ordinary, err)
		}
	}

	production := &columnMetadataQueryRecorder{Querier: db}
	defaultMetadata, err := getIncomingRelatedColumnDataTypes(child, production)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(production.query, incomingForeignKeyCandidatesSQL) != 1 {
		t.Fatal("expected one raw FK candidate query in the production read")
	}
	incomingMetadataPlan(t, db, production.query, child)

	expectedCandidates := []columnMetadataCandidate{
		{"group_id", "a_pair", "first_key", 2}, {"group_id", "b_pair", "id", 2},
		{"same_target", "z_direct", "code", 1}, {"same_target", "z_direct", "id", 1},
		{"self_id", child, "id", 1},
		{"shared_id", "a_pair", "second_key", 2}, {"shared_id", "b_pair", "code", 2}, {"shared_id", "z_direct", "id", 1},
	}
	expectedTargets := map[string][2]string{
		"group_id": {"a_pair", "first_key"}, "same_target": {"z_direct", "code"},
		"self_id": {child, "id"}, "shared_id": {"z_direct", "id"},
	}
	for _, setup := range []struct{ order, settings string }{
		{"ASC", "SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off"},
		{"DESC", "SET LOCAL enable_nestloop = off; SET LOCAL enable_mergejoin = off"},
	} {
		t.Run(setup.order, func(t *testing.T) {
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, err := tx.Exec("SET LOCAL jit = off; " + setup.settings); err != nil {
				t.Fatal(err)
			}
			// Feed both witnessed orders of the physical candidates into the actual reader.
			// Only order and planner settings change; selection and map building are production code.
			ordered := "SELECT * FROM (" + incomingForeignKeyCandidatesSQL + `) AS raw
				ORDER BY (column_name COLLATE "C", foreign_table_name COLLATE "C",
					foreign_column_name COLLATE "C", key_width) ` + setup.order
			want := slices.Clone(expectedCandidates)
			if setup.order == "DESC" {
				slices.Reverse(want)
			}
			got := readMetadataCandidates(t, tx, ordered, child)
			if !slices.Equal(got, want) {
				t.Fatalf("raw candidates: got %v, want %v", got, want)
			}
			record := &columnMetadataQueryRecorder{Querier: tx, orderedCandidates: ordered}
			incoming, err := getIncomingRelatedColumnDataTypes(child, record)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Count(record.query, ordered) != 1 {
				t.Fatal("the reader did not consume the requested candidate order")
			}
			if !reflect.DeepEqual(incoming, defaultMetadata) {
				t.Fatalf("ordered metadata differs from the production read: %v vs %v", incoming, defaultMetadata)
			}
			gotTargets := make(map[string][2]string)
			for name, value := range incoming {
				description := value.(map[string]interface{})
				if table, ok := description["foreign_table"].(string); ok {
					gotTargets[name] = [2]string{table, description["foreign_column"].(string)}
				}
			}
			if len(incoming) != 7 || !reflect.DeepEqual(gotTargets, expectedTargets) {
				t.Fatalf("selected metadata: got %v (%d columns), want %v (7 columns)", gotTargets, len(incoming), expectedTargets)
			}
			_, authorized, err := authorizeRelatedNestedMetadata(nil, incoming, func(table string) (bool, error) {
				return table != "z_direct", nil
			})
			if err != nil {
				t.Fatal(err)
			}
			shared := authorized["shared_id"].(map[string]interface{})
			if shared["foreign_table"] != nil || shared["foreign_column"] != nil {
				t.Fatalf("denied selected target: %v", shared)
			}
			plan := incomingMetadataPlan(t, tx, record.query, child)
			t.Logf("raw=%v selected=%v nested_loops=%d hash_joins=%d", got, gotTargets,
				strings.Count(plan, "Nested Loop"), strings.Count(plan, "Hash Join")+strings.Count(plan, "Hash Left Join"))
		})
	}

	t.Run("database role visibility", func(t *testing.T) {
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		// SELECT on the source alone cannot see its constraints. Once the actor may
		// write the source, constraint_column_usage still requires ownership of each target.
		if _, err := tx.Exec(`ALTER TABLE z_direct OWNER TO wl58_reader;
			GRANT SELECT ON "Related ""items""" TO wl58_reader; SET LOCAL ROLE wl58_reader`); err != nil {
			t.Fatal(err)
		}
		if got := readMetadataCandidates(t, tx, incomingForeignKeyCandidatesSQL, child); len(got) != 0 {
			t.Fatalf("read-only source exposed foreign keys: %v", got)
		}
		if _, err := tx.Exec(`RESET ROLE; GRANT REFERENCES ON "Related ""items""" TO wl58_reader; SET LOCAL ROLE wl58_reader`); err != nil {
			t.Fatal(err)
		}
		visible := readMetadataCandidates(t, tx, incomingForeignKeyCandidatesSQL+" ORDER BY 1, 3", child)
		want := []columnMetadataCandidate{{"same_target", "z_direct", "code", 1}, {"same_target", "z_direct", "id", 1}, {"shared_id", "z_direct", "id", 1}}
		if !slices.Equal(visible, want) {
			t.Fatalf("target owner visibility: got %v, want %v", visible, want)
		}
	})
}

// A single evaluation is the performance contract. Its join strategies, costs and timings can vary.
func incomingMetadataPlan(t *testing.T, db dbutils.Querier, query, table string) string {
	t.Helper()
	rows, err := db.Query("EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) "+query, table)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`(?m)^\s*CTE related_foreign_keys\n[^\n]+ loops=1\)\s*$`).MatchString(plan.String()) {
		t.Fatalf("foreign keys were not materialized once:\n%s", plan.String())
	}
	return plan.String()
}
