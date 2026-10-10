// admission_test_database_test.go
// Scripts narrow SQL interactions and observes transactional acknowledgements.
// Connects real admission handlers to database/sql without installation access.
// Complements disposable PostgreSQL tests with deterministic failure injection.
package application_updates

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type queryAnswer struct {
	contains string
	rows     [][]driver.Value
}
type executedStatement struct {
	query string
	args  []driver.NamedValue
}
type scriptedDatabase struct {
	t             *testing.T
	answers       []queryAnswer
	executed      []executedStatement
	commits       int
	commitFailure bool
	recorder      *httptest.ResponseRecorder
}
type scriptedConnection struct{ state *scriptedDatabase }
type scriptedTransaction struct{ state *scriptedDatabase }
type scriptedRows struct {
	values  [][]driver.Value
	columns int
}

func (s *scriptedDatabase) Connect(context.Context) (driver.Conn, error) {
	return &scriptedConnection{s}, nil
}
func (s *scriptedDatabase) Driver() driver.Driver            { return s }
func (s *scriptedDatabase) Open(string) (driver.Conn, error) { return s.Connect(context.Background()) }
func (*scriptedConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*scriptedConnection) Close() error                { return nil }
func (c *scriptedConnection) Begin() (driver.Tx, error) { return &scriptedTransaction{c.state}, nil }
func (c *scriptedConnection) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.state.executed = append(c.state.executed, executedStatement{query, append([]driver.NamedValue{}, args...)})
	return driver.RowsAffected(1), nil
}
func (c *scriptedConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "transaction_console_logs") {
		return &scriptedRows{columns: 1}, nil
	}
	if len(c.state.answers) == 0 {
		return nil, fmt.Errorf("unexpected SQL: %s", query)
	}
	answer := c.state.answers[0]
	c.state.answers = c.state.answers[1:]
	if !strings.Contains(query, answer.contains) {
		c.state.t.Errorf("query %s; want %s", query, answer.contains)
		return nil, errors.New("unexpected query order")
	}
	columns := 1
	if len(answer.rows) > 0 {
		columns = len(answer.rows[0])
	}
	return &scriptedRows{values: answer.rows, columns: columns}, nil
}
func (rows *scriptedRows) Columns() []string {
	names := make([]string, rows.columns)
	for i := range names {
		names[i] = fmt.Sprint(i)
	}
	return names
}
func (*scriptedRows) Close() error { return nil }
func (rows *scriptedRows) Next(dest []driver.Value) error {
	if len(rows.values) == 0 {
		return io.EOF
	}
	copy(dest, rows.values[0])
	rows.values = rows.values[1:]
	return nil
}
func (tx *scriptedTransaction) Commit() error {
	tx.state.commits++
	if tx.state.recorder != nil && tx.state.recorder.Body.Len() != 0 {
		return errors.New("acknowledgement escaped before commit")
	}
	if tx.state.commitFailure {
		return errors.New("injected commit failure")
	}
	return nil
}
func (*scriptedTransaction) Rollback() error { return nil }

func scriptDB(t *testing.T, answers ...queryAnswer) (*sql.DB, *scriptedDatabase) {
	t.Helper()
	state := &scriptedDatabase{t: t, answers: answers}
	db := sql.OpenDB(state)
	t.Cleanup(func() {
		db.Close()
		if len(state.answers) != 0 {
			t.Errorf("%d unused SQL answers", len(state.answers))
		}
	})
	return db, state
}
func scriptTx(t *testing.T, answers ...queryAnswer) (*sql.Tx, *scriptedDatabase) {
	t.Helper()
	db, state := scriptDB(t, answers...)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback() })
	return tx, state
}
func one(query string, values ...driver.Value) queryAnswer {
	return queryAnswer{query, [][]driver.Value{values}}
}
func empty(query string) queryAnswer { return queryAnswer{contains: query} }
func testTarget() Target {
	return Target{InstallationID: "site-1", ReleaseID: "9.4.0", ManifestSHA256: strings.Repeat("a", 64), ImageDigest: "sha256:" + strings.Repeat("b", 64), EvidenceRevision: 17, EvidenceSHA256: strings.Repeat("c", 64)}
}
func testActor() Authorization {
	return Authorization{ActorID: 42, Generation: 3, SignInID: "sign-in-42", SignInExpiresAt: time.Now().Add(time.Hour).Unix()}
}
func testOffer(now time.Time) Offer {
	return Offer{ProtocolVersion: 1, ID: "offer-1", Target: testTarget(), Composition: "filterest", SourceCommit: strings.Repeat("d", 40), CurrentReleaseID: "9.3.23", CurrentImageDigest: "sha256:" + strings.Repeat("e", 64), FromDatabaseVersion: "9.10.1", ToDatabaseVersion: "9.10.2", TrustRevision: 2, ExpiresAt: timestamp(now.Add(time.Hour)), ReleaseVerified: true, InstallationCompatible: true, ExecutionReady: true}
}
func proofAnswer(binding proofBinding, now time.Time, consumed bool) queryAnswer {
	var used driver.Value
	if consumed {
		used = now
	}
	return one("SELECT binding", jsonBytes(binding), now.Add(-time.Minute), now.Add(4*time.Minute), used)
}
func assertCode(t *testing.T, err error, want string) {
	t.Helper()
	var rejected *refusal
	if !errors.As(err, &rejected) || rejected.code != want {
		t.Fatalf("error=%v; want %s", err, want)
	}
}
