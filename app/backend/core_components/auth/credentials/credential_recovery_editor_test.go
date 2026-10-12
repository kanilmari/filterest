// credential_recovery_editor_test.go
// Verifies credential changes, factor choices, and transactional recovery writes.
// Bridges the shared deterministic SQL driver with the recovery package's public contract.
// Exists so password and factor changes cannot partially commit or expose stored secret material.
package credentials

import (
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"testing"
)

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
	// The audit names the account by id only (WL132): no name is written.
	if _, named := auditDetails["target_username"]; named ||
		auditDetails["target_user_id"] != float64(state.administrator.ID) ||
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
	if !strings.Contains(state.cleanupQuery, "WHERE user_id = $1") || strings.Contains(state.cleanupQuery, "used") {
		t.Fatalf("verification-code cleanup query must target every remaining user challenge: %s", state.cleanupQuery)
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
