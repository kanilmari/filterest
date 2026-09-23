// administrator_creation_workflow_test.go
// Verifies the protected terminal's administrator creation choices without a database or a real TTY.
// Bridges scripted operator input with a fake shared creation boundary and captured output.
// Exists so mode separation, the existing-administrator warning, and secret handling stay enforceable.
package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"easelect/backend/core_components/auth/credentials"
)

const testConfirmationToken = "filterest.com/Filterest/filterest/filterest"

type fakeAdministratorCreationOperations struct {
	identity       credentials.InstanceIdentity
	administrators []credentials.Administrator
	receivedInput  *credentials.AdministratorCreationInput
	result         credentials.AdministratorCreationResult
	createError    error
}

func (operations *fakeAdministratorCreationOperations) ReadInstanceIdentity(context.Context) (credentials.InstanceIdentity, error) {
	return operations.identity, nil
}

func (operations *fakeAdministratorCreationOperations) ListEligibleAdministrators(context.Context) ([]credentials.Administrator, error) {
	return operations.administrators, nil
}

func (operations *fakeAdministratorCreationOperations) RecoverAdministrator(
	_ context.Context,
	_ credentials.RecoveryInput,
) (credentials.RecoveryResult, error) {
	return credentials.RecoveryResult{UserID: 42, Username: "admin_filterest", AuthenticationGeneration: 7}, nil
}

func (operations *fakeAdministratorCreationOperations) CreateAdministrator(
	_ context.Context,
	input credentials.AdministratorCreationInput,
) (credentials.AdministratorCreationResult, error) {
	operations.receivedInput = &input
	if operations.createError != nil {
		return credentials.AdministratorCreationResult{}, operations.createError
	}
	return operations.result, nil
}

func testCreationOperations(administrators ...credentials.Administrator) *fakeAdministratorCreationOperations {
	return &fakeAdministratorCreationOperations{
		identity: credentials.InstanceIdentity{
			DatabaseName:    "filterest",
			DatabaseVersion: "9.8.1",
			SiteName:        "Filterest",
			CurrentProject:  "filterest",
			InstanceKind:    "filterest_domain",
			InstanceRole:    "application",
		},
		administrators: administrators,
		result: credentials.AdministratorCreationResult{
			UserID:                    10007,
			Username:                  "recovery_operator_admin",
			Email:                     "operator@example.com",
			VerificationMethod:        credentials.VerificationFixedPIN,
			AuthenticationGeneration:  1,
			ClosedFirstRunBrowserForm: true,
		},
	}
}

func testCreationSettings(dryRun bool, emailDeliveryConfigured bool) administratorCreationSettings {
	return administratorCreationSettings{
		siteDomain:              "filterest.com",
		dryRun:                  dryRun,
		emailDeliveryConfigured: emailDeliveryConfigured,
		operatorReference:       "root@app-container (pid 7)",
	}
}

func existingAdministrator() credentials.Administrator {
	return credentials.Administrator{
		ID:                       42,
		Username:                 "admin_filterest",
		VerificationMethod:       credentials.VerificationFixedPIN,
		Email:                    "owner@filterest.com",
		AuthenticationGeneration: 6,
	}
}

func TestCreationModeIsReachedOnlyByItsOwnFlag(t *testing.T) {
	values := map[string]string{"BASE_URL": "https://filterest.com"}
	lookupEnv := func(key string) string { return values[key] }

	restoreConfig, err := parseCommandConfig(nil, lookupEnv)
	if err != nil {
		t.Fatalf("parseCommandConfig() error = %v", err)
	}
	if restoreConfig.createAdministrator {
		t.Fatal("the default run selected administrator creation")
	}
	creationConfig, err := parseCommandConfig([]string{"--create-admin"}, lookupEnv)
	if err != nil {
		t.Fatalf("parseCommandConfig(--create-admin) error = %v", err)
	}
	if !creationConfig.createAdministrator {
		t.Fatal("the explicit flag did not select administrator creation")
	}

	// The restore workflow is offered the creation boundary too, and must never reach it.
	operations := testCreationOperations(existingAdministrator())
	terminal := &fakeOperatorTerminal{
		lines:   []string{"1", "1", testConfirmationToken + ":admin_filterest"},
		secrets: []string{"correct horse battery staple", "correct horse battery staple"},
	}
	if err = executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, false); err != nil {
		t.Fatalf("executeRecoveryWorkflow() error = %v", err)
	}
	if operations.receivedInput != nil {
		t.Fatalf("the restore workflow created an account: %+v", *operations.receivedInput)
	}
}

