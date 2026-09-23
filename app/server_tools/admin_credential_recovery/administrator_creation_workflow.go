// administrator_creation_workflow.go
// Guides an operator through creating one new administrator when no usable administrator is left.
// Bridges the protected terminal with the shared administrator creation boundary and its safety gates.
// Exists so a restored or rebuilt site has an explicit escape hatch that cannot be entered by accident.
package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"easelect/backend/core_components/auth/credentials"
)

// additionalAdministratorConfirmation is typed only when the installation already has an administrator.
const additionalAdministratorConfirmation = "CREATE ANOTHER ADMINISTRATOR"

type administratorCreationOperations interface {
	ReadInstanceIdentity(context.Context) (credentials.InstanceIdentity, error)
	ListEligibleAdministrators(context.Context) ([]credentials.Administrator, error)
	CreateAdministrator(context.Context, credentials.AdministratorCreationInput) (credentials.AdministratorCreationResult, error)
}

// administratorCreationSettings carries the non-secret run context the workflow was started with.
type administratorCreationSettings struct {
	siteDomain              string
	dryRun                  bool
	emailDeliveryConfigured bool
	operatorReference       string
}

// executeAdministratorCreationWorkflow states the target and the account before any change, gathers the
// operator's decisions, and carries the reviewed snapshot into the single atomic creation call.
// Dry run stays read-only, and every secret is entered in the protected terminal and never printed.
func executeAdministratorCreationWorkflow(
	ctx context.Context,
	terminal operatorTerminal,
	operations administratorCreationOperations,
	settings administratorCreationSettings,
) error {
	if strings.TrimSpace(settings.siteDomain) == "" {
		return errors.New("site domain is required for administrator creation target confirmation")
	}
	if strings.TrimSpace(settings.operatorReference) == "" {
		return errors.New("an operator reference is required for administrator creation evidence")
	}
	identity, err := operations.ReadInstanceIdentity(ctx)
	if err != nil {
		return err
	}
	terminal.Printf("Mode: create a NEW administrator account. This mode never changes an existing account.\n")
	printTargetIdentity(terminal, settings.siteDomain, identity)
	terminal.Printf("  Operator: %s\n", settings.operatorReference)
	if !credentials.DatabaseVersionAtLeast(identity.DatabaseVersion, credentials.MinimumRecoveryDatabaseVersion) {
		return credentials.ErrRecoveryDatabaseVersionUnsupported
	}

	administrators, err := operations.ListEligibleAdministrators(ctx)
	if err != nil {
		return err
	}
	printExistingAdministrators(terminal, administrators)
	if settings.dryRun {
		terminal.Printf("Dry run complete. No account was created.\n")
		return nil
	}

	input := credentials.AdministratorCreationInput{
		ObservedAdministratorCount: len(administrators),
		EmailDeliveryReady:         settings.emailDeliveryConfigured,
		OperatorReference:          settings.operatorReference,
		TargetIdentity:             identity,
	}
	if len(administrators) > 0 {
		if err = confirmAdditionalAdministrator(terminal); err != nil {
			return err
		}
		input.AcknowledgedExistingAdministrators = true
	}

	if input.Username, err = readNewAdministratorUsername(terminal); err != nil {
		return err
	}
	if input.Email, err = readNewAdministratorEmail(terminal); err != nil {
		return err
	}
	if err = applyCreationFactorChoice(terminal, &input, settings.emailDeliveryConfigured); err != nil {
		return err
	}

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

	terminal.Printf(
		"About to create administrator %s with email %s and login verification %s in database %s on %s.\n",
		input.Username,
		input.Email,
		input.VerificationMethod,
		displayIdentityValue(identity.DatabaseName),
		displayIdentityValue(settings.siteDomain),
	)
	confirmation := identityConfirmationToken(settings.siteDomain, identity) + ":" + input.Username
	terminal.Printf("Final target confirmation: %s\n", confirmation)
	terminal.Printf("This is not a filesystem path or password; it identifies the exact domain, site, project, database, and the new administrator account being created.\n")
	typedConfirmation, err := terminal.ReadLine("Type the final target confirmation exactly: ")
	if err != nil {
		return err
	}
	if typedConfirmation != confirmation {
		return errors.New("target confirmation did not match; no account was created")
	}

	result, err := operations.CreateAdministrator(ctx, input)
	if err != nil {
		return err
	}
	terminal.Printf(
		"Administrator created: %s (user id %d, verification=%s, authentication generation=%d). The account is in the admins group and may sign in now.\n",
		result.Username,
		result.UserID,
		result.VerificationMethod,
		result.AuthenticationGeneration,
	)
	if result.ClosedFirstRunBrowserForm {
		terminal.Printf("The one-time first-run browser setup form was still open and is now closed.\n")
	}
	return nil
}

