// credential_recovery_helpers_test.go
// Provides the shared deterministic SQL driver and administrator recovery fixtures.
// Between recovery policy and transaction tests and their in-memory database state.
// Keeps fixture behavior defined once without requiring a PostgreSQL instance.
package credentials

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

var recoveryDriverCounter int64

type recoveryDriverState struct {
	administrator Administrator
	identity      InstanceIdentity
	committed     bool
	rolledBack    bool
	failUpdate    bool
	failCleanup   bool
	failAudit     bool
	updateArgs    []driver.NamedValue
	cleanupArgs   []driver.NamedValue
	cleanupQuery  string
	auditArgs     []driver.NamedValue
	newGeneration int64

	// automationAdministrator is an enabled API-only automation account in the admins group with
	// administrator access, so only the shared definition's API-only exclusion keeps it out of answers.
	automationAdministrator Administrator
}

type recoveryDriver struct{ state *recoveryDriverState }

type recoveryConnection struct{ state *recoveryDriverState }

type recoveryTransaction struct{ state *recoveryDriverState }

type recoveryRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (databaseDriver *recoveryDriver) Open(string) (driver.Conn, error) {
	return &recoveryConnection{state: databaseDriver.state}, nil
}

func (connection *recoveryConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported")
}

func (connection *recoveryConnection) Close() error { return nil }

func (connection *recoveryConnection) Begin() (driver.Tx, error) {
	return &recoveryTransaction{state: connection.state}, nil
}

func (transaction *recoveryTransaction) Commit() error {
	transaction.state.committed = true
	return nil
}

func (transaction *recoveryTransaction) Rollback() error {
	transaction.state.rolledBack = true
	return nil
}

func (rows *recoveryRows) Columns() []string { return rows.columns }

func (rows *recoveryRows) Close() error { return nil }

func (rows *recoveryRows) Next(destination []driver.Value) error {
	if rows.index >= len(rows.values) {
		return io.EOF
	}
	copy(destination, rows.values[rows.index])
	rows.index++
	return nil
}

func (connection *recoveryConnection) QueryContext(
	_ context.Context,
	query string,
	args []driver.NamedValue,
) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "UPDATE restricted.users_restricted"):
		if connection.state.failUpdate {
			return nil, errors.New("credential update failed")
		}
		connection.state.updateArgs = append([]driver.NamedValue(nil), args...)
		generation := connection.state.newGeneration
		if generation == 0 {
			generation = 2
		}
		return &recoveryRows{
			columns: []string{"authentication_generation"},
			values:  [][]driver.Value{{generation}},
		}, nil
	case strings.Contains(query, "SELECT current_database()"):
		identity := connection.state.identity
		return &recoveryRows{
			columns: []string{"database_name", "database_version", "site_name", "current_project", "instance_kind", "instance_role"},
			values: [][]driver.Value{{
				identity.DatabaseName,
				identity.DatabaseVersion,
				identity.SiteName,
				identity.CurrentProject,
				identity.InstanceKind,
				identity.InstanceRole,
			}},
		}, nil
	case strings.Contains(query, "FROM system_users u") && !strings.Contains(query, LoginReadyAdministratorSource):
		return nil, fmt.Errorf("administrator query does not read the shared login-ready definition: %s", query)
	case strings.Contains(query, "FOR UPDATE OF u, ur"):
		for _, administrator := range connection.state.loginReadyAdministrators(query) {
			if len(args) == 1 && args[0].Value == administrator.ID {
				return administratorRows(administrator), nil
			}
		}
		return administratorRows(), nil
	case strings.Contains(query, "SELECT COUNT(*)"):
		return &recoveryRows{
			columns: []string{"count"},
			values:  [][]driver.Value{{int64(len(connection.state.loginReadyAdministrators(query)))}},
		}, nil
	case strings.Contains(query, "FROM system_users u"):
		return administratorRows(connection.state.loginReadyAdministrators(query)...), nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

