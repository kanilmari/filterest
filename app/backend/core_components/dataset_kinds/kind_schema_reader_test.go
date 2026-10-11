// kind_schema_reader_test.go
// Proves cancellation, schema-only reads and malformed configuration isolation.
// Complements the opt-in PostgreSQL proof without opening a socket or database.
// Warm requests reuse scoped evidence under the schema metadata cache contract.
package dataset_kinds

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

var readerSequence atomic.Int64

type evidenceDriver struct {
	raw        []byte
	fail       bool
	checkScope func(string, []driver.NamedValue) error
	readRaw    func() []byte
}
type evidenceConn struct{ evidenceDriver }
type evidenceRows struct {
	raw  []byte
	done bool
}

func (d evidenceDriver) Open(string) (driver.Conn, error) { return &evidenceConn{d}, nil }
func (c *evidenceConn) Close() error                      { return nil }
func (c *evidenceConn) Begin() (driver.Tx, error) {
	return nil, errors.New("schema reader must not open a transaction")
}
func (c *evidenceConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}
func (c *evidenceConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if query != schemaSnapshotQuery {
		return nil, errors.New("reader must use one consistent catalogue snapshot")
	}
	if c.checkScope != nil {
		if err := c.checkScope(query, args); err != nil {
			return nil, err
		}
	}
	if c.fail {
		return nil, errors.New("fixture unavailable")
	}
	raw := c.raw
	if c.readRaw != nil {
		raw = c.readRaw()
	}
	return &evidenceRows{raw: raw}, nil
}

func TestKindWarmRequestsReuseScopedEvidence(t *testing.T) {
	InvalidateAll()
	t.Cleanup(InvalidateAll)
	raw, _ := json.Marshal(fixtureSnapshot())
	name := fmt.Sprintf("kind_scoped_evidence_%d", readerSequence.Add(1))
	calls := 0
	sql.Register(name, evidenceDriver{raw: raw, checkScope: func(query string, args []driver.NamedValue) error {
		calls++
		if len(args) != 3 || args[1].Value != `{"empty_points"}` || args[2].Value != "public" || !strings.Contains(query, "table_uid = ANY($1") || !strings.Contains(query, "table_name = ANY($2") {
			return fmt.Errorf("unbounded catalogue request: %v", args)
		}
		return nil
	}})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Warm requests share the evidence snapshot just like column metadata.
	for i := 0; i < 2; i++ {
		if _, err := ReadForName(context.Background(), db, "public.empty_points"); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatal("two warm requests must run one evidence query; got", calls)
	}
}
func (r *evidenceRows) Columns() []string { return []string{"snapshot"} }
func (r *evidenceRows) Close() error      { return nil }
func (r *evidenceRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	values[0] = r.raw
	return nil
}

func evidenceDB(t *testing.T, raw []byte, fail bool) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("kind_evidence_%d", readerSequence.Add(1))
	sql.Register(name, evidenceDriver{raw: raw, fail: fail})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestKindSchemaReaderConsistentEmptyEvidenceAndFailures(t *testing.T) {
	raw, err := json.Marshal(fixtureSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	db := evidenceDB(t, raw, false)
	for _, name := range []string{"empty_points", "public.empty_points"} {
		c, err := ReadForName(context.Background(), db, name)
		if err != nil || c.Kind != Locations || !c.Map || c.TableUID != 3 {
			t.Fatal(c, err)
		}
	}
	if c, err := ReadForName(context.Background(), db, "system_chat_messages"); err != nil || c.Chat || c.Conforming {
		t.Fatal(c, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ReadSnapshot(ctx, db, 1); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := ReadSnapshot(context.Background(), evidenceDB(t, raw, true), 1); err == nil {
		t.Fatal("query failure was hidden")
	}
	if _, err := ReadSnapshot(context.Background(), evidenceDB(t, []byte(`false`), false), 1); err == nil {
		t.Fatal("invalid evidence was accepted")
	}
}

func TestKindInvalidConfigurationCannotReuseHealthyCachedCapabilities(t *testing.T) {
	s := fixtureSnapshot()
	var cache Cache
	if !cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("healthy setup missing child")
	}
	for _, raw := range []string{`null`, `{"embeddings":"wrong-type"}`, `{"unknown":true}`, `{"embeddings":{"table_uid":1,"value_column":"embedding_vector","row_col":"misspelled"}}`} {
		var config Configuration
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			t.Fatal(err)
		}
		s.Registrations[0].Configuration = config
		c := cache.Resolve(s, 1)
		if !config.Invalid || c.Conforming || c.SemanticSearch || c.Chat || c.Map {
			t.Fatal(raw, c)
		}
	}
	s.Registrations[0].Configuration = Configuration{}
	if !cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("healthy metadata did not recover")
	}
}

func TestKindTreeAndDeclaredChildIntent(t *testing.T) {
	s := fixtureSnapshot()
	s.Shapes[0].Columns = append(s.Shapes[0].Columns, Column{Name: "parent_id", Type: "int8"})
	s.Shapes[0].ForeignKeys = append(s.Shapes[0].ForeignKeys, ForeignKey{Columns: []string{"parent_id"}, Target: s.Shapes[0].Name, TargetColumns: []string{"id"}})
	if c := Resolve(s, 1); !c.Tree {
		t.Fatal("verified self-reference lost Tree", c)
	}
	s.Registrations[1].Kind, s.Registrations[1].Version = ChatMessages, 1
	if c := Resolve(s, 1); c.ChildEmbeddings {
		t.Fatal("declared chat storage became implicit semantic input", c)
	}
	s.Registrations[2].Kind, s.Registrations[2].Version = Locations, 1
	s.Shapes[2].ForeignKeys = []ForeignKey{{Columns: []string{"host_id"}, Target: s.Shapes[0].Name, TargetColumns: []string{"id"}}}
	s.Shapes[2].Columns = append(s.Shapes[2].Columns, Column{Name: "host_id", Type: "int8"})
	if c := Resolve(s, 1); c.Map {
		t.Fatal("drifting canonical location child was downgraded to legacy", c)
	}
}

func TestKindTimestampEvidenceRejectsConditionalAndCommentedSetters(t *testing.T) {
	s := fixtureSnapshot()
	s.Registrations[0].Version = 1
	for _, source := range []string{"BEGIN IF false THEN NEW.updated=now(); END IF; RETURN NEW; END", "BEGIN -- NEW.updated=now();\n RETURN NEW; END", "BEGIN NEW.updated=now(); RETURN OLD; END"} {
		s.Shapes[0].UpdateTriggers = []string{source}
		if c := Resolve(s, 1); c.Conforming {
			t.Fatal(source, c)
		}
	}
}
