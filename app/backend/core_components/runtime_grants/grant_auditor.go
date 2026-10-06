// grant_auditor.go
// Compares the policy with effective privileges and direct/default ACL provenance.
// Runs on one repeatable READ ONLY transaction with a connection that cannot write.
// Emits metadata findings only; it neither applies nor prepares SQL mutations.
package runtime_grants

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"sort"
)

type Finding struct {
	Role       string `json:"role"`
	Kind       string `json:"kind,omitempty"`
	ObjectOID  int64  `json:"object_oid,omitempty"`
	Object     string `json:"object,omitempty"`
	FunctionID int64  `json:"function_id,omitempty"`
	Route      string `json:"route,omitempty"`
	Column     string `json:"column,omitempty"`
	Privilege  string `json:"privilege,omitempty"`
	Finding    string `json:"finding"`
	Reason     string `json:"reason"`
}

type Check struct {
	Grant
	Wanted  bool `json:"wanted"`
	Managed bool `json:"managed"`
}

// AuditRuntimeGrants owns the audit's sole transaction. Every discovery,
// comparator and ACL pass sees the same snapshot, and rollback always closes it.
func AuditRuntimeGrants(ctx context.Context, db *sql.DB, config RoleConfiguration) (result []Finding, auditErr error) {
	defer func() { result = normalizedFindings(result) }()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, fmt.Errorf("begin read-only audit failed")
	}
	defer tx.Rollback()
	var readonly string
	if err := tx.QueryRowContext(ctx, `SHOW transaction_read_only`).Scan(&readonly); err != nil || readonly != "on" {
		return nil, fmt.Errorf("read-only transaction is required")
	}
	var unsafe bool
	if err := tx.QueryRowContext(ctx, auditorMayWriteSQL, string(reviewedDefinerBodiesJSON())).Scan(&unsafe); err != nil {
		return nil, fmt.Errorf("audit connection safety check failed")
	}
	if unsafe {
		return nil, fmt.Errorf("audit identity may write or assume an elevated identity")
	}
	snapshot, err := LoadGrantSnapshot(ctx, tx, config)
	findings := append([]Finding{}, snapshot.Findings...)
	findings = append(findings, snapshot.Blockers...)
	if err != nil {
		findings = append(findings, Finding{Role: "audit", Finding: "blocker", Reason: err.Error()})
		return findings, nil
	}
	// The public pure policy still refuses a snapshot with blockers. Only this
	// read-only comparator evaluates the valid rows for diagnostic completeness;
	// it never applies grants derived from an incomplete snapshot.
	comparisonSnapshot := snapshot
	comparisonSnapshot.Blockers = nil
	if unknown := unclassifiedRouteFindings(snapshot); len(unknown) != 0 {
		// Exclude only unclassified routes and their rights from the diagnostic
		// union. Preserve the original snapshot and all of its blockers so no
		// public policy caller can obtain grants from this incomplete input.
		unknownIDs := map[int64]bool{}
		for _, finding := range unknown {
			unknownIDs[finding.FunctionID] = true
		}
		comparisonSnapshot.Functions = make(map[int64]Function, len(snapshot.Functions))
		for id, function := range snapshot.Functions {
			if !unknownIDs[id] {
				comparisonSnapshot.Functions[id] = function
			}
		}
		comparisonSnapshot.Rights = nil
		for _, right := range snapshot.Rights {
			if !unknownIDs[right.FunctionID] {
				comparisonSnapshot.Rights = append(comparisonSnapshot.Rights, right)
			}
		}
	}
	desired, policyErr := evaluateRuntimeGrants(comparisonSnapshot, &findings)
	var checks []Check
	if policyErr == nil {
		checks, policyErr = BuildGrantChecks(comparisonSnapshot, desired)
	}
	if policyErr != nil {
		findings = append(findings, Finding{Role: "policy", Finding: "blocker", Reason: policyErr.Error()})
	} else {
		encoded, _ := json.Marshal(checks)
		if err := readRows(ctx, tx, effectivePrivilegesSQL, []any{string(roleJSON(snapshot.Roles)), string(encoded)}, func(rows *sql.Rows) error {
			var finding Finding
			var wanted, present, managed bool
			if err := rows.Scan(&finding.Role, &finding.Kind, &finding.ObjectOID, &finding.Column, &finding.Privilege, &wanted, &present, &managed, &finding.Reason); err != nil {
				return err
			}
			finding.Object = snapshot.Objects[finding.ObjectOID].Identifier()
			finding.Finding = compareFinding(wanted, present, managed, finding.Privilege)
			findings = append(findings, finding)
			return nil
		}); err != nil {
			findings = append(findings, Finding{Role: "audit", Finding: "blocker", Reason: metadataReaderError("effective privilege comparison", err, snapshot.Roles).Error()})
			return findings, nil
		}
	}
	if err := auditACLs(ctx, tx, snapshot, checks, &findings); err != nil {
		findings = append(findings, Finding{Role: "audit", Finding: "blocker", Reason: err.Error()})
		return findings, nil
	}
	// Rolling back a read-only transaction is intentional; no successful audit
	// can commit a database mutation, even if a future caller misuses a pool.
	if err := tx.Rollback(); err != nil {
		return nil, fmt.Errorf("close read-only audit failed")
	}
	return findings, nil
}

