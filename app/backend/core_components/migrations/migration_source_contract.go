// migration_source_contract.go
// Describes exact SQL bytes with the migration runner's own execution directives.
// Connects offline update inspection and startup to one policy classifier.
// Prevents a signed route from claiming different error or transaction behavior.
package migrations

import (
	"crypto/sha256"
	"fmt"
	"strings"
)

// SourceContract describes bytes, not historical execution or permission to run SQL.
type SourceContract struct {
	ContentSHA256     string `json:"content_sha256"`
	ErrorPolicy       string `json:"error_policy"`
	TransactionPolicy string `json:"transaction_policy"`
}

// DescribeMigrationSource uses the runner's leading directive and SQL-header rules.
// It never connects to a database or executes the supplied SQL.
func DescribeMigrationSource(data []byte) SourceContract {
	result := SourceContract{ContentSHA256: fmt.Sprintf("%x", sha256.Sum256(data)), ErrorPolicy: "required", TransactionPolicy: "runner"}
	if strings.HasPrefix(string(data), "-- skip-on-error") {
		result.ErrorPolicy = "optional"
	}
	if startsWithSelfManagedBegin(string(data)) {
		result.TransactionPolicy = "self_managed"
	}
	return result
}
