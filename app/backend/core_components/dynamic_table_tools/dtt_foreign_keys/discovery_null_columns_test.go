// discovery_null_columns_test.go
// Exercises nullable legacy relationships through both production discovery scans.
// A stub catalogue contains valid identities and NULL/nonexistent column names.
// Preservation must skip these comparisons without issuing metadata mutations.
package dtt_foreign_keys

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"
)

type discoveryDriver struct{}
type discoveryConn struct{}
type discoveryRows struct {
	columns int
	values  [][]driver.Value
}

func (d discoveryDriver) Connect(context.Context) (driver.Conn, error) { return discoveryConn{}, nil }
func (d discoveryDriver) Driver() driver.Driver                        { return d }
func (d discoveryDriver) Open(string) (driver.Conn, error)             { return d.Connect(context.Background()) }
func (discoveryConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected mutation")
}
func (discoveryConn) Close() error              { return nil }
func (discoveryConn) Begin() (driver.Tx, error) { return nil, errors.New("unexpected transaction") }
func (discoveryConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m fr"):
		r := &discoveryRows{columns: 5}
		if !strings.Contains(query, "WHERE EXISTS (SELECT 1 FROM pg_attribute") {
			r.values = [][]driver.Value{{int64(7), "source", nil, "target", "id"}, {int64(8), "source", "missing_column", "target", "id"}}
		}
		return r, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_m_m fr"):
		r := &discoveryRows{columns: 8}
		if !strings.Contains(query, "WHERE EXISTS (SELECT 1 FROM pg_attribute") {
			r.values = [][]driver.Value{{int64(9), "bridge", nil, "b_id", "source", "id", "target", "id"}}
		}
		return r, nil
	case strings.Contains(query, "SELECT bridging_table, fks"):
		return &discoveryRows{columns: 2}, nil
	case strings.Contains(query, "FROM pg_constraint c"):
		return &discoveryRows{columns: 4}, nil
	default:
		return nil, errors.New("unexpected catalogue query")
	}
}
func (r *discoveryRows) Columns() []string { return make([]string, r.columns) }
func (*discoveryRows) Close() error        { return nil }
func (r *discoveryRows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}

func TestPreservingDiscoverySkipsMalformedLegacyRelationshipColumns(t *testing.T) {
	db := sql.OpenDB(discoveryDriver{})
	defer db.Close()
	for _, sync := range []func(*sql.DB, ...bool) error{SyncOneToManyFKConstraints, SyncManyToManyFKConstraints} {
		if err := sync(db, true); err != nil {
			t.Fatal("nullable legacy row prevented required startup discovery", err)
		}
	}
}
