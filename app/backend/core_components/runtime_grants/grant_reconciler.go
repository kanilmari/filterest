// grant_reconciler.go
// Applies the shared runtime policy inside the caller's transaction.
// Keeps reads additive and writes exact, with an effective-privilege postcheck.
// Never commits, imports handlers, or changes application rights.
package runtime_grants

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

// ReconcileResult reports applied statements and retained metadata/ACL findings.
type ReconcileResult struct {
	Applied         int
	Findings        []Finding // Complete catalogue diagnostics, retained for audit callers.
	RequestFindings []Finding // INFO-worthy findings in this request or refusing it.
}

// ScopeBlocker refuses only the request's affected dependency closure.
type ScopeBlocker struct{ Findings []Finding }

func (e *ScopeBlocker) Error() string {
	return "runtime grant policy cannot classify this request's datasets"
}

// LockRuntimeGrantPolicy must run immediately after opening the request
// transaction, before any row/reference/DDL locks. SET LOCAL bounds waiting;
// ExecContext also observes request cancellation. Startup uses the same barrier.
func LockRuntimeGrantPolicy(ctx context.Context, tx *sql.Tx) error {
	if tx == nil {
		return fmt.Errorf("runtime grant transaction is required")
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = '5s'`); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))`)
	return err
}

// ReconcileRuntimeGrants reconciles the whole catalogue. HTTP callers use the
// scoped variant after capturing old targets, so unrelated blockers are retained.
func ReconcileRuntimeGrants(ctx context.Context, tx *sql.Tx, roles RoleConfiguration) (ReconcileResult, error) {
	return ReconcileRuntimeGrantsScoped(ctx, tx, roles, nil, nil)
}

// ReconcileRuntimeGrantsScoped loads fresh metadata after the caller's mutation.
// before preserves removed dependencies, including the last removed right.
// A nil scope is the whole catalogue. Explicit request targets are authoritative;
// an empty non-nil scope derives generic metadata targets from old/new changes.
func ReconcileRuntimeGrantsScoped(ctx context.Context, tx *sql.Tx, roles RoleConfiguration, before *GrantSnapshot, scope []int64) (ReconcileResult, error) {
	return reconcileRuntimeGrantsScoped(ctx, tx, roles, before, scope, false)
}

// ReconcileHTTPRuntimeGrantsScoped also refuses every newly introduced blocker.
// CSV/restore callers deliberately use ReconcileRuntimeGrantsScoped until commit 3.
func ReconcileHTTPRuntimeGrantsScoped(ctx context.Context, tx *sql.Tx, roles RoleConfiguration, before *GrantSnapshot, scope []int64) (ReconcileResult, error) {
	return reconcileRuntimeGrantsScoped(ctx, tx, roles, before, scope, true)
}

func reconcileRuntimeGrantsScoped(ctx context.Context, tx *sql.Tx, roles RoleConfiguration, before *GrantSnapshot, scope []int64, refuseNew bool) (result ReconcileResult, err error) {
	snapshot, err := LoadMutationSnapshot(ctx, tx, roles)
	if err != nil {
		return result, err
	}
	defer func() {
		result.RequestFindings = requestGrantFindings(snapshot, before, scope, result.Findings, err)
	}()
	if refuseNew && before != nil {
		introduced, err := NewMutationBlockers(*before, snapshot)
		if err != nil {
			return result, err
		}
		if len(introduced) != 0 {
			result.Findings = introduced
			return result, &ScopeBlocker{Findings: introduced}
		}
	}
	if before != nil && scope != nil && len(scope) == 0 {
		// Creation refreshes shared metadata too. Those incidental changes do
		// not turn every registered table into this request's own dataset.
		scope = append(scope, ChangedDatasetOIDs(*before, snapshot)...)
	}
	checks, findings, err := reconciliationChecks(snapshot, before, scope)
	result.Findings = findings
	if err != nil {
		return result, err
	}
	// No CASCADE is used. A grant option or non-owner grantor is not safe to
	// revoke silently; exclude its object or refuse an affected request.
	var aclFindings []Finding
	if err := auditACLs(ctx, tx, snapshot, checks, &aclFindings); err != nil {
		return result, err
	}
	checks, err = excludeBlockedChecks(snapshot, before, scope, checks, aclFindings)
	result.Findings = normalizedFindings(append(result.Findings, aclFindings...))
	if err != nil {
		return result, err
	}
	outside, err := preservedACLs(ctx, tx, snapshot.Roles)
	if err != nil {
		return result, err
	}
	// Revoke first. A table UPDATE may currently imply the desired column
	// UPDATE, so only a fresh comparison after revocation reveals its absence.
	for _, revoke := range []bool{true, false} {
		differences, err := effectiveDifferences(ctx, tx, snapshot, checks)
		if err != nil {
			return result, err
		}
		for _, finding := range differences {
			if !managedDelta(finding) || (finding.Finding == "excess_write") != revoke {
				continue
			}
			statement, err := grantStatement(snapshot, finding, revoke)
			if err != nil {
				return result, err
			}
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return result, metadataReaderError("apply runtime grant", err, snapshot.Roles)
			}
			result.Applied++
		}
	}
	remaining, err := effectiveDifferences(ctx, tx, snapshot, checks)
	if err != nil {
		return result, err
	}
	result.Findings = normalizedFindings(append(result.Findings, remaining...))
	for _, finding := range remaining {
		if managedDelta(finding) {
			if finding.Finding == "missing" {
				finding.Finding = "blocker"
				finding.Reason = "required runtime grant absent after reconciliation"
				return result, fmt.Errorf("runtime grant postcheck failed: %w", &ScopeBlocker{Findings: []Finding{finding}})
			}
			return result, fmt.Errorf("runtime grant postcheck failed: %s %s %s", finding.Role, finding.Object, finding.Privilege)
		}
	}
	after, err := preservedACLs(ctx, tx, snapshot.Roles)
	if err != nil {
		return result, err
	}
	if outside != after {
		return result, fmt.Errorf("runtime grant postcheck changed an outside-scope ACL")
	}
	return result, nil
}

