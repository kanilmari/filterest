// credential_recovery_editor_test.go
// Verifies administrator eligibility, credential policy, and transactional recovery writes.
// Bridges a deterministic SQL driver with the importable recovery package's public contract.
// Exists so password and factor changes cannot partially commit or expose stored secret material.
package credentials

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

	"golang.org/x/crypto/bcrypt"
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
	auditArgs     []driver.NamedValue
	newGeneration int64
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
func (rows *recoveryRows) Close() error      { return nil }
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
	case strings.Contains(query, "FOR UPDATE OF u, ur"):
		if len(args) != 1 || args[0].Value != connection.state.administrator.ID {
			return &recoveryRows{columns: []string{"id", "username", "method", "email", "authentication_generation"}}, nil
		}
		administrator := connection.state.administrator
		return administratorRows(administrator), nil
	case strings.Contains(query, "FROM system_users u"):
		return administratorRows(connection.state.administrator), nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
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

func administratorRows(administrator Administrator) driver.Rows {
	if administrator.ID == 0 {
		return &recoveryRows{columns: []string{"id", "username", "method", "email", "authentication_generation"}}
	}
	return &recoveryRows{
		columns: []string{"id", "username", "method", "email", "authentication_generation"},
		values: [][]driver.Value{{
			administrator.ID,
			administrator.Username,
			string(administrator.VerificationMethod),
			administrator.Email,
			administrator.AuthenticationGeneration,
		}},
	}
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

func testRecoveryIdentity() InstanceIdentity {
	return InstanceIdentity{
		DatabaseName:    "filterest",
		DatabaseVersion: "9.6.2",
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

func TestValidatePasswordMatchesAdministratorPolicyAndBcryptLimit(t *testing.T) {
	for _, password := range []string{
		"short",
		strings.Repeat("a", maximumPasswordLength+1),
		strings.Repeat("界", 25),
		"valid password\nwith newline",
	} {
		if err := ValidatePassword(password); !errors.Is(err, ErrInvalidPassword) {
			t.Fatalf("ValidatePassword(%q) error = %v, want ErrInvalidPassword", password, err)
		}
	}
	if err := ValidatePassword("correct horse battery staple"); err != nil {
		t.Fatalf("ValidatePassword(valid) error = %v", err)
	}
}

func TestEmailDeliveryConfiguredRejectsPlaceholderAddresses(t *testing.T) {
	if !EmailDeliveryConfigured("configured-token", "sender@filterest.com") {
		t.Fatal("real configured sender should be delivery-ready")
	}
	for _, address := range []string{"", "sender@filterest.invalid", "sender@example.test", "not-an-email"} {
		if EmailDeliveryConfigured("configured-token", address) {
			t.Fatalf("placeholder sender %q should not be delivery-ready", address)
		}
	}
}

func TestDatabaseVersionAtLeastUsesThreePartNumericOrdering(t *testing.T) {
	for _, testCase := range []struct {
		current string
		minimum string
		want    bool
	}{
		{current: "9.6.2", minimum: "9.6.2", want: true},
		{current: "9.7.0", minimum: "9.6.2", want: true},
		{current: "9.6.1", minimum: "9.6.2", want: false},
		{current: "invalid", minimum: "9.6.2", want: false},
	} {
		if got := DatabaseVersionAtLeast(testCase.current, testCase.minimum); got != testCase.want {
			t.Fatalf("DatabaseVersionAtLeast(%q, %q) = %t, want %t", testCase.current, testCase.minimum, got, testCase.want)
		}
	}
}

func TestReadIdentityAndListEligibleAdministratorsReturnNoSecrets(t *testing.T) {
	state := &recoveryDriverState{
		administrator: testRecoveryAdministrator(VerificationFixedPIN),
		identity:      testRecoveryIdentity(),
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	identity, err := editor.ReadInstanceIdentity(context.Background())
	if err != nil {
		t.Fatalf("ReadInstanceIdentity() error = %v", err)
	}
	if identity != state.identity {
		t.Fatalf("identity = %+v, want %+v", identity, state.identity)
	}
	administrators, err := editor.ListEligibleAdministrators(context.Background())
	if err != nil {
		t.Fatalf("ListEligibleAdministrators() error = %v", err)
	}
	if len(administrators) != 1 || administrators[0] != state.administrator {
		t.Fatalf("administrators = %+v, want only %+v", administrators, state.administrator)
	}
}

func TestRecoverAdministratorChangesPasswordAndFixedPINAtomically(t *testing.T) {
	state := &recoveryDriverState{
		administrator: testRecoveryAdministrator(VerificationEmail),
		newGeneration: 9,
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	input := testRecoveryInput(state.administrator)
	input.VerificationMethod = VerificationFixedPIN
	input.FixedPIN = "456789"
	result, err := editor.RecoverAdministrator(context.Background(), input)
	if err != nil {
		t.Fatalf("RecoverAdministrator() error = %v", err)
	}
	if !state.committed || state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want true/false", state.committed, state.rolledBack)
	}
	if result.VerificationMethod != VerificationFixedPIN || result.Username != state.administrator.Username {
		t.Fatalf("result = %+v", result)
	}
	if result.AuthenticationGeneration != 9 {
		t.Fatalf("authentication generation = %d, want 9", result.AuthenticationGeneration)
	}
	if len(state.cleanupArgs) != 1 || state.cleanupArgs[0].Value != state.administrator.ID {
		t.Fatalf("verification-code cleanup args = %#v, want target user", state.cleanupArgs)
	}
	if len(state.updateArgs) != 4 {
		t.Fatalf("update args = %#v, want password/method/PIN/user", state.updateArgs)
	}
	passwordHash, _ := state.updateArgs[0].Value.(string)
	if err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte("correct horse battery staple")); err != nil {
		t.Fatalf("stored password is not the submitted bcrypt value: %v", err)
	}
	if state.updateArgs[1].Value != string(VerificationFixedPIN) {
		t.Fatalf("stored method = %#v", state.updateArgs[1].Value)
	}
	fixedPINHash, _ := state.updateArgs[2].Value.(string)
	if err = bcrypt.CompareHashAndPassword([]byte(fixedPINHash), []byte("456789")); err != nil {
		t.Fatalf("stored PIN is not the submitted bcrypt value: %v", err)
	}
	if len(state.auditArgs) != 1 {
		t.Fatalf("audit args = %#v, want one JSON details value", state.auditArgs)
	}
	var auditDetails map[string]interface{}
	if err = json.Unmarshal([]byte(state.auditArgs[0].Value.(string)), &auditDetails); err != nil {
		t.Fatalf("decode audit details: %v", err)
	}
	if auditDetails["target_username"] != state.administrator.Username ||
		auditDetails["previous_verification_method"] != string(VerificationEmail) ||
		auditDetails["new_verification_method"] != string(VerificationFixedPIN) ||
		auditDetails["source"] != "interactive_cli" ||
		auditDetails["old_generation"] != float64(6) ||
		auditDetails["new_generation"] != float64(9) ||
		auditDetails["site_name"] != "filterest.com" ||
		auditDetails["current_project"] != "Filterest" ||
		auditDetails["database_name"] != "filterest" {
		t.Fatalf("audit details = %#v", auditDetails)
	}
	serializedAudit := state.auditArgs[0].Value.(string)
	for _, forbidden := range []string{"correct horse", "456789", passwordHash, fixedPINHash, state.administrator.Email} {
		if strings.Contains(serializedAudit, forbidden) {
			t.Fatalf("audit details contain forbidden credential material %q: %s", forbidden, serializedAudit)
		}
	}
}

func TestRecoverAdministratorPreservesExistingTOTPWithoutProvisioningIt(t *testing.T) {
	state := &recoveryDriverState{administrator: testRecoveryAdministrator(VerificationTOTP)}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	input := testRecoveryInput(state.administrator)
	input.PreserveCurrentVerification = true
	result, err := editor.RecoverAdministrator(context.Background(), input)
	if err != nil {
		t.Fatalf("RecoverAdministrator() error = %v", err)
	}
	if result.VerificationMethod != VerificationTOTP {
		t.Fatalf("verification method = %q, want preserved totp", result.VerificationMethod)
	}
	if len(state.updateArgs) != 2 {
		t.Fatalf("preserving TOTP update args = %#v, want only password/user", state.updateArgs)
	}
	if state.updateArgs[1].Value != state.administrator.ID {
		t.Fatalf("updated user = %#v, want %d", state.updateArgs[1].Value, state.administrator.ID)
	}
}

func TestRecoverAdministratorRequiresExplicitPasswordOnlyConfirmation(t *testing.T) {
	state := &recoveryDriverState{administrator: testRecoveryAdministrator(VerificationFixedPIN)}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	input := testRecoveryInput(state.administrator)
	input.VerificationMethod = VerificationNone
	_, err := editor.RecoverAdministrator(context.Background(), input)
	if !errors.Is(err, ErrPasswordOnlyConfirmationRequired) {
		t.Fatalf("RecoverAdministrator() error = %v, want ErrPasswordOnlyConfirmationRequired", err)
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}
}

func TestRecoverAdministratorRequiresReadyEmailDeliveryAndRealTargetAddress(t *testing.T) {
	administrator := testRecoveryAdministrator(VerificationFixedPIN)
	administrator.Email = "owner@filterest.invalid"
	state := &recoveryDriverState{administrator: administrator}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	input := testRecoveryInput(state.administrator)
	input.VerificationMethod = VerificationEmail
	input.EmailDeliveryReady = true
	_, err := editor.RecoverAdministrator(context.Background(), input)
	if !errors.Is(err, ErrEmailVerificationUnavailable) {
		t.Fatalf("RecoverAdministrator() error = %v, want ErrEmailVerificationUnavailable", err)
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}
}

func TestRecoverAdministratorAllowsExplicitReadyEmailAndPasswordOnlyChoices(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		method       VerificationMethod
		emailReady   bool
		passwordOnly bool
	}{
		{name: "ready email", method: VerificationEmail, emailReady: true},
		{name: "confirmed password only", method: VerificationNone, passwordOnly: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := &recoveryDriverState{administrator: testRecoveryAdministrator(VerificationFixedPIN)}
			editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))
			input := testRecoveryInput(state.administrator)
			input.VerificationMethod = testCase.method
			input.EmailDeliveryReady = testCase.emailReady
			input.AllowPasswordOnly = testCase.passwordOnly

			result, err := editor.RecoverAdministrator(context.Background(), input)
			if err != nil {
				t.Fatalf("RecoverAdministrator() error = %v", err)
			}
			if result.VerificationMethod != testCase.method || !state.committed || state.rolledBack {
				t.Fatalf("result=%+v committed=%t rolledBack=%t", result, state.committed, state.rolledBack)
			}
			if len(state.updateArgs) != 4 || state.updateArgs[1].Value != string(testCase.method) || state.updateArgs[2].Value != nil {
				t.Fatalf("factor update args = %#v", state.updateArgs)
			}
		})
	}
}

