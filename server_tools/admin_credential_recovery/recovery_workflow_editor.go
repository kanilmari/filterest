// recovery_workflow_editor.go
// Guides an operator through target readback, administrator selection, and credential confirmation.
// Bridges protected terminal input with the shared credential recovery editor and its safety decisions.
// Exists so recovery remains explicit, reviewable, and incapable of silently weakening login verification.
package main

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"easelect/backend/core_components/auth/credentials"
)

const passwordOnlyConfirmation = "PASSWORD ONLY"

type recoveryOperations interface {
	ReadInstanceIdentity(context.Context) (credentials.InstanceIdentity, error)
	ListEligibleAdministrators(context.Context) ([]credentials.Administrator, error)
	RecoverAdministrator(context.Context, credentials.RecoveryInput) (credentials.RecoveryResult, error)
}

// executeRecoveryWorkflow carries the reviewed identity and credential snapshot into the atomic editor call.
// It keeps dry-run read-only and requires all secret and downgrade confirmations before mutation.
func executeRecoveryWorkflow(
	ctx context.Context,
	terminal operatorTerminal,
	operations recoveryOperations,
	siteDomain string,
	dryRun bool,
	emailDeliveryConfigured bool,
) error {
	if strings.TrimSpace(siteDomain) == "" {
		return errors.New("site domain is required for administrator recovery target confirmation")
	}
	identity, err := operations.ReadInstanceIdentity(ctx)
	if err != nil {
		return err
	}
	printTargetIdentity(terminal, siteDomain, identity)
	if !credentials.DatabaseVersionAtLeast(identity.DatabaseVersion, credentials.MinimumRecoveryDatabaseVersion) {
		return credentials.ErrRecoveryDatabaseVersionUnsupported
	}

	administrators, err := operations.ListEligibleAdministrators(ctx)
	if err != nil {
		return err
	}
	if len(administrators) == 0 {
		return credentials.ErrAdministratorNotFound
	}
	terminal.Printf("Eligible active administrators:\n")
	for index, administrator := range administrators {
		terminal.Printf(
			"  %d) %s (current verification: %s, authentication generation: %d)\n",
			index+1,
			administrator.Username,
			administrator.VerificationMethod,
			administrator.AuthenticationGeneration,
		)
	}
	if dryRun {
		terminal.Printf("Dry run complete. No credential data was changed.\n")
		return nil
	}

	administrator, err := selectAdministrator(terminal, administrators)
	if err != nil {
		return err
	}
	terminal.Printf("Selected administrator: %s\n", administrator.Username)
	terminal.Printf("Current login verification method: %s\n", administrator.VerificationMethod)

	input, err := readRecoveryFactorChoice(terminal, administrator, emailDeliveryConfigured)
	if err != nil {
		return err
	}
	input.UserID = administrator.ID
	input.EmailDeliveryReady = emailDeliveryConfigured
	input.ExpectedAuthenticationGeneration = administrator.AuthenticationGeneration
	input.ExpectedVerificationMethod = administrator.VerificationMethod
	input.TargetIdentity = identity

	input.NewPassword, err = readConfirmedSecret(
		terminal,
		"New administrator password: ",
		"Repeat new administrator password: ",
		"password entries do not match",
	)
	if err != nil {
		return err
	}
	if err = credentials.ValidatePassword(input.NewPassword); err != nil {
		return err
	}

	confirmation := identityConfirmationToken(siteDomain, identity) + ":" + administrator.Username
	terminal.Printf("Final target confirmation: %s\n", confirmation)
	terminal.Printf("This is not a filesystem path or password; it identifies the exact domain, site, project, database, and administrator account being recovered.\n")
	typedConfirmation, err := terminal.ReadLine("Type the final target confirmation exactly: ")
	if err != nil {
		return err
	}
	if typedConfirmation != confirmation {
		return errors.New("target confirmation did not match; no credentials were changed")
	}

	result, err := operations.RecoverAdministrator(ctx, input)
	if err != nil {
		return err
	}
	terminal.Printf(
		"Recovery committed for %s: verification=%s authentication_generation=%d. Existing sessions are invalid after generation enforcement.\n",
		result.Username,
		result.VerificationMethod,
		result.AuthenticationGeneration,
	)
	return nil
}

func printTargetIdentity(terminal operatorTerminal, siteDomain string, identity credentials.InstanceIdentity) {
	terminal.Printf("Database identity readback:\n")
	terminal.Printf("  Site domain: %s\n", displayIdentityValue(siteDomain))
	terminal.Printf("  Database: %s\n", displayIdentityValue(identity.DatabaseName))
	terminal.Printf("  Database version: %s\n", displayIdentityValue(identity.DatabaseVersion))
	terminal.Printf("  Site: %s\n", displayIdentityValue(identity.SiteName))
	terminal.Printf("  Current project: %s\n", displayIdentityValue(identity.CurrentProject))
	terminal.Printf("  Instance kind: %s\n", displayIdentityValue(identity.InstanceKind))
	terminal.Printf("  Instance role: %s\n", displayIdentityValue(identity.InstanceRole))
}