func TestCreationDryRunNamesTheTargetAndCreatesNothing(t *testing.T) {
	operations := testCreationOperations()
	terminal := &fakeOperatorTerminal{}

	if err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(true, false),
	); err != nil {
		t.Fatalf("executeAdministratorCreationWorkflow(dry-run) error = %v", err)
	}
	if operations.receivedInput != nil {
		t.Fatalf("dry run created an account: %+v", *operations.receivedInput)
	}
	if len(terminal.secretPrompts) != 0 {
		t.Fatalf("dry run secret prompts = %#v", terminal.secretPrompts)
	}
	for _, expected := range []string{
		"Mode: create a NEW administrator account.",
		"Site domain: filterest.com",
		"Database: filterest",
		"Database version: 9.8.1",
		"Site: Filterest",
		"Current project: filterest",
		"Operator: root@app-container (pid 7)",
		"This installation has no eligible administrator.",
		"Dry run complete. No account was created.",
	} {
		if !strings.Contains(terminal.output.String(), expected) {
			t.Fatalf("dry-run output missing %q:\n%s", expected, terminal.output.String())
		}
	}
}

func TestCreationWithoutAnyAdministratorAsksNoExtraConfirmationAndKeepsSecretsHidden(t *testing.T) {
	operations := testCreationOperations()
	terminal := &fakeOperatorTerminal{
		lines: []string{
			"recovery_operator_admin",
			"operator@example.com",
			"1",
			testConfirmationToken + ":recovery_operator_admin",
		},
		secrets: []string{"246810", "246810", "correct horse battery staple", "correct horse battery staple"},
	}

	if err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	); err != nil {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v", err)
	}
	if operations.receivedInput == nil {
		t.Fatal("the workflow did not reach the creation boundary")
	}
	input := *operations.receivedInput
	if input.Username != "recovery_operator_admin" || input.Email != "operator@example.com" {
		t.Fatalf("creation identity = %q/%q", input.Username, input.Email)
	}
	if input.VerificationMethod != credentials.VerificationFixedPIN || input.FixedPIN != "246810" {
		t.Fatalf("creation factor = %q/%q", input.VerificationMethod, input.FixedPIN)
	}
	if input.AcknowledgedExistingAdministrators || input.ObservedAdministratorCount != 0 {
		t.Fatalf("creation snapshot = %+v, want no prior administrator and no acknowledgement", input)
	}
	if input.OperatorReference != "root@app-container (pid 7)" || input.TargetIdentity != operations.identity {
		t.Fatalf("creation evidence = %+v", input)
	}
	if len(terminal.secretPrompts) != 4 {
		t.Fatalf("secret prompt count = %d, want PIN twice and password twice", len(terminal.secretPrompts))
	}
	for _, secret := range []string{"246810", "correct horse battery staple"} {
		if strings.Contains(terminal.output.String(), secret) {
			t.Fatalf("secret %q leaked into terminal output", secret)
		}
	}
	for _, expected := range []string{
		"About to create administrator recovery_operator_admin with email operator@example.com",
		"Final target confirmation: " + testConfirmationToken + ":recovery_operator_admin",
		"not a filesystem path or password",
		"Administrator created: recovery_operator_admin (user id 10007",
		"The one-time first-run browser setup form was still open and is now closed.",
	} {
		if !strings.Contains(terminal.output.String(), expected) {
			t.Fatalf("creation output missing %q:\n%s", expected, terminal.output.String())
		}
	}
}

func TestCreationRefusesAnotherAdministratorWithoutTheTypedConfirmation(t *testing.T) {
	operations := testCreationOperations(existingAdministrator())
	terminal := &fakeOperatorTerminal{lines: []string{"not confirmed"}}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	)
	if !errors.Is(err, credentials.ErrExistingAdministratorConfirmationRequired) {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want explicit confirmation", err)
	}
	if operations.receivedInput != nil {
		t.Fatal("an unconfirmed second administrator reached the creation boundary")
	}
	if len(terminal.secretPrompts) != 0 {
		t.Fatalf("an unconfirmed attempt asked for secrets: %#v", terminal.secretPrompts)
	}
	for _, expected := range []string{
		"This installation already has 1 eligible active administrator(s):",
		"admin_filterest (current verification: fixed_pin, authentication generation: 6)",
		"restore one of these accounts by running this command without --create-admin",
		"WARNING: creating another administrator",
	} {
		if !strings.Contains(terminal.output.String(), expected) {
			t.Fatalf("existing-administrator warning missing %q:\n%s", expected, terminal.output.String())
		}
	}
}

