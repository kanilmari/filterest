// automation_account_provisioner_test.go
// Verifies fixed-identity automation account creation, rotation, conflicts, and rollback.
// Bridges the provisioner SQL contract with a deterministic transaction-aware test driver.
// Exists so credentials cannot leak or leave partial administrator grants behind.
package auth

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type automationProvisionerMockState struct {
	mu sync.Mutex

	identityRows       [][]driver.Value
	statusRows         [][]driver.Value
	hasCredentials     bool
	failAudit          bool
	generation         int64
	beginCount         int
	commitCount        int
	rollbackCount      int
	publicInsertCount  int
	publicUpdateCount  int
	credentialUpdates  int
	credentialInserts  int
	storedPasswordHash string
}

type automationProvisionerMockDriver struct {
	state *automationProvisionerMockState
}
type automationProvisionerMockConn struct {
	state *automationProvisionerMockState
	inTx  bool
}
type automationProvisionerMockTx struct {
	conn *automationProvisionerMockConn
}
type automationProvisionerMockRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

func (mock *automationProvisionerMockDriver) Open(_ string) (driver.Conn, error) {
	return &automationProvisionerMockConn{state: mock.state}, nil
}

func (connection *automationProvisionerMockConn) Prepare(_ string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported")
}

func (connection *automationProvisionerMockConn) Close() error { return nil }

func (connection *automationProvisionerMockConn) Begin() (driver.Tx, error) {
	return connection.BeginTx(context.Background(), driver.TxOptions{})
}

func (connection *automationProvisionerMockConn) BeginTx(_ context.Context, _ driver.TxOptions) (driver.Tx, error) {
	connection.state.mu.Lock()
	defer connection.state.mu.Unlock()
	connection.inTx = true
	connection.state.beginCount++
	return &automationProvisionerMockTx{conn: connection}, nil
}

func (transaction *automationProvisionerMockTx) Commit() error {
	transaction.conn.state.mu.Lock()
	defer transaction.conn.state.mu.Unlock()
	transaction.conn.state.commitCount++
	transaction.conn.inTx = false
	return nil
}

func (transaction *automationProvisionerMockTx) Rollback() error {
	transaction.conn.state.mu.Lock()
	defer transaction.conn.state.mu.Unlock()
	transaction.conn.state.rollbackCount++
	transaction.conn.inTx = false
	return nil
}

func (rows *automationProvisionerMockRows) Columns() []string { return rows.columns }
func (rows *automationProvisionerMockRows) Close() error      { return nil }
func (rows *automationProvisionerMockRows) Next(destination []driver.Value) error {
	if rows.index >= len(rows.rows) {
		return io.EOF
	}
	copy(destination, rows.rows[rows.index])
	rows.index++
	return nil
}

func (connection *automationProvisionerMockConn) QueryContext(
	_ context.Context,
	query string,
	arguments []driver.NamedValue,
) (driver.Rows, error) {
	normalized := strings.Join(strings.Fields(query), " ")
	connection.state.mu.Lock()
	defer connection.state.mu.Unlock()

	switch {
	case strings.Contains(normalized, "LEFT JOIN restricted.users_restricted credentials"):
		return &automationProvisionerMockRows{
			columns: []string{"id", "username", "enabled", "admin", "privileged", "creation_spec", "membership", "method", "generation"},
			rows:    connection.state.statusRows,
		}, nil
	case strings.Contains(normalized, "SELECT id, username, COALESCE(creation_spec, '')"):
		return &automationProvisionerMockRows{
			columns: []string{"id", "username", "creation_spec"},
			rows:    connection.state.identityRows,
		}, nil
	case strings.Contains(normalized, "SELECT id FROM system_user_groups WHERE name = 'admins'"):
		return &automationProvisionerMockRows{columns: []string{"id"}, rows: [][]driver.Value{{int64(9)}}}, nil
	case strings.Contains(normalized, "INSERT INTO system_users"):
		connection.state.publicInsertCount++
		return &automationProvisionerMockRows{columns: []string{"id"}, rows: [][]driver.Value{{int64(44)}}}, nil
	case strings.Contains(normalized, "UPDATE restricted.users_restricted"):
		connection.state.credentialUpdates++
		connection.state.storedPasswordHash = arguments[1].Value.(string)
		if !connection.state.hasCredentials {
			return &automationProvisionerMockRows{columns: []string{"authentication_generation"}}, nil
		}
		connection.state.generation++
		return &automationProvisionerMockRows{
			columns: []string{"authentication_generation"},
			rows:    [][]driver.Value{{connection.state.generation}},
		}, nil
	case strings.Contains(normalized, "INSERT INTO restricted.users_restricted"):
		connection.state.credentialInserts++
		connection.state.storedPasswordHash = arguments[1].Value.(string)
		connection.state.generation = 1
		return &automationProvisionerMockRows{
			columns: []string{"authentication_generation"},
			rows:    [][]driver.Value{{int64(1)}},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", normalized)
	}
}

func (connection *automationProvisionerMockConn) ExecContext(
	_ context.Context,
	query string,
	_ []driver.NamedValue,
) (driver.Result, error) {
	normalized := strings.Join(strings.Fields(query), " ")
	connection.state.mu.Lock()
	defer connection.state.mu.Unlock()

	switch {
	case strings.Contains(normalized, "SELECT pg_advisory_xact_lock"):
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "UPDATE system_users SET username"):
		connection.state.publicUpdateCount++
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "DELETE FROM system_user_group_memberships"):
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "INSERT INTO system_user_group_memberships"):
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "DELETE FROM restricted.verification_codes"):
		return driver.RowsAffected(1), nil
	case strings.Contains(normalized, "INSERT INTO system_audit_log"):
		if connection.state.failAudit {
			return nil, errors.New("audit unavailable")
		}
		return driver.RowsAffected(1), nil
	default:
		return nil, fmt.Errorf("unexpected exec: %s", normalized)
	}
}

