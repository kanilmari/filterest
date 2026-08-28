// main_test.go
// Verifies protected CLI recovery choices without opening a terminal or database connection.
// Bridges scripted operator input with a fake shared recovery boundary and captured output.
// Exists so dry-run, TOTP preservation, factor selection, and explicit downgrade warnings stay enforceable.
package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"easelect/backend/core_components/auth/credentials"
)

type fakeOperatorTerminal struct {
	lines         []string
	secrets       []string
	output        strings.Builder
	secretPrompts []string
}

func (terminal *fakeOperatorTerminal) Printf(format string, values ...interface{}) {
	_, _ = fmt.Fprintf(&terminal.output, format, values...)
}

func (terminal *fakeOperatorTerminal) ReadLine(prompt string) (string, error) {
	terminal.Printf("%s", prompt)
	if len(terminal.lines) == 0 {
		return "", errors.New("no scripted visible input remains")
	}
	value := terminal.lines[0]
	terminal.lines = terminal.lines[1:]
	return value, nil
}

func (terminal *fakeOperatorTerminal) ReadSecret(prompt string) (string, error) {
	terminal.secretPrompts = append(terminal.secretPrompts, prompt)
	terminal.Printf("%s", prompt)
	if len(terminal.secrets) == 0 {
		return "", errors.New("no scripted secret input remains")
	}
	value := terminal.secrets[0]
	terminal.secrets = terminal.secrets[1:]
	return value, nil
}

func (terminal *fakeOperatorTerminal) Close() error { return nil }

type fakeRecoveryOperations struct {
	identity       credentials.InstanceIdentity
	administrators []credentials.Administrator
	receivedInput  *credentials.RecoveryInput
	result         credentials.RecoveryResult
}

func (operations *fakeRecoveryOperations) ReadInstanceIdentity(context.Context) (credentials.InstanceIdentity, error) {
	return operations.identity, nil
}

func (operations *fakeRecoveryOperations) ListEligibleAdministrators(context.Context) ([]credentials.Administrator, error) {
	return operations.administrators, nil
}

func (operations *fakeRecoveryOperations) RecoverAdministrator(
	_ context.Context,
	input credentials.RecoveryInput,
) (credentials.RecoveryResult, error) {
	operations.receivedInput = &input
	return operations.result, nil
}

func testWorkflowOperations(method credentials.VerificationMethod) *fakeRecoveryOperations {
	return &fakeRecoveryOperations{
		identity: credentials.InstanceIdentity{
			DatabaseName:    "filterest",
			DatabaseVersion: "9.6.2",
			SiteName:        "Filterest",
			CurrentProject:  "filterest",
			InstanceKind:    "filterest_domain",
			InstanceRole:    "application",
		},
		administrators: []credentials.Administrator{{
			ID:                       42,
			Username:                 "admin_filterest",
			VerificationMethod:       method,
			Email:                    "owner@filterest.com",
			AuthenticationGeneration: 6,
		}},
		result: credentials.RecoveryResult{
			UserID:                   42,
			Username:                 "admin_filterest",
			VerificationMethod:       method,
			AuthenticationGeneration: 7,
		},
	}
}

func TestDryRunPrintsIdentityAndEligibleAdministratorsWithoutSecretPrompts(t *testing.T) {
	operations := testWorkflowOperations(credentials.VerificationFixedPIN)
	terminal := &fakeOperatorTerminal{}

	if err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", true, false); err != nil {
		t.Fatalf("executeRecoveryWorkflow(dry-run) error = %v", err)
	}
	if operations.receivedInput != nil {
		t.Fatalf("dry-run unexpectedly called recovery with %+v", *operations.receivedInput)
	}
	if len(terminal.secretPrompts) != 0 {
		t.Fatalf("dry-run workflow secret prompts = %#v", terminal.secretPrompts)
	}
	for _, expected := range []string{
		"Site domain: filterest.com",
		"Database: filterest",
		"Database version: 9.6.2",
		"Site: Filterest",
		"Current project: filterest",
		"admin_filterest (current verification: fixed_pin, authentication generation: 6)",
		"Dry run complete. No credential data was changed.",
	} {
		if !strings.Contains(terminal.output.String(), expected) {
			t.Fatalf("dry-run output missing %q:\n%s", expected, terminal.output.String())
		}
	}
}

func TestWorkflowRefusesDatabaseBeforeAuthenticationGenerationRelease(t *testing.T) {
	operations := testWorkflowOperations(credentials.VerificationFixedPIN)
	operations.identity.DatabaseVersion = "9.6.1"
	terminal := &fakeOperatorTerminal{}

	err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", true, false)
	if !errors.Is(err, credentials.ErrRecoveryDatabaseVersionUnsupported) {
		t.Fatalf("executeRecoveryWorkflow() error = %v, want unsupported database version", err)
	}
	if operations.receivedInput != nil || len(terminal.secretPrompts) != 0 {
		t.Fatalf("unsupported database touched recovery input or secrets: input=%+v prompts=%#v", operations.receivedInput, terminal.secretPrompts)
	}
}