func TestCreationCarriesTheAcknowledgedSnapshotWhenAnAdministratorExists(t *testing.T) {
	operations := testCreationOperations(existingAdministrator())
	terminal := &fakeOperatorTerminal{
		lines: []string{
			additionalAdministratorConfirmation,
			"recovery_operator_admin",
			"operator@example.com",
			"1",
			testConfirmationToken + ":recovery_operator_admin",
		},
		secrets: []string{"246810", "246810", "correct horse battery staple", "correct horse battery staple"},
	}

	if err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	); err != nil {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v", err)
	}
	if operations.receivedInput == nil ||
		!operations.receivedInput.AcknowledgedExistingAdministrators ||
		operations.receivedInput.ObservedAdministratorCount != 1 {
		t.Fatalf("creation snapshot = %+v, want the reviewed count and the acknowledgement", operations.receivedInput)
	}
}

func TestCreationRefusesAnInvalidAccountNameBeforeAnySecretPrompt(t *testing.T) {
	operations := testCreationOperations()
	terminal := &fakeOperatorTerminal{lines: []string{"-not a valid name"}}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	)
	if !errors.Is(err, credentials.ErrInvalidAdministratorUsername) {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want an invalid account name", err)
	}
	if len(terminal.secretPrompts) != 0 || operations.receivedInput != nil {
		t.Fatalf("an invalid account name reached secrets or creation: prompts=%#v input=%+v",
			terminal.secretPrompts, operations.receivedInput)
	}
}

func TestCreationRefusesEmailVerificationThatCannotBeDelivered(t *testing.T) {
	operations := testCreationOperations()
	terminal := &fakeOperatorTerminal{
		lines: []string{"recovery_operator_admin", "operator@example.com", "2"},
	}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	)
	if !errors.Is(err, credentials.ErrEmailVerificationUnavailable) {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want email unavailable", err)
	}
	if operations.receivedInput != nil {
		t.Fatal("an undeliverable email factor reached the creation boundary")
	}
	if !strings.Contains(terminal.output.String(), "Email verification unavailable") {
		t.Fatalf("email readiness reason missing:\n%s", terminal.output.String())
	}
}

func TestCreationRefusesPasswordOnlyWithoutItsOwnConfirmation(t *testing.T) {
	operations := testCreationOperations()
	terminal := &fakeOperatorTerminal{
		lines: []string{"recovery_operator_admin", "operator@example.com", "3", "not confirmed"},
	}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	)
	if !errors.Is(err, credentials.ErrPasswordOnlyConfirmationRequired) {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want password-only confirmation", err)
	}
	if operations.receivedInput != nil {
		t.Fatal("an unconfirmed password-only account reached the creation boundary")
	}
	if !strings.Contains(terminal.output.String(), "WARNING: password-only sign-in") {
		t.Fatalf("password-only warning missing:\n%s", terminal.output.String())
	}
}

func TestCreationStopsWhenTheFinalTargetConfirmationDoesNotMatch(t *testing.T) {
	operations := testCreationOperations()
	terminal := &fakeOperatorTerminal{
		lines: []string{
			"recovery_operator_admin",
			"operator@example.com",
			"1",
			testConfirmationToken + ":a_different_admin",
		},
		secrets: []string{"246810", "246810", "correct horse battery staple", "correct horse battery staple"},
	}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	)
	if err == nil || !strings.Contains(err.Error(), "no account was created") {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want a mismatched target confirmation", err)
	}
	if operations.receivedInput != nil {
		t.Fatal("a mismatched target confirmation still created an account")
	}
}

func TestCreationRefusesADatabaseBeforeTheSupportedRelease(t *testing.T) {
	operations := testCreationOperations()
	operations.identity.DatabaseVersion = "9.6.1"
	terminal := &fakeOperatorTerminal{}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(true, false),
	)
	if !errors.Is(err, credentials.ErrRecoveryDatabaseVersionUnsupported) {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want unsupported database version", err)
	}
	if operations.receivedInput != nil || len(terminal.secretPrompts) != 0 {
		t.Fatalf("unsupported database touched creation or secrets: input=%+v prompts=%#v",
			operations.receivedInput, terminal.secretPrompts)
	}
}

func TestCreationSurfacesADuplicateRefusalFromTheSharedBoundary(t *testing.T) {
	operations := testCreationOperations()
	operations.createError = credentials.ErrAdministratorUsernameTaken
	terminal := &fakeOperatorTerminal{
		lines: []string{
			"recovery_operator_admin",
			"operator@example.com",
			"1",
			testConfirmationToken + ":recovery_operator_admin",
		},
		secrets: []string{"246810", "246810", "correct horse battery staple", "correct horse battery staple"},
	}

	err := executeAdministratorCreationWorkflow(
		context.Background(), terminal, operations, testCreationSettings(false, false),
	)
	if !errors.Is(err, credentials.ErrAdministratorUsernameTaken) {
		t.Fatalf("executeAdministratorCreationWorkflow() error = %v, want the duplicate refusal", err)
	}
	if strings.Contains(terminal.output.String(), "Administrator created") {
		t.Fatalf("a refused creation reported success:\n%s", terminal.output.String())
	}
}
