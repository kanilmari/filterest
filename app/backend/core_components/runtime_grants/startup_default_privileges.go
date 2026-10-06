// startup_default_privileges.go
// Builds start-up default-ACL revocations from catalogue identities.
// Uses the shared identifier quoting helper for creators, schemas and roles.
// Keeps PUBLIC and global defaults distinct from named roles and schemas.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

type startupDefaultPrivilege struct {
	Creator   string
	Schema    sql.NullString // NULL is a global default, with no IN SCHEMA clause.
	Kind      string
	Privilege string
	Grantee   sql.NullString // NULL is PUBLIC; a named role is always quoted.
}

func (entry startupDefaultPrivilege) revokeStatement() (string, error) {
	targets := map[string]string{"r": "TABLES", "S": "SEQUENCES", "n": "SCHEMAS"}
	allowed := map[string]string{"r": "SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER", "S": "USAGE SELECT UPDATE", "n": "USAGE CREATE"}
	if targets[entry.Kind] == "" || entry.Privilege == "" || !strings.Contains(" "+allowed[entry.Kind]+" ", " "+entry.Privilege+" ") {
		return "", fmt.Errorf("invalid default privilege")
	}
	for _, name := range []sql.NullString{{String: entry.Creator, Valid: true}, entry.Schema, entry.Grantee} {
		if name.Valid && (name.String == "" || strings.ContainsRune(name.String, 0)) {
			return "", fmt.Errorf("invalid default privilege identity")
		}
	}
	statement := "ALTER DEFAULT PRIVILEGES FOR ROLE " + pq.QuoteIdentifier(entry.Creator)
	if entry.Schema.Valid {
		statement += " IN SCHEMA " + pq.QuoteIdentifier(entry.Schema.String)
	}
	grantee := "PUBLIC"
	if entry.Grantee.Valid {
		grantee = pq.QuoteIdentifier(entry.Grantee.String)
	}
	return statement + " REVOKE " + entry.Privilege + " ON " + targets[entry.Kind] + " FROM " + grantee, nil
}

func readStartupDefaultRevocations(ctx context.Context, tx *sql.Tx, roles []Role) ([]string, error) {
	var statements []string
	err := readRows(ctx, tx, startupDefaultPrivilegesSQL, []any{string(roleJSON(roles))}, func(rows *sql.Rows) error {
		var entry startupDefaultPrivilege
		if err := rows.Scan(&entry.Creator, &entry.Schema, &entry.Kind, &entry.Privilege, &entry.Grantee); err != nil {
			return err
		}
		statement, err := entry.revokeStatement()
		if err == nil {
			statements = append(statements, statement)
		}
		return err
	})
	return statements, err
}

const startupDefaultPrivilegesSQL = `WITH roles AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(label text,role_oid oid))
 SELECT DISTINCT pg_get_userbyid(d.defaclrole)::text,
 CASE WHEN d.defaclnamespace=0 THEN NULL ELSE n.nspname::text END,
 d.defaclobjtype::text,a.privilege_type,
 CASE WHEN a.grantee=0 THEN NULL ELSE pg_get_userbyid(a.grantee)::text END
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN roles r ON r.role_oid=a.grantee
 WHERE (d.defaclnamespace=0 OR n.nspname !~ '^pg_' AND n.nspname<>'information_schema') AND (
 (d.defaclobjtype='r' AND (
  a.privilege_type='SELECT' AND r.label IN ('basic','guest')
  OR a.privilege_type<>'SELECT' AND (a.grantee=0 OR r.label IS NOT NULL)
   AND NOT COALESCE(r.label='confidential' AND n.nspname='restricted' AND a.privilege_type IN ('INSERT','UPDATE','DELETE'),false)))
 OR (d.defaclobjtype='S' AND a.privilege_type IN ('USAGE','UPDATE') AND (a.grantee=0 OR r.label IS NOT NULL)
  AND NOT COALESCE(r.label='confidential' AND n.nspname='restricted' AND a.privilege_type='USAGE',false))
 OR (d.defaclobjtype='n' AND a.privilege_type='CREATE' AND (a.grantee=0 OR r.label IS NOT NULL)))
 ORDER BY 1,2,3,4,5`
