// migration_source_contract_test.go
// Proves offline source descriptions agree with startup's exact directive rules.
// Connects SQL header variants and optional errors to the shared source contract.
// Prevents update verification from approving a different transaction policy.
package migrations

import (
	"crypto/sha256"
	"fmt"
	"testing"
)

func TestDescribeMigrationSource(t *testing.T) {
	for _, test := range []struct{ source, errorPolicy, transactionPolicy string }{
		{"SELECT 1;", "required", "runner"},
		{"-- skip-on-error\nSELECT 1;", "optional", "runner"},
		{" -- skip-on-error\nSELECT 1;", "required", "runner"},
		{"-- header\n/* nested /* inner */ header */\nSTART /* gap */ TRANSACTION;", "required", "self_managed"},
		{"-- skip-on-error\nbegin; SELECT 1; COMMIT;", "optional", "self_managed"},
	} {
		t.Run(test.source, func(t *testing.T) {
			actual := DescribeMigrationSource([]byte(test.source))
			if actual.ContentSHA256 != fmt.Sprintf("%x", sha256.Sum256([]byte(test.source))) || actual.ErrorPolicy != test.errorPolicy || actual.TransactionPolicy != test.transactionPolicy {
				t.Fatalf("unexpected source contract: %+v", actual)
			}
		})
	}
}