func TestRecoverAdministratorRollsBackFailedCredentialUpdate(t *testing.T) {
	state := &recoveryDriverState{
		administrator: testRecoveryAdministrator(VerificationEmail),
		failUpdate:    true,
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	input := testRecoveryInput(state.administrator)
	input.PreserveCurrentVerification = true
	input.EmailDeliveryReady = true
	_, err := editor.RecoverAdministrator(context.Background(), input)
	if err == nil || !strings.Contains(err.Error(), "update restricted administrator credentials") {
		t.Fatalf("RecoverAdministrator() error = %v, want wrapped update failure", err)
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}
}

func TestRecoverAdministratorRollsBackCredentialUpdateWhenAuditFails(t *testing.T) {
	state := &recoveryDriverState{
		administrator: testRecoveryAdministrator(VerificationFixedPIN),
		failAudit:     true,
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	input := testRecoveryInput(state.administrator)
	input.PreserveCurrentVerification = true
	_, err := editor.RecoverAdministrator(context.Background(), input)
	if err == nil || !strings.Contains(err.Error(), "write credential recovery audit") {
		t.Fatalf("RecoverAdministrator() error = %v, want wrapped audit failure", err)
	}
	if len(state.updateArgs) == 0 {
		t.Fatal("credential update should have been attempted before synchronous audit")
	}
	if len(state.cleanupArgs) == 0 {
		t.Fatal("verification-code cleanup should have been attempted before synchronous audit")
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}
}

func TestRecoverAdministratorRejectsConcurrentCredentialSnapshotChange(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		drift func(*RecoveryInput)
	}{
		{
			name: "generation",
			drift: func(input *RecoveryInput) {
				input.ExpectedAuthenticationGeneration--
			},
		},
		{
			name: "verification method",
			drift: func(input *RecoveryInput) {
				input.ExpectedVerificationMethod = VerificationEmail
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := &recoveryDriverState{administrator: testRecoveryAdministrator(VerificationFixedPIN)}
			editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))
			input := testRecoveryInput(state.administrator)
			testCase.drift(&input)
			input.PreserveCurrentVerification = true

			_, err := editor.RecoverAdministrator(context.Background(), input)
			if !errors.Is(err, ErrCredentialSnapshotConflict) {
				t.Fatalf("RecoverAdministrator() error = %v, want snapshot conflict", err)
			}
			if len(state.updateArgs) != 0 || len(state.cleanupArgs) != 0 || len(state.auditArgs) != 0 {
				t.Fatalf("conflicted recovery touched state: update=%#v cleanup=%#v audit=%#v", state.updateArgs, state.cleanupArgs, state.auditArgs)
			}
			if state.committed || !state.rolledBack {
				t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
			}
		})
	}
}

