// acl_auditor.go
// Inspects PUBLIC, grantors, grant options, defaults and owner-run SQL paths.
// Complements has_* effective checks without leaking role names or SQL bodies.
// Makes provenance and unreviewed bypasses explicit before a later applier exists.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
)

func auditACLs(ctx context.Context, tx *sql.Tx, snapshot GrantSnapshot, checks []Check, findings *[]Finding) error {
	roles := map[int64]string{}
	for _, role := range snapshot.Roles {
		roles[role.OID] = role.Label
	}
	checksByKey := map[string]Check{}
	for _, check := range checks {
		checksByKey[grantKey(check.Grant)] = check
	}
	if err := readRows(ctx, tx, directACLsSQL, nil, func(rows *sql.Rows) error {
		var oid, grantee, grantor, owner int64
		var kind, schema, name, column, privilege string
		var option bool
		if err := rows.Scan(&oid, &kind, &schema, &name, &column, &grantee, &grantor, &owner, &privilege, &option); err != nil {
			return err
		}
		label := roles[grantee]
		if grantee == 0 {
			label = "PUBLIC"
		}
		if label == "" {
			label = "outside_scope"
		}
		object := Object{OID: oid, Schema: schema, Name: name, Kind: kind}
		finding := Finding{Role: label, Kind: kind, ObjectOID: oid, Object: object.Identifier(), Column: column, Privilege: privilege, Reason: fmt.Sprintf("direct ACL; grantor OID %d", grantor)}
		if label == "outside_scope" {
			finding.Finding = "preserved_outside_scope"
			*findings = append(*findings, finding)
			return nil
		}
		check, known := checksByKey[grantKey(Grant{Role: label, Kind: kind, ObjectOID: oid, Column: column, Privilege: privilege})]
		if kind == "column" && !check.Wanted {
			if tableCheck, ok := checksByKey[grantKey(Grant{Role: label, Kind: "table", ObjectOID: oid, Privilege: privilege})]; ok && tableCheck.Wanted {
				check.Wanted = true
			}
		}
		if option {
			finding.Finding = "blocker"
			finding.Reason += "; runtime grant option"
			*findings = append(*findings, finding)
			return nil
		}
		if kind == "function" {
			finding.Finding = "preserved_outside_scope"
			*findings = append(*findings, finding)
			return nil
		}
		if label == "PUBLIC" {
			write := privilege != "SELECT" && privilege != "USAGE" || kind == "sequence" && privilege == "USAGE" || kind == "column" && privilege != "SELECT"
			finding.Finding = "preserved_outside_scope"
			if write {
				finding.Finding = "excess_write"
			}
			*findings = append(*findings, finding)
		} else if known && !check.Wanted {
			finding.Finding = compareFinding(false, true, check.Managed, privilege)
			*findings = append(*findings, finding)
		}
		if grantor != owner && privilege != "SELECT" && !check.Wanted {
			finding.Finding = "blocker"
			finding.Reason += "; non-owner grantor requires collateral-loss review before revocation"
			*findings = append(*findings, finding)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("direct ACL inspection failed")
	}
	if err := readRows(ctx, tx, defaultACLsSQL, nil, func(rows *sql.Rows) error {
		var oid, creator, grantee, grantor int64
		var schema, kind, privilege string
		var option bool
		if err := rows.Scan(&oid, &creator, &schema, &kind, &grantee, &grantor, &privilege, &option); err != nil {
			return err
		}
		label := roles[grantee]
		if grantee == 0 {
			label = "PUBLIC"
		}
		if label == "" {
			label = "outside_scope"
		}
		finding := Finding{Role: label, Kind: "default_" + kind, ObjectOID: oid, Object: schema, Privilege: privilege, Reason: fmt.Sprintf("default ACL; creator OID %d; grantor OID %d", creator, grantor), Finding: "preserved_outside_scope"}
		if label != "outside_scope" {
			allowed := label == "readonly" && kind == "table" && privilege == "SELECT" && schema == "public" || label == "confidential" && schema == "restricted" && (kind == "table" && (privilege == "SELECT" || privilege == "INSERT" || privilege == "UPDATE" || privilege == "DELETE") || kind == "sequence" && (privilege == "SELECT" || privilege == "USAGE"))
			if !allowed {
				if privilege == "SELECT" && label != "PUBLIC" {
					finding.Finding = "excess_read_reported"
				} else if privilege != "SELECT" && privilege != "EXECUTE" && !(kind == "schema" && privilege == "USAGE") {
					finding.Finding = "excess_write"
				}
			}
			if option {
				finding.Finding = "blocker"
				finding.Reason += "; runtime default grant option"
			}
		}
		*findings = append(*findings, finding)
		return nil
	}); err != nil {
		return fmt.Errorf("default ACL inspection failed")
	}
	return readSQLPathBlockers(ctx, tx, snapshot, findings)
}

func readSQLPathBlockers(ctx context.Context, tx *sql.Tx, snapshot GrantSnapshot, findings *[]Finding) error {
	if err := readRows(ctx, tx, sqlPathReviewSQL, []any{string(roleJSON(snapshot.Roles)), string(reviewedDefinerBodiesJSON())}, func(rows *sql.Rows) error {
		var finding Finding
		if err := rows.Scan(&finding.Role, &finding.Kind, &finding.ObjectOID, &finding.Object, &finding.Reason); err != nil {
			return err
		}
		finding.Finding = "blocker"
		if finding.Kind == "function" {
			finding.Privilege = "EXECUTE"
		}
		*findings = append(*findings, finding)
		return nil
	}); err != nil {
		return fmt.Errorf("owner-run SQL path review failed")
	}
	return nil
}

const directACLsSQL = `SELECT c.oid,CASE WHEN c.relkind='S' THEN 'sequence' ELSE 'table' END,n.nspname,c.relname,'',a.grantee,a.grantor,c.relowner,a.privilege_type,a.is_grantable
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
 WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION ALL
 SELECT c.oid,'column',n.nspname,c.relname,att.attname,a.grantee,a.grantor,c.relowner,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped CROSS JOIN LATERAL aclexplode(att.attacl) a WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION ALL
 SELECT n.oid,'schema','',n.nspname,'',a.grantee,a.grantor,n.nspowner,a.privilege_type,a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION ALL
 SELECT p.oid,'function',n.nspname,p.proname,'',a.grantee,a.grantor,p.proowner,a.privilege_type,a.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`

const defaultACLsSQL = `SELECT d.oid,d.defaclrole,COALESCE(n.nspname,'global'),CASE d.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'function' WHEN 'n' THEN 'schema' ELSE 'other' END,a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE n.nspname IS NULL OR n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`

// Same owner-run path inventory as accountTableWriteSQLPathReviewSQL; a body
// search cannot certify arbitrary SQL. Return identifiers, never definitions.
const sqlPathReviewSQL = `WITH roles AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(label text,role_oid oid)),
 reviewed_definer_bodies AS (SELECT key AS body_md5,value AS identity FROM jsonb_each($2::jsonb)),
 reviewed_definer_functions AS (` + reviewedDefinerFunctionsSQL + `)
 SELECT r.label,'function',p.oid,format('%I.%I',n.nspname,p.proname),'SECURITY DEFINER execution requires review'
 FROM roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(r.role_oid,p.oid,'EXECUTE') AND p.oid NOT IN (SELECT oid FROM reviewed_definer_functions) AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 UNION ALL
 SELECT r.label,'trigger',t.oid,format('%I.%I',n.nspname,c.relname),'owner-run trigger requires review' FROM roles r CROSS JOIN pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND p.prosecdef AND has_table_privilege(r.role_oid,c.oid,'INSERT,UPDATE,DELETE') AND n.nspname !~ '^pg_'
 UNION ALL
 SELECT r.label,'rule',rule.oid,format('%I.%I',n.nspname,c.relname),'write rule requires review' FROM roles r CROSS JOIN pg_rewrite rule JOIN pg_class c ON c.oid=rule.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE rule.rulename<>'_RETURN' AND has_table_privilege(r.role_oid,c.oid,'INSERT,UPDATE,DELETE') AND n.nspname !~ '^pg_'
 UNION ALL
 SELECT 'policy','event_trigger',oid,quote_ident(evtname),'event trigger requires review' FROM pg_event_trigger`