// BuildGrantChecks creates wanted=false entries too, including every column
// implication of table privileges. The SQL comparator contains no policy rules.
func BuildGrantChecks(snapshot GrantSnapshot, desired GrantSet) ([]Check, error) {
	wanted := map[string]Grant{}
	for _, grant := range desired {
		wanted[grantKey(grant)] = grant
	}
	checks := []Check{}
	classifiedSequences := classifiedSequenceOIDs(snapshot)
	for oid, object := range snapshot.Objects {
		if object.Kind == "function" {
			continue
		}
		if object.Kind == "table" {
			if _, err := ClassifyTable(object); err != nil {
				continue // Its blocker is reported; classification-dependent checks are unknown.
			}
		}
		if object.Kind == "sequence" && !classifiedSequences[oid] {
			continue // Its individual blocker leaves only this object's checks unknown.
		}
		for _, role := range snapshot.Roles {
			privileges := []string{}
			switch object.Kind {
			case "table":
				privileges = []string{"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"}
			case "sequence":
				privileges = []string{"USAGE", "SELECT", "UPDATE"}
			case "schema":
				privileges = []string{"USAGE", "CREATE"}
			}
			appendCheck := func(kind, column, privilege string) {
				grant := Grant{Role: role.Label, Kind: kind, ObjectOID: oid, Column: column, Privilege: privilege, Reason: "outside desired operation requirements"}
				positive, ok := wanted[grantKey(grant)]
				if !ok && kind == "column" {
					positive, ok = wanted[grantKey(Grant{Role: role.Label, Kind: "table", ObjectOID: oid, Privilege: privilege})]
				}
				if ok {
					grant.Reason = positive.Reason
				}
				managed := privilege != "SELECT" && !(object.Kind == "schema" && privilege == "USAGE")
				if object.Extension && role.Label == "basic" {
					managed = false
				}
				// Product operational reads are preserved until stage 2c.
				if privilege == "SELECT" && object.Kind == "table" {
					class, _ := ClassifyTable(object)
					managed = class == Content || class == Embedding || role.Label == "confidential" || object.Schema == "restricted"
				}
				if privilege == "SELECT" && kind == "column" {
					class, _ := ClassifyTable(object)
					managed = class == Content || class == Embedding || role.Label == "confidential" || object.Schema == "restricted"
				}
				checks = append(checks, Check{Grant: grant, Wanted: ok, Managed: managed})
			}
			for _, privilege := range privileges {
				appendCheck(object.Kind, "", privilege)
			}
			if object.Kind == "table" {
				for _, column := range object.Columns {
					for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "REFERENCES"} {
						appendCheck("column", column.Name, privilege)
					}
				}
			}
		}
	}
	sort.Slice(checks, func(i, j int) bool { return grantKey(checks[i].Grant) < grantKey(checks[j].Grant) })
	return checks, nil
}

func compareFinding(wanted, present, managed bool, privilege string) string {
	if wanted && !present {
		return "missing"
	}
	if !managed {
		return "preserved_outside_scope"
	}
	if privilege == "SELECT" {
		return "excess_read_reported"
	}
	return "excess_write"
}

// WriteFindings prints JSON lines with role labels and identifiers only. The
// caller uses HasBlockers to distinguish an incomplete audit from a clean one.
func WriteFindings(writer io.Writer, findings []Finding) error {
	encoder := json.NewEncoder(writer)
	for _, finding := range findings {
		if err := encoder.Encode(finding); err != nil {
			return err
		}
	}
	return nil
}

func HasBlockers(findings []Finding) bool {
	for _, finding := range findings {
		if finding.Finding == "blocker" {
			return true
		}
	}
	return false
}

const effectivePrivilegesSQL = `WITH roles AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(label text,role_oid oid)),
checks AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS c(label text,kind text,object_oid oid,column_name text,privilege text,wanted boolean,managed boolean,reason text)),
actual AS (SELECT c.*, CASE kind
 WHEN 'table' THEN has_table_privilege(r.role_oid,object_oid,privilege)
 WHEN 'column' THEN has_column_privilege(r.role_oid,object_oid,column_name,privilege)
 WHEN 'sequence' THEN has_sequence_privilege(r.role_oid,object_oid,privilege)
 WHEN 'schema' THEN has_schema_privilege(r.role_oid,object_oid,privilege) END AS present
 FROM checks c JOIN roles r USING(label))
SELECT label,kind,object_oid,COALESCE(column_name,''),privilege,wanted,present,managed,reason
FROM actual WHERE wanted IS DISTINCT FROM present ORDER BY label,kind,object_oid,column_name,privilege`

// Ownership, SET ROLE, column writes, schema CREATE and unreviewed definer execution count
// as write capability even inside a READ ONLY transaction. TEMP privileges are
// irrelevant: the command never creates or accesses temporary objects.
const auditorMayWriteSQL = `WITH reviewed_definer_bodies AS (SELECT key AS body_md5,value AS identity FROM jsonb_each($1::jsonb)),
 reviewed_definer_functions AS (` + reviewedDefinerFunctionsSQL + `)
 SELECT
 EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user)
 OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_schema_privilege(n.oid,'CREATE')))
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND (
 c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE,UPDATE') ELSE has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES') END))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR p.prosecdef AND has_function_privilege(p.oid,'EXECUTE') AND p.oid NOT IN (SELECT oid FROM reviewed_definer_functions)))`