func TestRecoverAdministratorPreserveStillEnforcesEmailAndPasswordOnlyGates(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		method VerificationMethod
		want   error
	}{
		{name: "email delivery unavailable", method: VerificationEmail, want: ErrEmailVerificationUnavailable},
		{name: "password only unconfirmed", method: VerificationNone, want: ErrPasswordOnlyConfirmationRequired},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			state := &recoveryDriverState{administrator: testRecoveryAdministrator(testCase.method)}
			editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))
			input := testRecoveryInput(state.administrator)
			input.PreserveCurrentVerification = true

			_, err := editor.RecoverAdministrator(context.Background(), input)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("RecoverAdministrator() error = %v, want %v", err, testCase.want)
			}
			if state.committed || !state.rolledBack {
				t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
			}
		})
	}
}

func TestRecoverAdministratorRollsBackWhenVerificationCodeCleanupFails(t *testing.T) {
	state := &recoveryDriverState{
		administrator: testRecoveryAdministrator(VerificationTOTP),
		failCleanup:   true,
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))
	input := testRecoveryInput(state.administrator)
	input.PreserveCurrentVerification = true

	_, err := editor.RecoverAdministrator(context.Background(), input)
	if err == nil || !strings.Contains(err.Error(), "delete pending administrator verification codes") {
		t.Fatalf("RecoverAdministrator() error = %v, want wrapped cleanup failure", err)
	}
	if len(state.updateArgs) == 0 {
		t.Fatal("credential update should have been attempted before verification-code cleanup")
	}
	if len(state.auditArgs) != 0 {
		t.Fatalf("failed cleanup must prevent audit write, got %#v", state.auditArgs)
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}
}

