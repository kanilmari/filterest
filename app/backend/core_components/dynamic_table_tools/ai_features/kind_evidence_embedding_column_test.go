// kind_evidence_embedding_column_test.go
// Proves the streamed embedding path clears evidence after adding its vector column.
// Connects the actual handler's auto-commit DDL to an offline warm reader.
// Stops at field-policy loading so this test never calls an embedding provider.
package ai_features

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds/kindtest"
)

type kindEmbeddingDriver struct {
	fail   bool
	writes int
}
type kindEmbeddingConn struct{ state *kindEmbeddingDriver }
type kindEmbeddingRows struct{}

func (d *kindEmbeddingDriver) Connect(context.Context) (driver.Conn, error) {
	return &kindEmbeddingConn{d}, nil
}
func (d *kindEmbeddingDriver) Driver() driver.Driver { return d }
func (d *kindEmbeddingDriver) Open(string) (driver.Conn, error) {
	return d.Connect(context.Background())
}
func (*kindEmbeddingConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*kindEmbeddingConn) Close() error              { return nil }
func (*kindEmbeddingConn) Begin() (driver.Tx, error) { return nil, errors.New("DDL uses auto-commit") }
func (c *kindEmbeddingConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.HasPrefix(query, "ALTER TABLE") {
		return nil, errors.New("unexpected write")
	}
	c.state.writes++
	if c.state.fail {
		return nil, errors.New("DDL refused")
	}
	return driver.RowsAffected(1), nil
}
func (*kindEmbeddingConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "FROM information_schema.columns") {
		return kindEmbeddingRows{}, nil
	}
	return nil, errors.New("stop at field-policy loading")
}
func (kindEmbeddingRows) Columns() []string         { return []string{"column_name"} }
func (kindEmbeddingRows) Close() error              { return nil }
func (kindEmbeddingRows) Next([]driver.Value) error { return io.EOF }

func TestKindEvidenceEmbeddingColumnCommittedWrites(t *testing.T) {
	for _, fail := range []bool{false, true} {
		label := "commit"
		if fail {
			label = "failure"
		}
		t.Run(label, func(t *testing.T) {
			read := kindtest.WarmProbe(t)
			read(1)
			state := &kindEmbeddingDriver{fail: fail}
			db := sql.OpenDB(state)
			defer db.Close()
			old := backend.Db
			backend.Db = db
			t.Cleanup(func() { backend.Db = old })
			r := kindtest.AuthenticatedRequest(t, "GET", "/api/embedding-stream?dataset=kind_probe", nil)
			w := httptest.NewRecorder()
			EmbeddingStreamHandler(w, r)
			if state.writes != 1 {
				t.Fatal("column addition was not exercised", state.writes)
			}
			want := int64(2)
			if fail {
				want = 1
			}
			read(want)
		})
	}
}