// printExistingAdministrators states plainly whether the ordinary restore path is still available.
// Multiplying administrators is the exception, so the restore path is named before the operator continues.
func printExistingAdministrators(terminal operatorTerminal, administrators []credentials.Administrator) {
	if len(administrators) == 0 {
		terminal.Printf("This installation has no eligible administrator. Creating the first usable administrator account.\n")
		return
	}
	terminal.Printf("This installation already has %d eligible active administrator(s):\n", len(administrators))
	for index, administrator := range administrators {
		terminal.Printf(
			"  %d) %s (current verification: %s, authentication generation: %d)\n",
			index+1,
			administrator.Username,
			administrator.VerificationMethod,
			administrator.AuthenticationGeneration,
		)
	}
	terminal.Printf("The ordinary repair path is to restore one of these accounts by running this command without --create-admin.\n")
}

func confirmAdditionalAdministrator(terminal operatorTerminal) error {
	terminal.Printf("WARNING: creating another administrator adds a second account with full administrative access.\n")
	confirmation, err := terminal.ReadLine(
		fmt.Sprintf("Type %q to create another administrator anyway: ", additionalAdministratorConfirmation),
	)
	if err != nil {
		return err
	}
	if confirmation != additionalAdministratorConfirmation {
		return credentials.ErrExistingAdministratorConfirmationRequired
	}
	return nil
}

func readNewAdministratorUsername(terminal operatorTerminal) (string, error) {
	username, err := terminal.ReadLine("New administrator account name: ")
	if err != nil {
		return "", err
	}
	if err = credentials.ValidateAdministratorUsername(username); err != nil {
		return "", err
	}
	return username, nil
}

func readNewAdministratorEmail(terminal operatorTerminal) (string, error) {
	email, err := terminal.ReadLine("New administrator email address: ")
	if err != nil {
		return "", err
	}
	if err = credentials.ValidateAdministratorEmail(email); err != nil {
		return "", err
	}
	return email, nil
}

// applyCreationFactorChoice translates one explicit selection into gated input for the new account.
// It never provisions TOTP and asks for a fixed PIN only when the operator selects a fixed PIN.
func applyCreationFactorChoice(
	terminal operatorTerminal,
	input *credentials.AdministratorCreationInput,
	emailDeliveryConfigured bool,
) error {
	terminal.Printf("Choose the login verification method for the new administrator:\n")
	terminal.Printf("  1) Set a fixed PIN\n")
	emailAvailable := emailDeliveryConfigured && credentials.EmailAddressLooksDeliverable(input.Email)
	if emailAvailable {
		terminal.Printf("  2) Use email verification (delivery configuration and account email are ready)\n")
	} else {
		terminal.Printf("  2) Email verification unavailable (delivery configuration or account email is not ready)\n")
	}
	terminal.Printf("  3) Password only (WARNING: removes the second sign-in step)\n")
	terminal.Printf("  New TOTP enrollment is not supported by this command.\n")

	selection, err := terminal.ReadLine("Verification choice: ")
	if err != nil {
		return err
	}
	switch selection {
	case "1":
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
			return err
		}
	case "2":
		if !emailAvailable {
			return credentials.ErrEmailVerificationUnavailable
		}
		input.VerificationMethod = credentials.VerificationEmail
	case "3":
		if err = confirmPasswordOnlySignIn(terminal); err != nil {
			return err
		}
		input.VerificationMethod = credentials.VerificationNone
		input.AllowPasswordOnly = true
	default:
		return errors.New("verification choice is invalid")
	}
	return nil
}
