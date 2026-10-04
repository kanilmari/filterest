// runtime_role_write_revocations.go
// Removes every write right of the guest database role, and every runtime role's use of the
// privilege-editing views and of trigger functions that run with their owner's rights.
// Bridges the configured, installation-specific role names with catalog-driven REVOKE statements.
// Exists because a migration cannot know those names, and a visitor must not be able to change
// data, nor an ordinary account its own rights, in the database itself (WL124, stage 1).
package backend

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"easelect/backend/core_components/security"
	"github.com/lib/pq"
)

// runtimeWriteRevocationRoleKeys are the login roles the application uses for
// its callers, in the order the catalog statements below expect them ($1-$4).
var runtimeWriteRevocationRoleKeys = []string{
	"DB_GUEST_USER",
	"DB_BASIC_USER",
	"DB_READONLY_USER",
	"DB_CONFIDENTIAL_USER",
}

// runtimeWriteRevocationProtectedRoleKeys name the roles these revocations
// must never reach: the administrator connection and the installation owner.
var runtimeWriteRevocationProtectedRoleKeys = []string{
	"DB_ADMIN_USER",
	"DB_USER",
}

// runtimeWriteRevocationScope defines, once, the objects the statements below
// reason about, so the revocations, the comparison of the rights that must stay
// and the final check always agree on them. It expects $1 guest, $2 basic,
// $3 readonly and $4 confidential role names.
//   - user_relations: tables, views, materialized views, foreign tables and
//     sequences outside the system schemas.
//   - privilege_views: views whose writes can change database rights: the
//     systemview_ views of the private schema lineage, which the product treats
//     as administrator-only datasets, and any view whose trigger runs with its
//     owner's rights.
//   - definer_trigger_functions: trigger functions that run with their owner's
//     rights. Whoever may execute one may attach it to a trigger of their own on
//     any table they hold TRIGGER on. Revoking EXECUTE does not stop existing
//     triggers, because PostgreSQL checks it only when a trigger is created.
const runtimeWriteRevocationScope = `
WITH runtime_roles (label, role_oid) AS (
	SELECT configured.label, role_row.oid
	FROM (VALUES ('guest', $1::text), ('basic', $2::text),
	             ('readonly', $3::text), ('confidential', $4::text)) AS configured (label, role_name)
	LEFT JOIN pg_roles AS role_row ON role_row.rolname = configured.role_name
),
guest_role AS (
	SELECT role_oid FROM runtime_roles WHERE label = 'guest'
),
user_relations AS (
	SELECT relation.oid, relation.relkind, relation.relname, relation.relowner, relation.relacl,
	       format('%I.%I', relation_schema.nspname, relation.relname) AS qualified_name
	FROM pg_class AS relation
	JOIN pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
	WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
	  AND relation_schema.nspname <> 'information_schema'
	  AND relation_schema.nspname !~ '^pg_'
),
user_tables AS (
	SELECT * FROM user_relations WHERE relkind <> 'S'
),
user_sequences AS (
	SELECT * FROM user_relations WHERE relkind = 'S'
),
privilege_views AS (
	SELECT view_relation.oid
	FROM user_relations AS view_relation
	WHERE view_relation.relkind = 'v'
	  AND (view_relation.relname LIKE 'systemview\_%'
	       OR EXISTS (
	           SELECT 1
	           FROM pg_trigger AS view_trigger
	           JOIN pg_proc AS trigger_function ON trigger_function.oid = view_trigger.tgfoid
	           WHERE view_trigger.tgrelid = view_relation.oid
	             AND NOT view_trigger.tgisinternal
	             AND trigger_function.prosecdef))
),
definer_trigger_functions AS (
	SELECT trigger_function.oid, trigger_function.proowner, trigger_function.proacl,
	       format('%I.%I(%s)', function_schema.nspname, trigger_function.proname,
	              pg_get_function_identity_arguments(trigger_function.oid)) AS qualified_name
	FROM pg_proc AS trigger_function
	JOIN pg_namespace AS function_schema ON function_schema.oid = trigger_function.pronamespace
	WHERE trigger_function.prosecdef
	  AND trigger_function.prorettype = 'trigger'::regtype
	  AND function_schema.nspname <> 'information_schema'
	  AND function_schema.nspname !~ '^pg_'
),
write_privileges (privilege_name) AS (
	VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)`

