// acl_auditor_test.go
// Preserves inspection failures through the ACL auditor's diagnostic boundary.
// Uses the existing catalogue driver without database or network access.
// Lets callers and server logs retain the original cancellation/database cause.
package runtime_grants

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestDirectACLInspectionPreservesUnderlyingError(t *testing.T) {
	for _, cause := range []error{context.Canceled, &pq.Error{Code: "55P03", Message: "canceling statement due to lock timeout"}} {
		t.Run(cause.Error(), func(t *testing.T) {
			db := sql.OpenDB(&applierDriver{directACLErr: cause})
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			var findings []Finding
			err = auditACLs(context.Background(), tx, GrantSnapshot{}, nil, &findings)
			if !errors.Is(err, cause) || !strings.Contains(err.Error(), "direct ACL inspection failed: "+cause.Error()) {
				t.Fatalf("original ACL inspection cause was lost: %v", err)
			}
		})
	}
}
