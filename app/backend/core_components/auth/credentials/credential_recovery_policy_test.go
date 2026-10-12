// credential_recovery_policy_test.go
// Verifies administrator eligibility, password policy, and recovery confirmation gates.
// Bridges the shared deterministic SQL driver with the recovery package's public contract.
// Keeps API-only accounts ineligible and administrator recovery inputs validated.
package credentials

import (
	"context"
	"errors"
	"strings"
	"testing"
)

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

func TestListEligibleAdministratorsLeavesOutTheAutomationAccount(t *testing.T) {
	state := &recoveryDriverState{
		administrator:           testRecoveryAdministrator(VerificationFixedPIN),
		automationAdministrator: testAutomationAdministrator(),
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	administrators, err := editor.ListEligibleAdministrators(context.Background())
	if err != nil {
		t.Fatalf("ListEligibleAdministrators() error = %v", err)
	}
	if len(administrators) != 1 || administrators[0] != state.administrator {
		t.Fatalf("administrators = %+v, want only the human administrator %+v", administrators, state.administrator)
	}
}

// TestRecoverAdministratorRefusesTheAutomationAccountWithoutWriting proves the locked recheck uses the
// same definition as the listing: the automation account is not found, while the human beside it is.
func TestRecoverAdministratorRefusesTheAutomationAccountWithoutWriting(t *testing.T) {
	state := &recoveryDriverState{
		administrator:           testRecoveryAdministrator(VerificationFixedPIN),
		automationAdministrator: testAutomationAdministrator(),
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))
	input := testRecoveryInput(state.automationAdministrator)
	input.PreserveCurrentVerification = true
	input.AllowPasswordOnly = true

	_, err := editor.RecoverAdministrator(context.Background(), input)
	if !errors.Is(err, ErrAdministratorNotFound) {
		t.Fatalf("RecoverAdministrator(automation account) error = %v, want ErrAdministratorNotFound", err)
	}
	if len(state.updateArgs) != 0 || len(state.cleanupArgs) != 0 || len(state.auditArgs) != 0 {
		t.Fatalf("refused recovery touched state: update=%#v cleanup=%#v audit=%#v", state.updateArgs, state.cleanupArgs, state.auditArgs)
	}
	if state.committed || !state.rolledBack {
		t.Fatalf("transaction committed=%t rolledBack=%t, want false/true", state.committed, state.rolledBack)
	}

	humanState := &recoveryDriverState{
		administrator:           testRecoveryAdministrator(VerificationFixedPIN),
		automationAdministrator: testAutomationAdministrator(),
	}
	humanInput := testRecoveryInput(humanState.administrator)
	humanInput.PreserveCurrentVerification = true
	result, err := NewRecoveryEditor(openRecoveryTestDatabase(t, humanState)).RecoverAdministrator(context.Background(), humanInput)
	if err != nil {
		t.Fatalf("RecoverAdministrator(human administrator) error = %v", err)
	}
	if result.UserID != humanState.administrator.ID || !humanState.committed {
		t.Fatalf("human recovery result=%+v committed=%t, want the human administrator committed", result, humanState.committed)
	}
}

func TestCountEligibleAdministratorsLeavesOutTheAutomationAccount(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		state *recoveryDriverState
		want  int
	}{
		{
			name:  "automation account only",
			state: &recoveryDriverState{automationAdministrator: testAutomationAdministrator()},
			want:  0,
		},
		{
			name: "human administrator beside it",
			state: &recoveryDriverState{
				administrator:           testRecoveryAdministrator(VerificationFixedPIN),
				automationAdministrator: testAutomationAdministrator(),
			},
			want: 1,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx, err := openRecoveryTestDatabase(t, testCase.state).BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatalf("BeginTx() error = %v", err)
			}
			defer func() { _ = tx.Rollback() }()

			count, err := countEligibleAdministrators(context.Background(), tx)
			if err != nil {
				t.Fatalf("countEligibleAdministrators() error = %v", err)
			}
			if count != testCase.want {
				t.Fatalf("eligible administrator count = %d, want %d", count, testCase.want)
			}
		})
	}
}

// TestCreateAdministratorConfirmationGateCountsOnlyLoginReadyAdministrators proves the creation gate
// counts what the operator was shown: one human administrator, never the automation account beside it.
// Counting the automation account would turn the reviewed count of one into a count-changed refusal.
func TestCreateAdministratorConfirmationGateCountsOnlyLoginReadyAdministrators(t *testing.T) {
	state := &recoveryDriverState{
		administrator:           testRecoveryAdministrator(VerificationFixedPIN),
		automationAdministrator: testAutomationAdministrator(),
	}
	editor := NewRecoveryEditor(openRecoveryTestDatabase(t, state))

	_, err := editor.CreateAdministrator(context.Background(), AdministratorCreationInput{
		LoginName:                  "second_operator_admin",
		Email:                      "second.operator@example.com",
		NewPassword:                "correct horse battery staple",
		VerificationMethod:         VerificationFixedPIN,
		FixedPIN:                   "246810",
		ObservedAdministratorCount: 1,
		OperatorReference:          "test_owner@fake-driver (pid 1)",
		TargetIdentity:             testRecoveryIdentity(),
	})
	if !errors.Is(err, ErrExistingAdministratorConfirmationRequired) {
		t.Fatalf("CreateAdministrator() error = %v, want ErrExistingAdministratorConfirmationRequired", err)
	}
	if state.committed || !state.rolledBack || len(state.auditArgs) != 0 {
		t.Fatalf("refused creation committed=%t rolledBack=%t audit=%#v, want nothing written", state.committed, state.rolledBack, state.auditArgs)
	}
}
