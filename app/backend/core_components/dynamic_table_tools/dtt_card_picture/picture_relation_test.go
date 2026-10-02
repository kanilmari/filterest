// picture_relation_test.go
// Pins which child relation is a row's gallery when a parent has several kinds of relation.
// Between the relation metadata a site stores and every reader and writer of the card picture.
// Exists so the order "shared gallery, then canonical candidate, then an older single-purpose
// relation" and the exclusion of attachment-only relations cannot drift apart again.
package dtt_card_picture

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
)

// relationFixture is the metadata and table shapes one mock database answers with.
type relationFixture struct {
	statuses  [][]driver.Value // child_table, parent_table, source_column_name, target_insert_specs
	relations [][]driver.Value // table_name, source_column_name
	columns   map[string][]string
}

var (
	relationFixturesMu sync.Mutex
	relationFixtures   = map[string]relationFixture{}
	relationDriverOnce sync.Once
)

type relationDriver struct{}
type relationConn struct{ fixture relationFixture }
type relationRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

func (relationDriver) Open(name string) (driver.Conn, error) {
	relationFixturesMu.Lock()
	defer relationFixturesMu.Unlock()
	return &relationConn{fixture: relationFixtures[name]}, nil
}

func (*relationConn) Prepare(string) (driver.Stmt, error) { return nil, fmt.Errorf("not implemented") }
func (*relationConn) Close() error                        { return nil }
func (*relationConn) Begin() (driver.Tx, error)           { return nil, fmt.Errorf("not implemented") }

func (conn *relationConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &relationRows{columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"}, rows: conn.fixture.statuses}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &relationRows{columns: []string{"table_name", "source_column_name"}, rows: conn.fixture.relations}, nil
	case strings.Contains(query, "FROM information_schema.tables"):
		table, _ := args[0].Value.(string)
		_, exists := conn.fixture.columns[table]
		return &relationRows{columns: []string{"exists"}, rows: [][]driver.Value{{exists}}}, nil
	case strings.Contains(query, "FROM information_schema.columns"):
		table, _ := args[0].Value.(string)
		rows := make([][]driver.Value, 0)
		for _, column := range conn.fixture.columns[table] {
			rows = append(rows, []driver.Value{column, "text"})
		}
		return &relationRows{columns: []string{"column_name", "data_type"}, rows: rows}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (rows *relationRows) Columns() []string { return rows.columns }
func (*relationRows) Close() error           { return nil }
func (rows *relationRows) Next(dest []driver.Value) error {
	if rows.index >= len(rows.rows) {
		return io.EOF
	}
	copy(dest, rows.rows[rows.index])
	rows.index++
	return nil
}

func openRelationFixture(t *testing.T, fixture relationFixture) *sql.DB {
	t.Helper()
	relationDriverOnce.Do(func() { sql.Register("card_picture_relation_mock", relationDriver{}) })
	relationFixturesMu.Lock()
	relationFixtures[t.Name()] = fixture
	relationFixturesMu.Unlock()
	db, err := sql.Open("card_picture_relation_mock", t.Name())
	if err != nil {
		t.Fatalf("open mock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

const legacyImageSpecs = `{"file_upload":{"profile_key":"image","asset_kinds":["image"],"cache_targets":[{"table":"manuals","column":"cached_image"}]}}`

func TestAnOlderPictureRelationIsTheGalleryOnlyWhenNothingCanonicalExists(t *testing.T) {
	db := openRelationFixture(t, relationFixture{
		statuses:  [][]driver.Value{{"manual_pictures", "manuals", "manual_id", []byte(legacyImageSpecs)}},
		relations: [][]driver.Value{{"manual_pictures", "manual_id"}},
		columns:   map[string][]string{"manual_pictures": {"id", "manual_id", "filename", "created"}},
	})
	relation, err := PictureRelationOf(db, "manuals")
	if err != nil {
		t.Fatalf("PictureRelationOf: %v", err)
	}
	if relation == nil || relation.ChildTable != "manual_pictures" || relation.ForeignKey != "manual_id" {
		t.Fatalf("relation = %+v, want the older picture relation manual_pictures", relation)
	}
	if relation.Shared || relation.HasAssetKind || relation.Columns.SortOrder || !relation.Columns.Created || !relation.Columns.ID {
		t.Fatalf("relation = %+v, want an older table without asset kind or order number", relation)
	}
}

func TestACanonicalGalleryWinsOverAnOlderPictureRelation(t *testing.T) {
	db := openRelationFixture(t, relationFixture{
		statuses: [][]driver.Value{{"manual_pictures", "manuals", "manual_id", []byte(legacyImageSpecs)}},
		relations: [][]driver.Value{
			{"manual_pictures", "manual_id"},
			{"manuals_assets", "manuals_id"},
		},
		columns: map[string][]string{
			"manual_pictures": {"id", "manual_id", "filename"},
			"manuals_assets":  {"id", "manuals_id", "asset_kind", "filename", "sort_order", "is_primary", "created"},
		},
	})
	relation, err := PictureRelationOf(db, "manuals")
	if err != nil {
		t.Fatalf("PictureRelationOf: %v", err)
	}
	if relation == nil || relation.ChildTable != "manuals_assets" {
		t.Fatalf("relation = %+v, want the canonical manuals_assets", relation)
	}
}

func TestAnAttachmentOnlyRelationIsNeverAGallery(t *testing.T) {
	db := openRelationFixture(t, relationFixture{
		statuses:  [][]driver.Value{{"manual_files", "manuals", "manual_id", []byte(`{"file_upload":{"profile_key":"attachment","asset_kinds":["pdf"],"target_directory":"attachments"}}`)}},
		relations: [][]driver.Value{{"manual_files", "manual_id"}},
		columns:   map[string][]string{"manual_files": {"id", "manual_id", "filename"}},
	})
	relation, err := PictureRelationOf(db, "manuals")
	if err != nil {
		t.Fatalf("PictureRelationOf: %v", err)
	}
	if relation != nil {
		t.Fatalf("relation = %+v, want none for attachments only", relation)
	}
}

func TestASharedAttachmentRelationDoesNotHideAnOlderPictureRelation(t *testing.T) {
	db := openRelationFixture(t, relationFixture{
		statuses: [][]driver.Value{
			{"manuals_assets", "manuals", "manuals_id", []byte(`{"file_upload":{"profile_key":"asset_linking","profiles":{"attachment":{"asset_kinds":["pdf"],"target_directory":"attachments"}}}}`)},
			{"manual_pictures", "manuals", "manual_id", []byte(legacyImageSpecs)},
		},
		relations: [][]driver.Value{
			{"manual_pictures", "manual_id"},
			{"manuals_assets", "manuals_id"},
		},
		columns: map[string][]string{
			"manual_pictures": {"id", "manual_id", "filename"},
			"manuals_assets":  {"id", "manuals_id", "asset_kind", "filename", "sort_order", "is_primary", "created"},
		},
	})
	relation, err := PictureRelationOf(db, "manuals")
	if err != nil {
		t.Fatalf("PictureRelationOf: %v", err)
	}
	if relation == nil || relation.ChildTable != "manual_pictures" {
		t.Fatalf("relation = %+v, want the older picture relation, not the attachments", relation)
	}
}

func TestSingularizeTableTokenHandlesPluralTrailingSegment(t *testing.T) {
	if got := singularizeTableToken("tasks"); got != "task" {
		t.Fatalf("singularizeTableToken(tasks) = %q, want %q", got, "task")
	}
	if got := singularizeTableToken("categories"); got != "category" {
		t.Fatalf("singularizeTableToken(categories) = %q, want %q", got, "category")
	}
}