// runtimeWriteRevocationPreconditionSQL names every role setup in which the
// revocations could not keep their promise: a missing or superuser role, a
// runtime role that bypasses row security, a guest with elevated attributes or
// its own relations, rights inherited through membership, which a REVOKE on the
// role itself cannot remove, or a runtime role that owns what it must stop
// using. An empty result means it is safe to go on.
//
// Row security is what keeps the data repair record (system_data_repair_records)
// to its owner role whatever rights the installation gave, so no runtime role may
// bypass it. The start does not take the attribute away: changing it needs a
// superuser and is a deliberate act, so the message names the command.
const runtimeWriteRevocationPreconditionSQL = runtimeWriteRevocationScope + `
SELECT concat_ws('; ',
	(SELECT 'role not found: ' || string_agg(label, ', ' ORDER BY label)
	 FROM runtime_roles WHERE role_oid IS NULL HAVING count(*) > 0),
	(SELECT 'role is a superuser: ' || string_agg(runtime.label, ', ' ORDER BY runtime.label)
	 FROM runtime_roles AS runtime
	 JOIN pg_roles AS role_row ON role_row.oid = runtime.role_oid
	 WHERE role_row.rolsuper HAVING count(*) > 0),
	(SELECT 'role bypasses row security: '
	        || string_agg(format('%s (%s)', runtime.label, role_row.rolname), ', ' ORDER BY runtime.label)
	        || '; remove it with ALTER ROLE <role> NOBYPASSRLS'
	 FROM runtime_roles AS runtime
	 JOIN pg_roles AS role_row ON role_row.oid = runtime.role_oid
	 WHERE role_row.rolbypassrls HAVING count(*) > 0),
	(SELECT 'the guest role may create roles or databases or replicate'
	 FROM guest_role AS guest
	 JOIN pg_roles AS role_row ON role_row.oid = guest.role_oid
	 WHERE role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication),
	(SELECT 'role inherits rights as a member of another role: ' || string_agg(DISTINCT runtime.label, ', ')
	 FROM runtime_roles AS runtime
	 JOIN pg_auth_members AS membership ON membership.member = runtime.role_oid
	 HAVING count(*) > 0),
	(SELECT 'role is the connecting role: ' || string_agg(runtime.label, ', ' ORDER BY runtime.label)
	 FROM runtime_roles AS runtime
	 JOIN pg_roles AS role_row ON role_row.oid = runtime.role_oid
	 WHERE role_row.rolname = current_user HAVING count(*) > 0),
	(SELECT 'the guest role owns ' || count(*) || ' relation(s)'
	 FROM user_relations
	 WHERE relowner = (SELECT role_oid FROM guest_role) HAVING count(*) > 0),
	(SELECT 'a runtime role owns a privilege-editing view or a trigger function that runs with its owner''s rights'
	 WHERE EXISTS (SELECT 1 FROM user_relations
	               WHERE oid IN (SELECT oid FROM privilege_views)
	                 AND relowner IN (SELECT role_oid FROM runtime_roles))
	    OR EXISTS (SELECT 1 FROM definer_trigger_functions
	               WHERE proowner IN (SELECT role_oid FROM runtime_roles)))
)`

// runtimeWriteRevocationKeptRightsSQL lists every write right the basic,
// read-only and confidential roles hold outside the privilege-editing views,
// down to single columns. It is read before and after the revocations and the
// two lists must match, so this stage can never narrow what signed-in users,
// the read-only tools or the confidential connection may do elsewhere. A
// read-only role configured as the guest role is left out: it is the guest.
const runtimeWriteRevocationKeptRightsSQL = runtimeWriteRevocationScope + `,
kept_roles AS (
	SELECT runtime.label, runtime.role_oid
	FROM runtime_roles AS runtime
	WHERE runtime.label <> 'guest'
	  AND runtime.role_oid IS DISTINCT FROM (SELECT role_oid FROM guest_role)
),
kept_tables AS (
	SELECT oid, qualified_name FROM user_tables
	WHERE oid NOT IN (SELECT oid FROM privilege_views)
)
SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '')
FROM (
	SELECT format('%s %s %s', kept.label, relation.qualified_name, privilege.privilege_name) AS entry
	FROM kept_roles AS kept
	CROSS JOIN kept_tables AS relation
	CROSS JOIN write_privileges AS privilege
	WHERE has_table_privilege(kept.role_oid, relation.oid, privilege.privilege_name)
	UNION ALL
	SELECT format('%s %s(%s) %s', kept.label, relation.qualified_name,
	              quote_ident(table_column.attname), privilege.privilege_name)
	FROM kept_roles AS kept
	CROSS JOIN kept_tables AS relation
	JOIN pg_attribute AS table_column
	  ON table_column.attrelid = relation.oid AND table_column.attnum > 0 AND NOT table_column.attisdropped
	CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES')) AS privilege (privilege_name)
	WHERE NOT has_table_privilege(kept.role_oid, relation.oid, privilege.privilege_name)
	  AND has_column_privilege(kept.role_oid, relation.oid, table_column.attnum, privilege.privilege_name)
	UNION ALL
	SELECT format('%s %s %s', kept.label, relation.qualified_name, privilege.privilege_name)
	FROM kept_roles AS kept
	CROSS JOIN user_sequences AS relation
	CROSS JOIN (VALUES ('USAGE'), ('UPDATE')) AS privilege (privilege_name)
	WHERE has_sequence_privilege(kept.role_oid, relation.oid, privilege.privilege_name)
) AS kept_rights`