// loginReadyAdministrators answers an administrator query the way PostgreSQL would: the automation
// account is returned too unless the query excludes API-only accounts.
func (state *recoveryDriverState) loginReadyAdministrators(query string) []Administrator {
	administrators := make([]Administrator, 0, 2)
	if state.administrator.ID != 0 {
		administrators = append(administrators, state.administrator)
	}
	if state.automationAdministrator.ID != 0 && !strings.Contains(query, "AND ur.api_only IS NOT TRUE") {
		administrators = append(administrators, state.automationAdministrator)
	}
	return administrators
}

func (connection *recoveryConnection) ExecContext(
	_ context.Context,
	query string,
	args []driver.NamedValue,
) (driver.Result, error) {
	if strings.Contains(query, "DELETE FROM restricted.verification_codes") {
		if connection.state.failCleanup {
			return nil, errors.New("verification-code cleanup failed")
		}
		connection.state.cleanupArgs = append([]driver.NamedValue(nil), args...)
		connection.state.cleanupQuery = query
		return driver.RowsAffected(2), nil
	}
	if !strings.Contains(query, "INSERT INTO system_audit_log") {
		return nil, fmt.Errorf("unexpected exec: %s", query)
	}
	for _, requiredLiteral := range []string{
		"'operator.admin_credential_recovery'",
		"'CLI'",
		"'operator://recover-admin'",
		"'system_users'",
		"'auth'",
		"TRUE",
	} {
		if !strings.Contains(query, requiredLiteral) {
			return nil, fmt.Errorf("audit query is missing %s", requiredLiteral)
		}
	}
	if connection.state.failAudit {
		return nil, errors.New("audit insert failed")
	}
	connection.state.auditArgs = append([]driver.NamedValue(nil), args...)
	return driver.RowsAffected(1), nil
}

func administratorRows(administrators ...Administrator) driver.Rows {
	rows := &recoveryRows{columns: []string{"id", "username", "method", "email", "authentication_generation"}}
	for _, administrator := range administrators {
		if administrator.ID == 0 {
			continue
		}
		rows.values = append(rows.values, []driver.Value{
			administrator.ID,
			administrator.Username,
			string(administrator.VerificationMethod),
			administrator.Email,
			administrator.AuthenticationGeneration,
		})
	}
	return rows
}

func openRecoveryTestDatabase(t *testing.T, state *recoveryDriverState) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("credential_recovery_%d", atomic.AddInt64(&recoveryDriverCounter, 1))
	sql.Register(driverName, &recoveryDriver{state: state})
	database, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func testRecoveryAdministrator(method VerificationMethod) Administrator {
	return Administrator{
		ID:                       42,
		Username:                 "admin_filterest",
		VerificationMethod:       method,
		Email:                    "owner@filterest.com",
		AuthenticationGeneration: 6,
	}
}

// testAutomationAdministrator mirrors the provisioned API automation account's non-secret state.
func testAutomationAdministrator() Administrator {
	return Administrator{
		ID:                       77,
		Username:                 "filterest_agent",
		VerificationMethod:       VerificationNone,
		Email:                    "filterest_agent@automation.invalid",
		AuthenticationGeneration: 3,
	}
}

func testRecoveryIdentity() InstanceIdentity {
	return InstanceIdentity{
		DatabaseName:    "filterest",
		DatabaseVersion: "9.7.15",
		SiteName:        "filterest.com",
		CurrentProject:  "Filterest",
		InstanceKind:    "filterest_domain",
		InstanceRole:    "application",
	}
}

func testRecoveryInput(administrator Administrator) RecoveryInput {
	return RecoveryInput{
		UserID:                           administrator.ID,
		NewPassword:                      "correct horse battery staple",
		ExpectedAuthenticationGeneration: administrator.AuthenticationGeneration,
		ExpectedVerificationMethod:       administrator.VerificationMethod,
		TargetIdentity:                   testRecoveryIdentity(),
	}
}