func displayIdentityValue(value string) string {
	if strings.TrimSpace(value) == "" {
		return "(not configured)"
	}
	return value
}

func identityConfirmationToken(siteDomain string, identity credentials.InstanceIdentity) string {
	components := make([]string, 0, 4)
	if cleanDomain := strings.TrimSpace(siteDomain); cleanDomain != "" {
		components = append(components, cleanDomain)
	}
	for _, value := range []string{identity.SiteName, identity.CurrentProject, identity.DatabaseName} {
		if cleanValue := strings.TrimSpace(value); cleanValue != "" {
			components = append(components, cleanValue)
		}
	}
	if len(components) == 0 {
		return "UNIDENTIFIED-DATABASE"
	}
	return strings.Join(components, "/")
}

func selectAdministrator(terminal operatorTerminal, administrators []credentials.Administrator) (credentials.Administrator, error) {
	selection, err := terminal.ReadLine("Select administrator number: ")
	if err != nil {
		return credentials.Administrator{}, err
	}
	index, err := strconv.Atoi(selection)
	if err != nil || index < 1 || index > len(administrators) {
		return credentials.Administrator{}, errors.New("administrator selection is invalid")
	}
	return administrators[index-1], nil
}

// readRecoveryFactorChoice shows the current method and translates one explicit selection into gated input.
// It never provisions TOTP and asks for a fixed PIN only when the operator selects a new fixed PIN.
func readRecoveryFactorChoice(
	terminal operatorTerminal,
	administrator credentials.Administrator,
	emailDeliveryConfigured bool,
) (credentials.RecoveryInput, error) {
	terminal.Printf("Choose the login verification method after recovery:\n")
	terminal.Printf("  1) Preserve current method (%s)\n", administrator.VerificationMethod)
	terminal.Printf("  2) Set a new fixed PIN\n")
	emailAvailable := emailDeliveryConfigured && credentials.EmailAddressLooksDeliverable(administrator.Email)
	if emailAvailable {
		terminal.Printf("  3) Use email verification (delivery configuration and account email are ready)\n")
	} else {
		terminal.Printf("  3) Email verification unavailable (delivery configuration or account email is not ready)\n")
	}
	terminal.Printf("  4) Password only (WARNING: removes the second sign-in step)\n")
	if administrator.VerificationMethod == credentials.VerificationTOTP {
		terminal.Printf("  TOTP can be preserved, but new TOTP enrollment is not supported by this recovery command.\n")
	}

	selection, err := terminal.ReadLine("Verification choice: ")
	if err != nil {
		return credentials.RecoveryInput{}, err
	}
	input := credentials.RecoveryInput{}
	switch selection {
	case "1":
		input.PreserveCurrentVerification = true
		switch administrator.VerificationMethod {
		case credentials.VerificationEmail:
			if !emailAvailable {
				return credentials.RecoveryInput{}, credentials.ErrEmailVerificationUnavailable
			}
		case credentials.VerificationNone:
			if err = confirmPasswordOnlySignIn(terminal); err != nil {
				return credentials.RecoveryInput{}, err
			}
			input.AllowPasswordOnly = true
		}
	case "2":
		input.VerificationMethod = credentials.VerificationFixedPIN
		input.FixedPIN, err = readConfirmedSecret(
			terminal,
			"New fixed PIN (4-8 digits): ",
			"Repeat new fixed PIN: ",
			"fixed PIN entries do not match",
		)
		if err == nil {
			err = credentials.ValidateFixedPIN(input.FixedPIN)
		}
		if err != nil {
			return credentials.RecoveryInput{}, err
		}
	case "3":
		if !emailAvailable {
			return credentials.RecoveryInput{}, credentials.ErrEmailVerificationUnavailable
		}
		input.VerificationMethod = credentials.VerificationEmail
	case "4":
		if err = confirmPasswordOnlySignIn(terminal); err != nil {
			return credentials.RecoveryInput{}, err
		}
		input.VerificationMethod = credentials.VerificationNone
		input.AllowPasswordOnly = true
	default:
		return credentials.RecoveryInput{}, errors.New("verification choice is invalid")
	}
	return input, nil
}

func confirmPasswordOnlySignIn(terminal operatorTerminal) error {
	terminal.Printf("WARNING: password-only sign-in has no PIN, email code, or authenticator-code step.\n")
	confirmation, err := terminal.ReadLine(fmt.Sprintf("Type %q to allow password-only sign-in: ", passwordOnlyConfirmation))
	if err != nil {
		return err
	}
	if confirmation != passwordOnlyConfirmation {
		return credentials.ErrPasswordOnlyConfirmationRequired
	}
	return nil
}

func readConfirmedSecret(
	terminal operatorTerminal,
	firstPrompt string,
	secondPrompt string,
	mismatchMessage string,
) (string, error) {
	firstValue, err := terminal.ReadSecret(firstPrompt)
	if err != nil {
		return "", err
	}
	secondValue, err := terminal.ReadSecret(secondPrompt)
	if err != nil {
		return "", err
	}
	if firstValue != secondValue {
		return "", errors.New(mismatchMessage)
	}
	return firstValue, nil
}