// runtimeWriteRevocationStatementsSQL turns every catalog entry that breaks the
// rule into the REVOKE that removes it, with identifiers quoted by PostgreSQL.
// A table-level REVOKE also clears that grantor's column-level entries. An
// entry is removed as the role that granted it: a REVOKE removes only the
// issuer's own grants, and a superuser's REVOKE acts as the object's owner.
// acting_role is empty when the owner granted the entry.
const runtimeWriteRevocationStatementsSQL = runtimeWriteRevocationScope + `,
relation_entries AS (
	SELECT relation.oid, relation.relkind, relation.relowner, relation.qualified_name,
	       entry.grantor, entry.grantee, entry.privilege_type
	FROM user_relations AS relation
	CROSS JOIN LATERAL aclexplode(relation.relacl) AS entry
	UNION ALL
	SELECT relation.oid, relation.relkind, relation.relowner, relation.qualified_name,
	       entry.grantor, entry.grantee, entry.privilege_type
	FROM user_tables AS relation
	JOIN pg_attribute AS table_column
	  ON table_column.attrelid = relation.oid AND table_column.attacl IS NOT NULL AND NOT table_column.attisdropped
	CROSS JOIN LATERAL aclexplode(table_column.attacl) AS entry
),
revocations (category, acting_role, statement) AS (
	-- The guest and PUBLIC write nothing, and no runtime role writes a privilege-editing view.
	SELECT DISTINCT
	       CASE WHEN entry.oid IN (SELECT oid FROM privilege_views) THEN 'privilege_view' ELSE 'guest_relation' END,
	       CASE WHEN entry.grantor = entry.relowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM %s',
	              entry.qualified_name,
	              CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END)
	FROM relation_entries AS entry
	WHERE entry.relkind <> 'S'
	  AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges)
	  AND (entry.grantee = 0
	       OR entry.grantee = (SELECT role_oid FROM guest_role)
	       OR (entry.oid IN (SELECT oid FROM privilege_views)
	           AND entry.grantee IN (SELECT role_oid FROM runtime_roles)))
	UNION
	-- Nor do they draw or set sequence values.
	SELECT DISTINCT 'guest_sequence',
	       CASE WHEN entry.grantor = entry.relowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE USAGE, UPDATE ON SEQUENCE %s FROM %s', entry.qualified_name,
	              CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END)
	FROM relation_entries AS entry
	WHERE entry.relkind = 'S'
	  AND entry.privilege_type IN ('USAGE', 'UPDATE')
	  AND (entry.grantee = 0 OR entry.grantee = (SELECT role_oid FROM guest_role))
	UNION
	-- Functions without an ACL are executable by PUBLIC; acldefault makes that entry visible.
	SELECT DISTINCT 'definer_trigger_function',
	       CASE WHEN entry.grantor = trigger_function.proowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE EXECUTE ON FUNCTION %s FROM %s', trigger_function.qualified_name,
	              CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END)
	FROM definer_trigger_functions AS trigger_function
	CROSS JOIN LATERAL aclexplode(coalesce(trigger_function.proacl,
	                                       acldefault('f', trigger_function.proowner))) AS entry
	WHERE entry.privilege_type = 'EXECUTE'
	  AND (entry.grantee = 0 OR entry.grantee IN (SELECT role_oid FROM runtime_roles))
	UNION
	-- Tables and sequences created later must not hand the guest or PUBLIC those rights again.
	SELECT DISTINCT 'default_privilege', '',
	       format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE %s ON %s FROM %s',
	              pg_get_userbyid(default_entry.defaclrole),
	              CASE WHEN default_entry.defaclnamespace = 0 THEN ''
	                   ELSE format(' IN SCHEMA %I', default_schema.nspname) END,
	              CASE default_entry.defaclobjtype WHEN 'S' THEN 'USAGE, UPDATE'
	                   ELSE 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER' END,
	              CASE default_entry.defaclobjtype WHEN 'S' THEN 'SEQUENCES' ELSE 'TABLES' END,
	              CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END)
	FROM pg_default_acl AS default_entry
	LEFT JOIN pg_namespace AS default_schema ON default_schema.oid = default_entry.defaclnamespace
	CROSS JOIN LATERAL aclexplode(default_entry.defaclacl) AS entry
	WHERE (entry.grantee = 0 OR entry.grantee = (SELECT role_oid FROM guest_role))
	  AND ((default_entry.defaclobjtype = 'r' AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges))
	       OR (default_entry.defaclobjtype = 'S' AND entry.privilege_type IN ('USAGE', 'UPDATE')))
)
SELECT category, acting_role, statement
FROM revocations
ORDER BY category, acting_role, statement`

