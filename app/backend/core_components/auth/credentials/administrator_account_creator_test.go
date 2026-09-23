// administrator_account_creator_test.go
// Verifies the shared administrator name and address rules the browser form and the operator command share.
// Bridges the exported validators with the exact boundaries both creation paths depend on.
// Exists so tightening or loosening one path's rule cannot silently diverge from the other's.
package credentials

import (
	"strings"
	"testing"
)

func TestValidateAdministratorUsernameHoldsTheSharedAccountNameShape(t *testing.T) {
	for _, accepted := range []string{"abc", "owner.admin", "admin_filterest", "A1-b_c.d", strings.Repeat("a", 64)} {
		if err := ValidateAdministratorUsername(accepted); err != nil {
			t.Fatalf("ValidateAdministratorUsername(%q) error = %v, want accepted", accepted, err)
		}
	}
	for _, refused := range []string{
		"", "ab", "_leading", "-leading", ".leading", "has space", "has/slash",
		"has@at", "ääkkösiä", strings.Repeat("a", 65),
	} {
		if err := ValidateAdministratorUsername(refused); err != ErrInvalidAdministratorUsername {
			t.Fatalf("ValidateAdministratorUsername(%q) error = %v, want refusal", refused, err)
		}
	}
}

func TestValidateAdministratorEmailAcceptsOneBareAddressOnly(t *testing.T) {
	for _, accepted := range []string{"owner@example.com", "operator.one+tag@sub.example.org"} {
		if err := ValidateAdministratorEmail(accepted); err != nil {
			t.Fatalf("ValidateAdministratorEmail(%q) error = %v, want accepted", accepted, err)
		}
	}
	for _, refused := range []string{
		"", "owner", "owner@", "@example.com",
		"Owner <owner@example.com>", "one@example.com, two@example.com",
	} {
		if err := ValidateAdministratorEmail(refused); err != ErrInvalidAdministratorEmail {
			t.Fatalf("ValidateAdministratorEmail(%q) error = %v, want refusal", refused, err)
		}
	}
}

func TestCreateAdministratorAccountRefusesWithoutAnOpenTransaction(t *testing.T) {
	if _, err := CreateAdministratorAccount(t.Context(), nil, AdministratorAccountInput{
		Username: "owner_admin", Email: "owner@example.com",
		Password: "correct horse battery staple", VerificationMethod: VerificationNone,
		CreationSpec: "test",
	}); err == nil {
		t.Fatal("administrator creation without a transaction unexpectedly succeeded")
	}
}