func TestChangePasswordCommitsGenerationAndPendingCodeInvalidationTogether(t *testing.T) {
	state := &recoveryDriverState{newGeneration: 8}
	database := openRecoveryTestDatabase(t, state)

	newGeneration, err := ChangePassword(
		context.Background(),
		database,
		42,
		"a replacement password",
		7,
	)
	if err != nil {
		t.Fatalf("ChangePassword() error = %v", err)
	}
	if newGeneration != 8 || !state.committed || state.rolledBack {
		t.Fatalf("generation=%d committed=%t rolledBack=%t, want 8/true/false", newGeneration, state.committed, state.rolledBack)
	}
	if len(state.updateArgs) != 3 || state.updateArgs[1].Value != int64(42) || state.updateArgs[2].Value != int64(7) {
		t.Fatalf("password update args = %#v", state.updateArgs)
	}
	if len(state.cleanupArgs) != 1 || state.cleanupArgs[0].Value != int64(42) {
		t.Fatalf("verification-code cleanup args = %#v", state.cleanupArgs)
	}
}

func TestChangePasswordRollsBackWhenPendingCodeInvalidationFails(t *testing.T) {
	state := &recoveryDriverState{newGeneration: 8, failCleanup: true}
	database := openRecoveryTestDatabase(t, state)

	_, err := ChangePassword(context.Background(), database, 42, "a replacement password", 7)
	if err == nil || !strings.Contains(err.Error(), "invalidate pending verification codes") {
		t.Fatalf("ChangePassword() error = %v, want cleanup failure", err)
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}
}