// runtimeWriteRevocationViolationsSQL checks the promise itself with the
// has_*_privilege functions, which also see PUBLIC, memberships and column
// grants. Any text it returns stops the start with the change rolled back.
const runtimeWriteRevocationViolationsSQL = runtimeWriteRevocationScope + `
SELECT concat_ws('; ',
	(SELECT format('the guest role can still write %s table(s) or view(s), for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM guest_role AS guest
	 CROSS JOIN user_tables AS relation
	 CROSS JOIN write_privileges AS privilege
	 WHERE CASE WHEN privilege.privilege_name IN ('INSERT', 'UPDATE', 'REFERENCES')
	            THEN has_any_column_privilege(guest.role_oid, relation.oid, privilege.privilege_name)
	            ELSE has_table_privilege(guest.role_oid, relation.oid, privilege.privilege_name) END
	 HAVING count(*) > 0),
	(SELECT format('the guest role can still use %s sequence(s), for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM guest_role AS guest
	 CROSS JOIN user_sequences AS relation
	 WHERE has_sequence_privilege(guest.role_oid, relation.oid, 'USAGE')
	    OR has_sequence_privilege(guest.role_oid, relation.oid, 'UPDATE')
	 HAVING count(*) > 0),
	(SELECT 'default privileges still give the guest role or PUBLIC write rights on future tables or sequences'
	 WHERE EXISTS (
	     SELECT 1
	     FROM pg_default_acl AS default_entry
	     CROSS JOIN LATERAL aclexplode(default_entry.defaclacl) AS entry
	     WHERE (entry.grantee = 0 OR entry.grantee = (SELECT role_oid FROM guest_role))
	       AND ((default_entry.defaclobjtype = 'r' AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges))
	            OR (default_entry.defaclobjtype = 'S' AND entry.privilege_type IN ('USAGE', 'UPDATE'))))),
	(SELECT format('runtime roles can still write %s privilege-editing view(s), for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM runtime_roles AS runtime
	 CROSS JOIN user_tables AS relation
	 CROSS JOIN write_privileges AS privilege
	 WHERE relation.oid IN (SELECT oid FROM privilege_views)
	   AND CASE WHEN privilege.privilege_name IN ('INSERT', 'UPDATE', 'REFERENCES')
	            THEN has_any_column_privilege(runtime.role_oid, relation.oid, privilege.privilege_name)
	            ELSE has_table_privilege(runtime.role_oid, relation.oid, privilege.privilege_name) END
	 HAVING count(*) > 0),
	(SELECT format('runtime roles can still execute %s trigger function(s) that run with their owner''s rights, for example %s',
	               count(DISTINCT trigger_function.oid), min(trigger_function.qualified_name))
	 FROM runtime_roles AS runtime
	 CROSS JOIN definer_trigger_functions AS trigger_function
	 WHERE has_function_privilege(runtime.role_oid, trigger_function.oid, 'EXECUTE')
	 HAVING count(*) > 0)
)`

