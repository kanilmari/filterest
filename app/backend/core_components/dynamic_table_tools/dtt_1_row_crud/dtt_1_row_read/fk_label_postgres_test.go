// fk_label_postgres_test.go
// Executes protected FK projections with the migration's real exact-row resolver.
// Reuses an isolated cluster; no installation database or provider is contacted.
// Covers listing, ordered intelligent hydration and vector projection SQL.
package dtt_1_row_read

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"testing"

	backend "easelect/backend/core_components"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	pgvector "github.com/pgvector/pgvector-go"
)

func foreignLabelPostgres(t *testing.T) (*sql.DB, *sql.DB, map[int]dtt_models.ColumnInfo) {
	t.Helper()
	owner, reader := ownerResolverPostgres(t)
	// get-results also reads the category facets.
	loadRowGroupSchema(t, owner)
	baselineExec(t, owner, `
CREATE TABLE system_functions(id bigint PRIMARY KEY,url_route_endpoint text,disabled boolean);
CREATE TABLE system_group_table_func_rights(user_group_id bigint,function_id bigint,target_table_uid bigint);
INSERT INTO system_functions VALUES(1,'/api/get-results',false);
INSERT INTO system_user_group_memberships VALUES(4,2);
INSERT INTO system_group_table_func_rights VALUES(2,1,101);
CREATE TABLE label_targets(id integer PRIMARY KEY,code text UNIQUE,title text,published boolean);
CREATE TABLE label_sources(id integer PRIMARY KEY,target_id integer REFERENCES label_targets(id),cached_title text);
INSERT INTO system_db_tables(table_uid,table_name) VALUES(101,'label_sources'),(102,'label_targets');
INSERT INTO label_targets VALUES(1,'ONE','One',true),(2,'TWO','Draft',false),(3,'THREE','Denied',true),(4,'FOUR','Allowed draft',false);
INSERT INTO label_sources SELECT id,id,'source snapshot' FROM label_targets;
INSERT INTO system_column_details VALUES(102,'published',true);
INSERT INTO system_row_access_rules(table_uid,action_id,row_id,user_id,effect) VALUES(102,1,3,4,'deny'),(102,1,4,4,'allow');
ALTER TABLE system_column_details ADD column_uid integer;
ALTER TABLE system_column_details ADD co_number integer;
ALTER TABLE system_column_details ADD card_element text;
ALTER TABLE system_column_details ADD is_multilingual boolean;
ALTER TABLE system_column_details ADD hide_everywhere boolean;
ALTER TABLE system_column_details ADD client_delivery_mode text;
INSERT INTO system_column_details(table_uid,column_name,column_uid,co_number) VALUES(101,'id',1,1),(101,'target_id',2,2),(101,'cached_title',3,3);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wl58_reader;
GRANT UPDATE(id) ON label_targets TO wl58_reader;
`)
	old := backend.Db
	backend.Db = reader
	resetJoinMetadataCacheForTests()
	t.Cleanup(func() { backend.Db = old; resetJoinMetadataCacheForTests() })
	setCachedJoinMetadata("label_sources", joinMetadataCacheEntry{tableUID: "101", foreignKeys: map[string]dtt_utils.ForeignKey{
		"target_id": {ReferencedTable: "label_targets", ReferencedColumn: "id", NameColumn: "title"},
	}})
	return owner, reader, map[int]dtt_models.ColumnInfo{1: {ColumnName: "id"}, 2: {ColumnName: "target_id"}, 3: {ColumnName: "cached_title"}}
}

func TestForeignLabelReadPathsPostgres(t *testing.T) {
	owner, reader, columns := foreignLabelPostgres(t)
	baselineExec(t, owner, `CREATE EXTENSION vector; ALTER TABLE label_sources ADD embedding_vector vector(2); UPDATE label_sources SET embedding_vector='[1,0]';`)
	for _, allowed := range []bool{false, true} {
		if allowed {
			baselineExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(2,1,102)`)
		}
		for _, path := range []string{"get_results", "intelligent", "vector_search"} {
			t.Run(fmt.Sprintf("%s/target_read_%v", path, allowed), func(t *testing.T) {
				var data []map[string]interface{}
				var err error
				if path == "intelligent" {
					data, _, err = fetchRowsInOrder(reader, "label_sources", []int{1, 2, 3, 4}, intelligentSearchAuthorization{userID: 4, userRole: "user"})
				} else {
					var query string
					var args []interface{}
					if path == "get_results" {
						query, args, _, _, _, err = BuildSelectQuery(QueryBuilderContext{DB: reader, TableName: "label_sources", ColumnsMap: columns, VisibleColUIDs: []int{2, 3}, QueryParams: url.Values{}, UserID: 4, UserRole: "user", ResultsPerLoad: 50, ClientRowCount: 4})
					} else {
						// Execute the same protected projection and semantic SQL as
						// GetResultsVector, without calling an external provider.
						var selected, joins string
						selected, joins, _, args, err = buildJoinsWith1MRelations(reader, "label_sources", columns, []int{2, 3}, newForeignLabelAuthorization(reader, "user", 4), 0)
						where, authorizedArgs := appendReadPolicyToWhereClause("label_sources", "user", 4, ReadRowPolicy{}, "", args)
						args = authorizedArgs
						joins += " CROSS JOIN LATERAL (" + semanticMatchLateral("label_sources", semanticSources{General: true}, len(args)+1, 0) + ") AS semantic"
						query = "SELECT " + selected + " FROM label_sources " + joins + where + " ORDER BY semantic.rank_score ASC, label_sources.id"
						args = append(args, pgvector.NewVector([]float32{1, 0}))
					}
					if err == nil {
						var rows *sql.Rows
						rows, err = reader.Query(query, args...)
						if err == nil {
							_, data, err = formatRowsToMaps(rows, false)
							rows.Close()
						}
					}
				}
				if err != nil {
					t.Fatal(err)
				}
				if len(data) != 4 {
					t.Fatalf("lost source rows: %v", data)
				}
				for _, row := range data {
					id := fmt.Sprint(row["target_id"])
					var want interface{}
					if allowed && id == "1" {
						want = "One"
					}
					if row["target_name (ln)"] != want || row["cached_title"] != "source snapshot" {
						t.Fatal(row, want)
					}
					if id != "1" && id != "2" && id != "3" && id != "4" {
						t.Fatal("FK value lost", row)
					}
				}
			})
		}
	}
}

func TestForeignReferenceReadPostgres(t *testing.T) {
	owner, reader, _ := foreignLabelPostgres(t)
	for _, tc := range []struct {
		key  string
		want error
	}{{"ONE", ErrForeignRowUnreadable}} {
		tx, _ := reader.Begin()
		_, err := CheckReadableForeignReference(tx, "label_targets", "code", tc.key, 4, "user")
		tx.Rollback()
		if !errors.Is(err, tc.want) {
			t.Fatal(err)
		}
	}
	baselineExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(2,1,102)`)
	for _, tc := range []struct {
		key  string
		want error
	}{{"ONE", nil}, {"TWO", ErrForeignRowUnreadable}, {"THREE", ErrForeignRowUnreadable}, {"FOUR", ErrForeignRowUnreadable}, {"MISSING", ErrForeignRowMissing}} {
		tx, err := reader.Begin()
		if err != nil {
			t.Fatal(err)
		}
		id, err := CheckReadableForeignReference(tx, "label_targets", "code", tc.key, 4, "user")
		tx.Rollback()
		if !errors.Is(err, tc.want) || (tc.want == nil && id != 1) {
			t.Fatal(tc.key, id, err)
		}
	}
}