func TestWorkflowPreservesCurrentTOTPWithoutRequestingPIN(t *testing.T) {
	operations := testWorkflowOperations(credentials.VerificationTOTP)
	terminal := &fakeOperatorTerminal{
		lines: []string{
			"1",
			"1",
			"filterest.com/Filterest/filterest/filterest:admin_filterest",
		},
		secrets: []string{"correct horse battery staple", "correct horse battery staple"},
	}

	if err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, false); err != nil {
		t.Fatalf("executeRecoveryWorkflow() error = %v", err)
	}
	if operations.receivedInput == nil || !operations.receivedInput.PreserveCurrentVerification {
		t.Fatalf("recovery input = %+v, want current factor preserved", operations.receivedInput)
	}
	if operations.receivedInput.ExpectedAuthenticationGeneration != 6 ||
		operations.receivedInput.ExpectedVerificationMethod != credentials.VerificationTOTP ||
		operations.receivedInput.TargetIdentity != operations.identity {
		t.Fatalf("snapshot/audit context = %+v", operations.receivedInput)
	}
	if operations.receivedInput.FixedPIN != "" {
		t.Fatalf("preserved TOTP unexpectedly received PIN %q", operations.receivedInput.FixedPIN)
	}
	if len(terminal.secretPrompts) != 2 {
		t.Fatalf("secret prompt count = %d, want only password twice", len(terminal.secretPrompts))
	}
	if !strings.Contains(terminal.output.String(), "TOTP can be preserved, but new TOTP enrollment is not supported") {
		t.Fatalf("TOTP limitation missing from output:\n%s", terminal.output.String())
	}
	if strings.Contains(terminal.output.String(), "correct horse battery staple") {
		t.Fatal("password leaked into terminal output")
	}
	if !strings.Contains(terminal.output.String(), "Final target confirmation: filterest.com/Filterest/filterest/filterest:admin_filterest") {
		t.Fatalf("domain-qualified final target confirmation missing:\n%s", terminal.output.String())
	}
	if !strings.Contains(terminal.output.String(), "not a filesystem path or password") {
		t.Fatalf("target confirmation explanation missing:\n%s", terminal.output.String())
	}
}

func TestWorkflowRequestsNewFixedPINTwiceOnlyWhenSelected(t *testing.T) {
	operations := testWorkflowOperations(credentials.VerificationEmail)
	operations.result.VerificationMethod = credentials.VerificationFixedPIN
	terminal := &fakeOperatorTerminal{
		lines: []string{
			"1",
			"2",
			"filterest.com/Filterest/filterest/filterest:admin_filterest",
		},
		secrets: []string{
			"456789", "456789",
			"correct horse battery staple", "correct horse battery staple",
		},
	}

	if err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, true); err != nil {
		t.Fatalf("executeRecoveryWorkflow() error = %v", err)
	}
	if operations.receivedInput == nil || operations.receivedInput.FixedPIN != "456789" {
		t.Fatalf("recovery input = %+v, want selected fixed PIN", operations.receivedInput)
	}
	if operations.receivedInput.VerificationMethod != credentials.VerificationFixedPIN {
		t.Fatalf("verification method = %q", operations.receivedInput.VerificationMethod)
	}
	if len(terminal.secretPrompts) != 4 {
		t.Fatalf("secret prompt count = %d, want PIN twice and password twice", len(terminal.secretPrompts))
	}
	for _, secret := range []string{"456789", "correct horse battery staple"} {
		if strings.Contains(terminal.output.String(), secret) {
			t.Fatalf("secret %q leaked into terminal output", secret)
		}
	}
}

func TestWorkflowRefusesUnavailableEmailVerification(t *testing.T) {
	operations := testWorkflowOperations(credentials.VerificationFixedPIN)
	terminal := &fakeOperatorTerminal{lines: []string{"1", "3"}}

	err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, false)
	if !errors.Is(err, credentials.ErrEmailVerificationUnavailable) {
		t.Fatalf("executeRecoveryWorkflow() error = %v, want email unavailable", err)
	}
	if operations.receivedInput != nil {
		t.Fatal("unavailable email choice must not call recovery")
	}
	if !strings.Contains(terminal.output.String(), "Email verification unavailable") {
		t.Fatalf("email readiness reason missing:\n%s", terminal.output.String())
	}
}

func TestWorkflowRequiresAdditionalPasswordOnlyConfirmation(t *testing.T) {
	operations := testWorkflowOperations(credentials.VerificationFixedPIN)
	terminal := &fakeOperatorTerminal{lines: []string{"1", "4", "not confirmed"}}

	err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, false)
	if !errors.Is(err, credentials.ErrPasswordOnlyConfirmationRequired) {
		t.Fatalf("executeRecoveryWorkflow() error = %v, want explicit password-only confirmation", err)
	}
	if operations.receivedInput != nil {
		t.Fatal("unconfirmed password-only choice must not call recovery")
	}
	if !strings.Contains(terminal.output.String(), "WARNING: password-only sign-in") {
		t.Fatalf("password-only warning missing:\n%s", terminal.output.String())
	}
}