// runtimeWriteRevocation is one catalog entry to remove and the role that must
// remove it, because only the grantor's own REVOKE clears a grant.
type runtimeWriteRevocation struct {
	category   string
	actingRole string
	statement  string
}

// configuredRuntimeWriteRevocationRoles reads and validates the four runtime
// role names before any statement reaches the database.
func configuredRuntimeWriteRevocationRoles() ([]string, error) {
	roles := make([]string, 0, len(runtimeWriteRevocationRoleKeys))
	for _, environmentKey := range runtimeWriteRevocationRoleKeys {
		rawRoleName := strings.TrimSpace(os.Getenv(environmentKey))
		if rawRoleName == "" {
			return nil, fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations: %s is not set", environmentKey)
		}
		roleName, err := security.SanitizeIdentifier(rawRoleName)
		if err != nil {
			return nil, fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations %s: %w", environmentKey, err)
		}
		roles = append(roles, roleName)
	}

	protectedRoles := map[string]string{"postgres": "PostgreSQL superuser"}
	for _, environmentKey := range runtimeWriteRevocationProtectedRoleKeys {
		if roleName := strings.TrimSpace(os.Getenv(environmentKey)); roleName != "" {
			protectedRoles[roleName] = environmentKey
		}
	}
	for index, roleName := range roles {
		if protectedBy, protected := protectedRoles[roleName]; protected {
			return nil, fmt.Errorf(
				"EnsureGuestAndPrivilegeViewWriteRevocations: %s must not equal protected role %s (%s)",
				runtimeWriteRevocationRoleKeys[index],
				roleName,
				protectedBy,
			)
		}
	}

	// Removing the guest's writes from a role that is also the signed-in or the
	// confidential role would remove that role's writes too. The read-only role
	// writes nothing, so it may share the guest's name.
	for index := 1; index < len(roles); index++ {
		if roles[index] == roles[0] && runtimeWriteRevocationRoleKeys[index] != "DB_READONLY_USER" {
			return nil, fmt.Errorf(
				"EnsureGuestAndPrivilegeViewWriteRevocations: DB_GUEST_USER must differ from %s",
				runtimeWriteRevocationRoleKeys[index],
			)
		}
	}
	return roles, nil
}