func effectiveDifferences(ctx context.Context, tx *sql.Tx, snapshot GrantSnapshot, checks []Check) ([]Finding, error) {
	if checks == nil {
		checks = []Check{}
	}
	encoded, err := json.Marshal(checks)
	if err != nil {
		return nil, err
	}
	var findings []Finding
	err = readRows(ctx, tx, effectivePrivilegesSQL, []any{string(roleJSON(snapshot.Roles)), string(encoded)}, func(rows *sql.Rows) error {
		var finding Finding
		var wanted, present, managed bool
		if err := rows.Scan(&finding.Role, &finding.Kind, &finding.ObjectOID, &finding.Column, &finding.Privilege, &wanted, &present, &managed, &finding.Reason); err != nil {
			return err
		}
		finding.Object = snapshot.Objects[finding.ObjectOID].Identifier()
		// The audit preserves operational SELECTs outside its removal scope.
		// The mutation report still identifies every retained excess read.
		finding.Finding = compareFinding(wanted, present, managed || finding.Privilege == "SELECT", finding.Privilege)
		findings = append(findings, finding)
		return nil
	})
	return findings, err
}

func managedDelta(f Finding) bool {
	return (f.Role == "basic" || f.Role == "guest") && (f.Finding == "missing" || f.Finding == "excess_write")
}

func grantStatement(snapshot GrantSnapshot, f Finding, revoke bool) (string, error) {
	object, ok := snapshot.Objects[f.ObjectOID]
	if !ok {
		return "", fmt.Errorf("grant target is missing")
	}
	var name string
	for _, role := range snapshot.Roles {
		if role.Label == f.Role {
			name = role.Name
		}
	}
	if name == "" || (f.Role != "basic" && f.Role != "guest") {
		return "", fmt.Errorf("unmanaged grant role")
	}
	kind := strings.ToUpper(f.Kind)
	allowed := map[string]string{"table": "SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER", "column": "SELECT INSERT UPDATE REFERENCES", "sequence": "USAGE SELECT UPDATE", "schema": "USAGE CREATE"}
	if !strings.Contains(" "+allowed[f.Kind]+" ", " "+f.Privilege+" ") || f.Privilege == "" {
		return "", fmt.Errorf("invalid grant privilege")
	}
	privilege := f.Privilege
	if f.Kind == "column" {
		if !object.hasColumn(f.Column) {
			return "", fmt.Errorf("grant column is missing")
		}
		kind = "TABLE"
		privilege += " (" + pq.QuoteIdentifier(f.Column) + ")"
	}
	verb, preposition := "GRANT", "TO"
	if revoke {
		if f.Privilege == "SELECT" || f.Kind == "schema" && f.Privilege == "USAGE" {
			return "", fmt.Errorf("read revocation is outside this policy step")
		}
		verb, preposition = "REVOKE", "FROM"
	}
	return verb + " " + privilege + " ON " + kind + " " + object.Identifier() + " " + preposition + " " + pq.QuoteIdentifier(name), nil
}

// Compare every direct ACL source not owned by the two managed runtime roles.
// This includes owners, readonly/confidential, PUBLIC and unrelated identities.
func preservedACLs(ctx context.Context, tx *sql.Tx, roles []Role) (string, error) {
	var basic, guest int64
	for _, role := range roles {
		if role.Label == "basic" {
			basic = role.OID
		}
		if role.Label == "guest" {
			guest = role.OID
		}
	}
	var fingerprint string
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(string_agg(row_to_json(a)::text,E'\n' ORDER BY row_to_json(a)::text),'') FROM (`+directACLsSQL+`) a WHERE grantee NOT IN ($1,$2)`, basic, guest).Scan(&fingerprint)
	return fingerprint, err
}
