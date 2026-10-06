// startup_reconciler.go
// Reconciles a restored or migrated catalogue in one transaction before readiness.
// Preserves uncertain legacy objects while provisioning all known requirements.
// Removes unsafe future defaults without revoking any existing SELECT privilege.
package runtime_grants

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/lib/pq"
)

// EnsureRuntimeRoleGrants owns the one ACL transaction. The application holds
// WithStartupBarrier across migrations, metadata writers and this call.
func EnsureRuntimeRoleGrants(ctx context.Context, db *sql.DB, roles RoleConfiguration) (result ReconcileResult, err error) {
	if db == nil {
		return result, fmt.Errorf("runtime grant administrator database is missing")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	// The exclusive lifecycle barrier is already held; do not take its shared
	// side on this second connection. The policy lock is always acquired next.
	if err = lockRuntimeGrantPolicyOnly(ctx, tx); err != nil {
		return result, err
	}
	snapshot, err := LoadMutationSnapshot(ctx, tx, roles)
	if err != nil {
		return result, err
	}
	checks, findings, err := mutationPolicyChecks(snapshot)
	if err != nil {
		return result, err
	}
	if err = auditACLs(ctx, tx, snapshot, checks, &findings); err != nil {
		return result, err
	}
	checks, err = filterBlockedChecks(snapshot, nil, nil, checks, findings, true)
	result.Findings = findings
	if err != nil {
		var structural *ScopeBlocker
		if errors.As(err, &structural) && len(structural.Findings) > 0 {
			first := structural.Findings[0]
			return result, fmt.Errorf("unsafe start-up policy configuration; no ACL changes: %s: %s (configured role %q): %w", first.Role, first.Reason, roles.Names[first.Role], err)
		}
		return result, fmt.Errorf("unsafe start-up policy configuration; no ACL changes: %w", err)
	}
	// Inspect the whole catalogue before the first ACL write. The same blocker
	// closure protects PUBLIC changes and managed-role revocations.
	baseline, err := reconcileStartupBaseline(ctx, tx, snapshot, checks)
	if err != nil {
		return result, err
	}
	result, err = reconcileRuntimeGrantsScoped(ctx, tx, roles, nil, nil, false, true)
	result.Applied += baseline
	if err != nil {
		return result, err
	}
	if err = tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func managedDeltaForMode(f Finding, startup bool) bool {
	if !startup {
		return managedDelta(f)
	}
	return (f.Role == "basic" || f.Role == "guest" || f.Role == "readonly" || f.Role == "confidential") && (f.Finding == "missing" || f.Finding == "excess_write")
}

func hasGlobalSQLBlocker(findings []Finding) bool {
	for _, finding := range findings {
		if finding.Finding == "blocker" && finding.Kind == "event_trigger" {
			return true
		}
	}
	return false
}

func reconcileStartupBaseline(ctx context.Context, tx *sql.Tx, snapshot GrantSnapshot, checks []Check) (int, error) {
	safe := map[string]bool{}
	for _, check := range checks {
		if check.Managed && check.Privilege != "SELECT" && !(check.Kind == "schema" && check.Privilege == "USAGE") {
			safe[fmt.Sprintf("%s/%d/%s/%s", check.Kind, check.ObjectOID, check.Column, check.Privilege)] = true
		}
	}
	var statements []string
	err := readRows(ctx, tx, directACLsSQL, nil, func(rows *sql.Rows) error {
		var oid, grantee, grantor, owner int64
		var kind, schema, name, column, privilege string
		var option bool
		if err := rows.Scan(&oid, &kind, &schema, &name, &column, &grantee, &grantor, &owner, &privilege, &option); err != nil {
			return err
		}
		if grantee != 0 || option || grantor != owner || !safe[fmt.Sprintf("%s/%d/%s/%s", kind, oid, column, privilege)] {
			return nil
		}
		object := snapshot.Objects[oid]
		targetKind := strings.ToUpper(kind)
		if kind == "column" {
			targetKind = "TABLE"
			privilege += " (" + pq.QuoteIdentifier(column) + ")"
		}
		statements = append(statements, "REVOKE "+privilege+" ON "+targetKind+" "+object.Identifier()+" FROM PUBLIC")
		return nil
	})
	if err != nil {
		return 0, err
	}
	// Defaults are not existing object reads. Inspect every creator, including
	// global entries (namespace 0), so changing the administrator cannot resurrect
	// broad defaults. Restricted confidential and readonly SELECT survive.
	defaults, err := readStartupDefaultRevocations(ctx, tx, snapshot.Roles)
	if err != nil {
		return 0, err
	}
	statements = append(statements, defaults...)
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return 0, metadataReaderError("start-up ACL baseline", err, snapshot.Roles)
		}
	}
	remaining, err := readStartupDefaultRevocations(ctx, tx, snapshot.Roles)
	if err != nil {
		return 0, err
	}
	if len(remaining) != 0 {
		return 0, fmt.Errorf("unsafe default privileges remain after start-up reconciliation; no ACL changes committed")
	}
	for _, role := range snapshot.Roles {
		var clauses []string
		if role.Label == "readonly" {
			clauses = []string{"IN SCHEMA " + pq.QuoteIdentifier("public") + " GRANT SELECT ON TABLES"}
		}
		if role.Label == "confidential" {
			for _, object := range snapshot.Objects {
				if object.Kind == "schema" && object.Name == "restricted" {
					clauses = []string{"IN SCHEMA " + pq.QuoteIdentifier("restricted") + " GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES", "IN SCHEMA " + pq.QuoteIdentifier("restricted") + " GRANT USAGE, SELECT ON SEQUENCES"}
				}
			}
		}
		for _, clause := range clauses {
			// PostgreSQL avoids changing an already matching default ACL.
			if _, err := tx.ExecContext(ctx, "ALTER DEFAULT PRIVILEGES "+clause+" TO "+pq.QuoteIdentifier(role.Name)); err != nil {
				return 0, err
			}
		}
	}
	return len(statements), nil
}

// LogStartupGrantSummary emits counts only: legacy catalogues can contain
// thousands of findings. The full audit remains available to operators.
func LogStartupGrantSummary(result ReconcileResult) {
	counts := map[string]int{}
	for _, f := range result.Findings {
		counts[f.Finding]++
	}
	log.Printf("[RUNTIME GRANTS] applied=%d legacy_blockers_preserved=%d excess_reads_retained=%d outside_scope_retained=%d", result.Applied, counts["blocker"], counts["excess_read_reported"], counts["preserved_outside_scope"])
}