var automationProvisionerMockCounter int64

func openAutomationProvisionerMockDB(t *testing.T, state *automationProvisionerMockState) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf(
		"automation_provisioner_%d_%d",
		time.Now().UnixNano(),
		atomic.AddInt64(&automationProvisionerMockCounter, 1),
	)
	sql.Register(driverName, &automationProvisionerMockDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestAutomationAccountProvisionerCreatesAtomicReadyAdministrator(t *testing.T) {
	state := &automationProvisionerMockState{}
	provisioner := NewAutomationAccountProvisioner(openAutomationProvisionerMockDB(t, state))
	password := "generated-test-password-41"

	record, err := provisioner.Provision(context.Background(), password)
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if !record.Exists || !record.Ready || !record.Created || record.Username != AutomationAccountUsername {
		t.Fatalf("unexpected record: %#v", record)
	}
	if state.beginCount != 1 || state.commitCount != 1 || state.rollbackCount != 0 {
		t.Fatalf("transaction counts = begin:%d commit:%d rollback:%d", state.beginCount, state.commitCount, state.rollbackCount)
	}
	if state.publicInsertCount != 1 || state.credentialInserts != 1 {
		t.Fatalf("insert counts = public:%d restricted:%d", state.publicInsertCount, state.credentialInserts)
	}
	if state.storedPasswordHash == password || bcrypt.CompareHashAndPassword([]byte(state.storedPasswordHash), []byte(password)) != nil {
		t.Fatal("restricted credential was not stored as the expected bcrypt hash")
	}
}

func TestAutomationAccountProvisionerRotatesWithoutDuplicateIdentity(t *testing.T) {
	state := &automationProvisionerMockState{
		identityRows:   [][]driver.Value{{int64(44), AutomationAccountUsername, automationCreationSpec}},
		hasCredentials: true,
		generation:     7,
	}
	provisioner := NewAutomationAccountProvisioner(openAutomationProvisionerMockDB(t, state))

	record, err := provisioner.Provision(context.Background(), "generated-test-password-42")
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if record.Created || record.AuthenticationGeneration != 8 {
		t.Fatalf("rotation record = %#v", record)
	}
	if state.publicInsertCount != 0 || state.publicUpdateCount != 1 || state.credentialUpdates != 1 {
		t.Fatalf("rotation counts = public insert:%d update:%d credential update:%d", state.publicInsertCount, state.publicUpdateCount, state.credentialUpdates)
	}
}

func TestAutomationAccountProvisionerRejectsHumanOrDuplicateIdentity(t *testing.T) {
	for name, rows := range map[string][][]driver.Value{
		"human collision": {{int64(44), AutomationAccountUsername, "Created in browser"}},
		"duplicate rows": {
			{int64(44), AutomationAccountUsername, automationCreationSpec},
			{int64(45), strings.ToUpper(AutomationAccountUsername), automationCreationSpec},
		},
	} {
		t.Run(name, func(t *testing.T) {
			state := &automationProvisionerMockState{identityRows: rows}
			provisioner := NewAutomationAccountProvisioner(openAutomationProvisionerMockDB(t, state))
			_, err := provisioner.Provision(context.Background(), "generated-test-password-43")
			if !errors.Is(err, ErrAutomationAccountConflict) {
				t.Fatalf("error = %v, want conflict", err)
			}
			if state.commitCount != 0 || state.rollbackCount != 1 {
				t.Fatalf("transaction counts = commit:%d rollback:%d", state.commitCount, state.rollbackCount)
			}
		})
	}
}

func TestAutomationAccountProvisionerRollsBackWhenAuditFails(t *testing.T) {
	state := &automationProvisionerMockState{failAudit: true}
	provisioner := NewAutomationAccountProvisioner(openAutomationProvisionerMockDB(t, state))

	_, err := provisioner.Provision(context.Background(), "generated-test-password-44")
	if err == nil || !strings.Contains(err.Error(), "write automation account audit") {
		t.Fatalf("error = %v", err)
	}
	if state.commitCount != 0 || state.rollbackCount != 1 {
		t.Fatalf("transaction counts = commit:%d rollback:%d", state.commitCount, state.rollbackCount)
	}
}

func TestAutomationAccountProvisionerRejectsInvalidPasswordBeforeTransaction(t *testing.T) {
	state := &automationProvisionerMockState{}
	provisioner := NewAutomationAccountProvisioner(openAutomationProvisionerMockDB(t, state))
	if _, err := provisioner.Provision(context.Background(), "short"); err == nil {
		t.Fatal("expected password validation error")
	}
	if state.beginCount != 0 {
		t.Fatal("invalid password opened a transaction")
	}
}

func TestAutomationAccountStatusReturnsNonSecretReadback(t *testing.T) {
	state := &automationProvisionerMockState{statusRows: [][]driver.Value{{
		int64(44), AutomationAccountUsername, true, true, false,
		automationCreationSpec, true, "none", int64(3),
	}}}
	provisioner := NewAutomationAccountProvisioner(openAutomationProvisionerMockDB(t, state))
	record, err := provisioner.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if !record.Exists || !record.Ready || record.AuthenticationGeneration != 3 {
		t.Fatalf("status record = %#v", record)
	}
}