// EnsureGuestAndPrivilegeViewWriteRevocations removes, at every start, each
// write right the guest role holds, and each runtime role's use of the
// privilege-editing views and of trigger functions that run with their owner's
// rights. Visitors never write on their own connection (sign-in, registration,
// comments and logs use the administrator or confidential connection), so the
// database itself now refuses what the application already refuses. Every other
// right of the basic, read-only and confidential roles is left as found and
// compared afterwards; any difference, an unsafe role setup or a right that
// could not be removed rolls the whole change back and stops the start.
func EnsureGuestAndPrivilegeViewWriteRevocations(db *sql.DB) error {
	roles, err := configuredRuntimeWriteRevocationRoles()
	if err != nil {
		return err
	}
	roleArguments := []interface{}{roles[0], roles[1], roles[2], roles[3]}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations begin: %w", err)
	}
	defer tx.Rollback()

	// Two instances starting against one database must not change the same
	// catalog rows at once; the lock ends with the transaction.
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))`); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations lock: %w", err)
	}

	var problems string
	if err := tx.QueryRow(runtimeWriteRevocationPreconditionSQL, roleArguments...).Scan(&problems); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations inspect roles: %w", err)
	}
	if problems != "" {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations: unsafe runtime role setup: %s", problems)
	}

	var keptBefore string
	if err := tx.QueryRow(runtimeWriteRevocationKeptRightsSQL, roleArguments...).Scan(&keptBefore); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations read kept rights: %w", err)
	}

	revocations, err := listRuntimeWriteRevocations(tx, roleArguments)
	if err != nil {
		return err
	}
	for _, revocation := range revocations {
		if err := applyRuntimeWriteRevocation(tx, revocation); err != nil {
			return err
		}
	}

	var keptAfter string
	if err := tx.QueryRow(runtimeWriteRevocationKeptRightsSQL, roleArguments...).Scan(&keptAfter); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations reread kept rights: %w", err)
	}
	if keptAfter != keptBefore {
		return fmt.Errorf(
			"EnsureGuestAndPrivilegeViewWriteRevocations: refused because other roles' rights would change (%s); a right granted to PUBLIC may be what they rely on",
			describeKeptRightsDifference(keptBefore, keptAfter),
		)
	}

	var violations string
	if err := tx.QueryRow(runtimeWriteRevocationViolationsSQL, roleArguments...).Scan(&violations); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations verify: %w", err)
	}
	if violations != "" {
		return fmt.Errorf(
			"EnsureGuestAndPrivilegeViewWriteRevocations: rights remain after the revocations (%s); the connecting role must be a superuser, or own these objects and be a member of their grantors",
			violations,
		)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations commit: %w", err)
	}
	logRuntimeWriteRevocations(revocations)
	return nil
}

func listRuntimeWriteRevocations(tx *sql.Tx, roleArguments []interface{}) ([]runtimeWriteRevocation, error) {
	rows, err := tx.Query(runtimeWriteRevocationStatementsSQL, roleArguments...)
	if err != nil {
		return nil, fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations list grants: %w", err)
	}
	defer rows.Close()
	var revocations []runtimeWriteRevocation
	for rows.Next() {
		var revocation runtimeWriteRevocation
		if err := rows.Scan(&revocation.category, &revocation.actingRole, &revocation.statement); err != nil {
			return nil, fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations read grant: %w", err)
		}
		revocations = append(revocations, revocation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations list grants: %w", err)
	}
	return revocations, nil
}

// applyRuntimeWriteRevocation runs one generated statement, as its grantor when
// the owner did not grant it. Only the two statement forms the catalog query
// produces are ever executed.
func applyRuntimeWriteRevocation(tx *sql.Tx, revocation runtimeWriteRevocation) error {
	if !strings.HasPrefix(revocation.statement, "REVOKE ") &&
		!strings.HasPrefix(revocation.statement, "ALTER DEFAULT PRIVILEGES FOR ROLE ") {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations: refused unexpected statement %q", revocation.statement)
	}
	if revocation.actingRole != "" {
		if _, err := tx.Exec("SET LOCAL ROLE " + pq.QuoteIdentifier(revocation.actingRole)); err != nil {
			return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations act as grantor for %q: %w", revocation.statement, err)
		}
	}
	if _, err := tx.Exec(revocation.statement); err != nil {
		return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations %q: %w", revocation.statement, err)
	}
	if revocation.actingRole != "" {
		if _, err := tx.Exec("RESET ROLE"); err != nil {
			return fmt.Errorf("EnsureGuestAndPrivilegeViewWriteRevocations reset role: %w", err)
		}
	}
	return nil
}

// describeKeptRightsDifference names up to five rights that would disappear or
// appear, so a refused start says exactly what would have changed.
func describeKeptRightsDifference(before, after string) string {
	beforeEntries := map[string]bool{}
	for _, entry := range strings.Split(before, "\n") {
		if entry != "" {
			beforeEntries[entry] = true
		}
	}
	afterEntries := map[string]bool{}
	for _, entry := range strings.Split(after, "\n") {
		if entry != "" {
			afterEntries[entry] = true
		}
	}
	var lost, gained []string
	for entry := range beforeEntries {
		if !afterEntries[entry] {
			lost = append(lost, entry)
		}
	}
	for entry := range afterEntries {
		if !beforeEntries[entry] {
			gained = append(gained, entry)
		}
	}
	sort.Strings(lost)
	sort.Strings(gained)
	return fmt.Sprintf("would lose %s; would gain %s", firstRuntimeWriteRevocationEntries(lost), firstRuntimeWriteRevocationEntries(gained))
}

func firstRuntimeWriteRevocationEntries(entries []string) string {
	if len(entries) == 0 {
		return "nothing"
	}
	if len(entries) > 5 {
		return fmt.Sprintf("%s and %d more", strings.Join(entries[:5], ", "), len(entries)-5)
	}
	return strings.Join(entries, ", ")
}

func logRuntimeWriteRevocations(revocations []runtimeWriteRevocation) {
	if len(revocations) == 0 {
		return
	}
	counts := map[string]int{}
	for _, revocation := range revocations {
		counts[revocation.category]++
	}
	log.Printf(
		"[RUNTIME ROLE WRITE REVOCATIONS] removed guest or PUBLIC write grants: %d on tables or views, %d on sequences, %d in default privileges; privilege-editing view grants: %d; EXECUTE grants on trigger functions that run with their owner's rights: %d",
		counts["guest_relation"],
		counts["guest_sequence"],
		counts["default_privilege"],
		counts["privilege_view"],
		counts["definer_trigger_function"],
	)
}