func TestWorkflowPreserveStillEnforcesEmailAndPasswordOnlyGates(t *testing.T) {
	t.Run("email", func(t *testing.T) {
		operations := testWorkflowOperations(credentials.VerificationEmail)
		terminal := &fakeOperatorTerminal{lines: []string{"1", "1"}}
		err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, false)
		if !errors.Is(err, credentials.ErrEmailVerificationUnavailable) {
			t.Fatalf("preserve email error = %v", err)
		}
		if operations.receivedInput != nil {
			t.Fatal("unready preserved email must not call recovery")
		}
	})

	t.Run("password only", func(t *testing.T) {
		operations := testWorkflowOperations(credentials.VerificationNone)
		terminal := &fakeOperatorTerminal{lines: []string{"1", "1", "not confirmed"}}
		err := executeRecoveryWorkflow(context.Background(), terminal, operations, "filterest.com", false, false)
		if !errors.Is(err, credentials.ErrPasswordOnlyConfirmationRequired) {
			t.Fatalf("preserve password-only error = %v", err)
		}
		if operations.receivedInput != nil {
			t.Fatal("unconfirmed preserved password-only method must not call recovery")
		}
	})
}

func TestParseCommandConfigRejectsCredentialPositionalsAndDoesNotReadDatabasePassword(t *testing.T) {
	requestedKeys := make([]string, 0)
	lookupEnv := func(key string) string {
		requestedKeys = append(requestedKeys, key)
		if key == "DB_PASSWORD" || key == "DB_ADMIN_PASSWORD" || key == "PGPASSWORD" {
			return "must-not-be-read"
		}
		return ""
	}

	if _, err := parseCommandConfig([]string{"plaintext-password"}, lookupEnv); err == nil {
		t.Fatal("positional credential input should be rejected")
	}
	for _, key := range requestedKeys {
		if key == "DB_PASSWORD" || key == "DB_ADMIN_PASSWORD" || key == "PGPASSWORD" {
			t.Fatalf("parseCommandConfig read secret environment key %s", key)
		}
	}
}

func TestParseCommandConfigDerivesCanonicalDomainFromProtectedBaseURL(t *testing.T) {
	values := map[string]string{
		"BASE_URL":  "https://FILTEREST.com/",
		"SITE_NAME": "must-not-be-used.example",
	}
	config, err := parseCommandConfig(nil, func(key string) string { return values[key] })
	if err != nil {
		t.Fatalf("parseCommandConfig() error = %v", err)
	}
	if config.siteDomain != "filterest.com" {
		t.Fatalf("site domain = %q, want canonical BASE_URL hostname", config.siteDomain)
	}

	_, err = parseCommandConfig(nil, func(key string) string {
		if key == "SITE_NAME" {
			return "filterest.com"
		}
		return ""
	})
	if err == nil || !strings.Contains(err.Error(), "BASE_URL") {
		t.Fatalf("missing BASE_URL with populated SITE_NAME error = %v, want fail-closed BASE_URL error", err)
	}
}

func TestProtectedBaseURLDomainValidationFailsClosed(t *testing.T) {
	testCases := []struct {
		name    string
		baseURL string
	}{
		{name: "missing", baseURL: ""},
		{name: "remote HTTP", baseURL: "http://filterest.com"},
		{name: "credentials", baseURL: "https://operator@filterest.com"},
		{name: "path", baseURL: "https://filterest.com/admin"},
		{name: "query", baseURL: "https://filterest.com/?target=other"},
		{name: "empty query marker", baseURL: "https://filterest.com?"},
		{name: "fragment", baseURL: "https://filterest.com/#target"},
		{name: "invalid hostname", baseURL: "https://filterest_com"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := siteDomainFromProtectedBaseURL(testCase.baseURL); err == nil {
				t.Fatalf("siteDomainFromProtectedBaseURL(%q) unexpectedly succeeded", testCase.baseURL)
			}
		})
	}

	for _, baseURL := range []string{"https://localhost:8082", "http://127.0.0.1:8082"} {
		domain, err := siteDomainFromProtectedBaseURL(baseURL)
		if err != nil {
			t.Fatalf("siteDomainFromProtectedBaseURL(%q) error = %v", baseURL, err)
		}
		if domain == "" {
			t.Fatalf("siteDomainFromProtectedBaseURL(%q) returned an empty domain", baseURL)
		}
	}
}

func TestResolveRuntimeDatabasePasswordUsesOnlyMatchingAdminRole(t *testing.T) {
	values := map[string]string{
		"DB_ADMIN_USER":     "filterest_admin",
		"DB_ADMIN_PASSWORD": "runtime-secret",
	}
	lookupEnv := func(key string) string { return values[key] }

	password, ok := resolveRuntimeDatabasePassword(commandConfig{dbUser: "filterest_admin"}, lookupEnv)
	if !ok || password != "runtime-secret" {
		t.Fatalf("matching runtime credential = %q/%t", password, ok)
	}
	password, ok = resolveRuntimeDatabasePassword(commandConfig{dbUser: "readeronly"}, lookupEnv)
	if ok || password != "" {
		t.Fatalf("mismatched runtime credential = %q/%t, want prompt fallback", password, ok)
	}
}
