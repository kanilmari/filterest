// account_table_write_revocations.go
// Removes every runtime role's write rights on the account and rights tables, and every write right the
// confidential role holds in schema public (WL124, stage 2a).
// Bridges the configured, installation-specific role names with catalog-driven REVOKE statements, built like
// stage 1 (runtime_role_write_revocations.go), whose role checks and grantor-aware execution it reuses unchanged.
// Exists so the database itself refuses an ordinary account that tries to make itself an administrator, join a
// group or change a right, whatever route rights a site grants, and so the credential connection can change
// nothing outside its own schema.
package backend

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
)

// accountTableTargets extends stage 1's scope (runtimeWriteRevocationScope, which expects $1 guest, $2 basic,
// $3 readonly and $4 confidential role names) with the objects this step reasons about:
//   - account_tables: the five tables that decide who is a user, who belongs to which group and what each group
//     may do;
//   - account_relations: those tables and every view or materialized view that depends on them, directly or
//     through other views; a write through an auto-updatable view runs with the view owner's rights;
//   - account_sequences: the sequences the five tables' column defaults draw from, or that they own;
//   - public_relations: every relation and sequence in schema public, for the confidential role.
const accountTableTargets = `,
account_tables AS (
	SELECT relation.oid
	FROM pg_class AS relation
	JOIN pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
	WHERE relation_schema.nspname = 'public'
	  AND relation.relkind IN ('r', 'p')
	  AND relation.relname IN ('system_users', 'system_user_groups', 'system_user_group_memberships',
	                           'system_group_table_func_rights', 'system_functions')
),
account_relations AS (
	SELECT closure.oid
	FROM (
		WITH RECURSIVE dependent (oid) AS (
			SELECT oid FROM account_tables
			UNION
			SELECT view_rule.ev_class
			FROM dependent
			JOIN pg_depend AS dependency
			  ON dependency.refclassid = 'pg_class'::regclass
			 AND dependency.refobjid = dependent.oid
			 AND dependency.classid = 'pg_rewrite'::regclass
			JOIN pg_rewrite AS view_rule ON view_rule.oid = dependency.objid
			JOIN pg_class AS dependent_view
			  ON dependent_view.oid = view_rule.ev_class AND dependent_view.relkind IN ('v', 'm')
			WHERE view_rule.ev_class <> dependent.oid
		)
		SELECT oid FROM dependent
	) AS closure
),
account_sequences AS (
	SELECT dependency.refobjid AS oid
	FROM pg_attrdef AS column_default
	JOIN pg_depend AS dependency
	  ON dependency.classid = 'pg_attrdef'::regclass
	 AND dependency.objid = column_default.oid
	 AND dependency.refclassid = 'pg_class'::regclass
	JOIN pg_class AS sequence_relation
	  ON sequence_relation.oid = dependency.refobjid AND sequence_relation.relkind = 'S'
	WHERE column_default.adrelid IN (SELECT oid FROM account_tables)
	UNION
	SELECT dependency.objid
	FROM pg_depend AS dependency
	JOIN pg_class AS sequence_relation
	  ON sequence_relation.oid = dependency.objid AND sequence_relation.relkind = 'S'
	WHERE dependency.classid = 'pg_class'::regclass
	  AND dependency.refclassid = 'pg_class'::regclass
	  AND dependency.refobjid IN (SELECT oid FROM account_tables)
	  AND dependency.deptype IN ('a', 'i')
),
confidential_role AS (
	SELECT role_oid FROM runtime_roles WHERE label = 'confidential'
),
public_relations AS (
	SELECT relation.oid, relation.relkind, relation.relowner, relation.qualified_name
	FROM user_relations AS relation
	JOIN pg_class AS relation_row ON relation_row.oid = relation.oid
	JOIN pg_namespace AS relation_schema ON relation_schema.oid = relation_row.relnamespace
	WHERE relation_schema.nspname = 'public'
)`

const accountTableScope = runtimeWriteRevocationScope + accountTableTargets

// accountTableWriteRevocationLockSQL is stage 1's advisory lock: starts of several instances then serialize across
// both steps, so one instance's commit can never fall between another instance's before and after reads.
const accountTableWriteRevocationLockSQL = `SELECT pg_advisory_xact_lock(hashtext('filterest.runtime_role_write_revocations'))`

// accountTableWriteRevocationPreconditionSQL names every role setup in which the revocations could not keep their
// promise. An empty result means it is safe to go on.
const accountTableWriteRevocationPreconditionSQL = accountTableScope + `
SELECT concat_ws('; ',
	(SELECT 'role not found: ' || string_agg(label, ', ' ORDER BY label)
	 FROM runtime_roles WHERE role_oid IS NULL HAVING count(*) > 0),
	(SELECT 'role is a superuser: ' || string_agg(runtime.label, ', ' ORDER BY runtime.label)
	 FROM runtime_roles AS runtime
	 JOIN pg_roles AS role_row ON role_row.oid = runtime.role_oid
	 WHERE role_row.rolsuper HAVING count(*) > 0),
	(SELECT 'role inherits rights as a member of another role: ' || string_agg(DISTINCT runtime.label, ', ')
	 FROM runtime_roles AS runtime
	 JOIN pg_auth_members AS membership ON membership.member = runtime.role_oid
	 HAVING count(*) > 0),
	(SELECT 'role is the connecting role: ' || string_agg(runtime.label, ', ' ORDER BY runtime.label)
	 FROM runtime_roles AS runtime
	 JOIN pg_roles AS role_row ON role_row.oid = runtime.role_oid
	 WHERE role_row.rolname = current_user HAVING count(*) > 0),
	(SELECT 'a runtime role owns an account table, a view over one or an account sequence: '
	        || string_agg(DISTINCT runtime.label, ', ')
	 FROM runtime_roles AS runtime
	 JOIN pg_class AS relation ON relation.relowner = runtime.role_oid
	 WHERE relation.oid IN (SELECT oid FROM account_relations UNION SELECT oid FROM account_sequences)
	 HAVING count(*) > 0),
	(SELECT 'the confidential role owns ' || count(*) || ' relation(s) in schema public'
	 FROM public_relations
	 WHERE relowner = (SELECT role_oid FROM confidential_role) HAVING count(*) > 0)
)`

// accountTableNamesSQL lists the account tables and the views over them by name, as the configured writers name
// their destinations (unqualified, resolved in schema public).
const accountTableNamesSQL = accountTableScope + `
SELECT relation.relname::text
FROM pg_class AS relation
WHERE relation.oid IN (SELECT oid FROM account_relations)
ORDER BY 1`

// accountTableRegistrySQL says whether the optional automation table and the relation registry exist.
const accountTableRegistrySQL = `
SELECT to_regclass('public.system_triggers') IS NOT NULL,
       to_regclass('public.system_foreign_key_relations_1_m') IS NOT NULL
       AND to_regclass('public.system_db_tables') IS NOT NULL`

// accountTableAutomationTargetsSQL lists every automation's destination (ExecuteTriggers → executeAction,
// dtt_triggers/notification_triggers.go), which writes on the caller's connection without a route check.
const accountTableAutomationTargetsSQL = `
SELECT id::text, btrim(target_table::text)
FROM public.system_triggers
ORDER BY id`

// accountTableCacheTargetsSQL lists every file-upload cache target (updateCacheTargetsBase,
// dtt_1_row_create/row_cache_saver.go), which also writes on the caller's connection without a route check.
const accountTableCacheTargetsSQL = `
SELECT relation.id::text, btrim(cache_target ->> 'table')
FROM public.system_foreign_key_relations_1_m AS relation
CROSS JOIN LATERAL jsonb_array_elements(
	CASE WHEN jsonb_typeof(relation.target_insert_specs::jsonb -> 'file_upload' -> 'cache_targets') = 'array'
	     THEN relation.target_insert_specs::jsonb -> 'file_upload' -> 'cache_targets'
	     ELSE '[]'::jsonb END) AS cache_target
WHERE jsonb_typeof(cache_target) = 'object' AND cache_target ? 'table'
ORDER BY relation.id`

// accountTableGalleryParentsSQL lists every relation in schema public with a card picture field: the card picture
// rule (dtt_asset_linking.ApplyCardPictureRule) writes such a parent and may add a row to its gallery.
const accountTableGalleryParentsSQL = `
SELECT DISTINCT relation.relname::text
FROM pg_class AS relation
JOIN pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
JOIN pg_attribute AS image_column
  ON image_column.attrelid = relation.oid
 AND image_column.attname = 'cached_image'
 AND image_column.attnum > 0
 AND NOT image_column.attisdropped
WHERE relation_schema.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY 1`

// accountTableKeptRightsSQL lists every right of the four runtime roles except the writes this step removes,
// reads included, down to single columns. It is read before and after the revocations and the two lists must
// match, so the step can never narrow anything else.
const accountTableKeptRightsSQL = accountTableScope + `,
table_privileges (privilege_name, is_write) AS (
	VALUES ('SELECT', false), ('INSERT', true), ('UPDATE', true), ('DELETE', true),
	       ('TRUNCATE', true), ('REFERENCES', true), ('TRIGGER', true)
),
sequence_privileges (privilege_name, is_write) AS (
	VALUES ('SELECT', false), ('USAGE', true), ('UPDATE', true)
)
SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '')
FROM (
	SELECT format('%s %s %s', runtime.label, relation.qualified_name, privilege.privilege_name) AS entry
	FROM runtime_roles AS runtime
	CROSS JOIN user_tables AS relation
	CROSS JOIN table_privileges AS privilege
	WHERE runtime.role_oid IS NOT NULL
	  AND has_table_privilege(runtime.role_oid, relation.oid, privilege.privilege_name)
	  AND NOT (privilege.is_write AND relation.oid IN (SELECT oid FROM account_relations))
	  AND NOT (privilege.is_write AND runtime.role_oid = (SELECT role_oid FROM confidential_role)
	           AND relation.oid IN (SELECT oid FROM public_relations))
	UNION ALL
	SELECT format('%s %s(%s) %s', runtime.label, relation.qualified_name,
	              quote_ident(table_column.attname), privilege.privilege_name)
	FROM runtime_roles AS runtime
	CROSS JOIN user_tables AS relation
	JOIN pg_attribute AS table_column
	  ON table_column.attrelid = relation.oid AND table_column.attnum > 0 AND NOT table_column.attisdropped
	CROSS JOIN table_privileges AS privilege
	WHERE runtime.role_oid IS NOT NULL
	  AND privilege.privilege_name IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
	  AND NOT has_table_privilege(runtime.role_oid, relation.oid, privilege.privilege_name)
	  AND has_column_privilege(runtime.role_oid, relation.oid, table_column.attnum, privilege.privilege_name)
	  AND NOT (privilege.is_write AND relation.oid IN (SELECT oid FROM account_relations))
	  AND NOT (privilege.is_write AND runtime.role_oid = (SELECT role_oid FROM confidential_role)
	           AND relation.oid IN (SELECT oid FROM public_relations))
	UNION ALL
	SELECT format('%s %s %s', runtime.label, relation.qualified_name, privilege.privilege_name)
	FROM runtime_roles AS runtime
	CROSS JOIN user_sequences AS relation
	CROSS JOIN sequence_privileges AS privilege
	WHERE runtime.role_oid IS NOT NULL
	  AND has_sequence_privilege(runtime.role_oid, relation.oid, privilege.privilege_name)
	  AND NOT (privilege.is_write AND relation.oid IN (SELECT oid FROM account_sequences))
	  AND NOT (privilege.is_write AND runtime.role_oid = (SELECT role_oid FROM confidential_role)
	           AND relation.oid IN (SELECT oid FROM public_relations))
) AS kept_rights`

// accountTableWriteRevocationStatementsSQL turns every catalog entry this step removes into the REVOKE that
// removes it, with identifiers quoted by PostgreSQL. A table-level REVOKE also clears that grantor's column-level
// entries; an entry is removed as the role that granted it (applyRuntimeWriteRevocation). PUBLIC needs nothing
// here: stage 1 has just removed every write PUBLIC held.
const accountTableWriteRevocationStatementsSQL = accountTableScope + `,
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
	-- No runtime role writes an account table or a view over one.
	SELECT DISTINCT 'account_relation',
	       CASE WHEN entry.grantor = entry.relowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM %s',
	              entry.qualified_name, quote_ident(pg_get_userbyid(entry.grantee)))
	FROM relation_entries AS entry
	WHERE entry.relkind <> 'S'
	  AND entry.oid IN (SELECT oid FROM account_relations)
	  AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges)
	  AND entry.grantee IN (SELECT role_oid FROM runtime_roles WHERE role_oid IS NOT NULL)
	UNION
	-- Nor draws or sets the values of their sequences.
	SELECT DISTINCT 'account_sequence',
	       CASE WHEN entry.grantor = entry.relowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE USAGE, UPDATE ON SEQUENCE %s FROM %s',
	              entry.qualified_name, quote_ident(pg_get_userbyid(entry.grantee)))
	FROM relation_entries AS entry
	WHERE entry.relkind = 'S'
	  AND entry.oid IN (SELECT oid FROM account_sequences)
	  AND entry.privilege_type IN ('USAGE', 'UPDATE')
	  AND entry.grantee IN (SELECT role_oid FROM runtime_roles WHERE role_oid IS NOT NULL)
	UNION
	-- The confidential role writes nothing in schema public; it reads system_users (id, enabled) only.
	SELECT DISTINCT 'confidential_relation',
	       CASE WHEN entry.grantor = entry.relowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM %s',
	              entry.qualified_name, quote_ident(pg_get_userbyid(entry.grantee)))
	FROM relation_entries AS entry
	WHERE entry.relkind <> 'S'
	  AND entry.oid IN (SELECT oid FROM public_relations)
	  AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges)
	  AND entry.grantee = (SELECT role_oid FROM confidential_role)
	UNION
	SELECT DISTINCT 'confidential_sequence',
	       CASE WHEN entry.grantor = entry.relowner THEN '' ELSE pg_get_userbyid(entry.grantor) END,
	       format('REVOKE USAGE, UPDATE ON SEQUENCE %s FROM %s',
	              entry.qualified_name, quote_ident(pg_get_userbyid(entry.grantee)))
	FROM relation_entries AS entry
	WHERE entry.relkind = 'S'
	  AND entry.oid IN (SELECT oid FROM public_relations)
	  AND entry.privilege_type IN ('USAGE', 'UPDATE')
	  AND entry.grantee = (SELECT role_oid FROM confidential_role)
	UNION
	-- Nor does it receive write rights on tables or sequences created later in schema public.
	SELECT DISTINCT 'confidential_default', '',
	       format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE %s ON %s FROM %s',
	              pg_get_userbyid(default_entry.defaclrole),
	              CASE WHEN default_entry.defaclnamespace = 0 THEN ''
	                   ELSE format(' IN SCHEMA %I', default_schema.nspname) END,
	              CASE default_entry.defaclobjtype WHEN 'S' THEN 'USAGE, UPDATE'
	                   ELSE 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER' END,
	              CASE default_entry.defaclobjtype WHEN 'S' THEN 'SEQUENCES' ELSE 'TABLES' END,
	              quote_ident(pg_get_userbyid(entry.grantee)))
	FROM pg_default_acl AS default_entry
	LEFT JOIN pg_namespace AS default_schema ON default_schema.oid = default_entry.defaclnamespace
	CROSS JOIN LATERAL aclexplode(default_entry.defaclacl) AS entry
	WHERE entry.grantee = (SELECT role_oid FROM confidential_role)
	  AND (default_entry.defaclnamespace = 0 OR default_schema.nspname = 'public')
	  AND ((default_entry.defaclobjtype = 'r' AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges))
	       OR (default_entry.defaclobjtype = 'S' AND entry.privilege_type IN ('USAGE', 'UPDATE')))
)
SELECT category, acting_role, statement
FROM revocations
ORDER BY category, acting_role, statement`

// accountTableWriteRevocationViolationsSQL checks the promise itself with the has_*_privilege functions, which
// also see PUBLIC, memberships and column grants. Any text it returns stops the start with the change rolled back.
const accountTableWriteRevocationViolationsSQL = accountTableScope + `
SELECT concat_ws('; ',
	(SELECT format('runtime roles can still write %s account table(s) or view(s) over them, for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM runtime_roles AS runtime
	 CROSS JOIN user_tables AS relation
	 CROSS JOIN write_privileges AS privilege
	 WHERE runtime.role_oid IS NOT NULL
	   AND relation.oid IN (SELECT oid FROM account_relations)
	   AND CASE WHEN privilege.privilege_name IN ('INSERT', 'UPDATE', 'REFERENCES')
	            THEN has_any_column_privilege(runtime.role_oid, relation.oid, privilege.privilege_name)
	            ELSE has_table_privilege(runtime.role_oid, relation.oid, privilege.privilege_name) END
	 HAVING count(*) > 0),
	(SELECT format('runtime roles can still use %s account sequence(s), for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM runtime_roles AS runtime
	 CROSS JOIN user_sequences AS relation
	 WHERE runtime.role_oid IS NOT NULL
	   AND relation.oid IN (SELECT oid FROM account_sequences)
	   AND (has_sequence_privilege(runtime.role_oid, relation.oid, 'USAGE')
	        OR has_sequence_privilege(runtime.role_oid, relation.oid, 'UPDATE'))
	 HAVING count(*) > 0),
	(SELECT format('the confidential role can still write %s relation(s) in schema public, for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM confidential_role AS confidential
	 CROSS JOIN public_relations AS relation
	 CROSS JOIN write_privileges AS privilege
	 WHERE relation.relkind <> 'S'
	   AND CASE WHEN privilege.privilege_name IN ('INSERT', 'UPDATE', 'REFERENCES')
	            THEN has_any_column_privilege(confidential.role_oid, relation.oid, privilege.privilege_name)
	            ELSE has_table_privilege(confidential.role_oid, relation.oid, privilege.privilege_name) END
	 HAVING count(*) > 0),
	(SELECT format('the confidential role can still use %s sequence(s) in schema public, for example %s',
	               count(DISTINCT relation.oid), min(relation.qualified_name))
	 FROM confidential_role AS confidential
	 CROSS JOIN public_relations AS relation
	 WHERE relation.relkind = 'S'
	   AND (has_sequence_privilege(confidential.role_oid, relation.oid, 'USAGE')
	        OR has_sequence_privilege(confidential.role_oid, relation.oid, 'UPDATE'))
	 HAVING count(*) > 0),
	(SELECT 'default privileges still give the confidential role write rights on future tables or sequences in schema public'
	 WHERE EXISTS (
	     SELECT 1
	     FROM pg_default_acl AS default_entry
	     LEFT JOIN pg_namespace AS default_schema ON default_schema.oid = default_entry.defaclnamespace
	     CROSS JOIN LATERAL aclexplode(default_entry.defaclacl) AS entry
	     WHERE entry.grantee = (SELECT role_oid FROM confidential_role)
	       AND (default_entry.defaclnamespace = 0 OR default_schema.nspname = 'public')
	       AND ((default_entry.defaclobjtype = 'r' AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges))
	            OR (default_entry.defaclobjtype = 'S' AND entry.privilege_type IN ('USAGE', 'UPDATE')))))
)`

// accountTableOwnerRightsReviewSQL counts the SQL paths that run with their owner's rights and that the
// revocations therefore cannot stop: SECURITY DEFINER functions a runtime role may call, owner-run triggers and
// rules on relations a runtime role may write, and event triggers. A body search cannot certify that none of them
// writes an account table (dynamic SQL is invisible), so the counts are reported for review, not judged.
const accountTableOwnerRightsReviewSQL = accountTableScope + `,
runtime_writable (oid) AS (
	SELECT DISTINCT relation.oid
	FROM user_tables AS relation
	CROSS JOIN runtime_roles AS runtime
	WHERE runtime.role_oid IS NOT NULL
	  AND (has_any_column_privilege(runtime.role_oid, relation.oid, 'INSERT')
	       OR has_any_column_privilege(runtime.role_oid, relation.oid, 'UPDATE')
	       OR has_table_privilege(runtime.role_oid, relation.oid, 'DELETE'))
)
SELECT
	(SELECT count(*)
	 FROM pg_proc AS function_row
	 JOIN pg_namespace AS function_schema ON function_schema.oid = function_row.pronamespace
	 WHERE function_row.prosecdef
	   AND function_schema.nspname <> 'information_schema'
	   AND function_schema.nspname !~ '^pg_'
	   AND EXISTS (SELECT 1 FROM runtime_roles AS runtime
	               WHERE runtime.role_oid IS NOT NULL
	                 AND has_function_privilege(runtime.role_oid, function_row.oid, 'EXECUTE'))),
	(SELECT count(*)
	 FROM pg_trigger AS trigger_row
	 JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
	 WHERE NOT trigger_row.tgisinternal
	   AND function_row.prosecdef
	   AND trigger_row.tgrelid IN (SELECT oid FROM runtime_writable)),
	(SELECT count(*)
	 FROM pg_rewrite AS rule_row
	 WHERE rule_row.ev_type <> '1'
	   AND rule_row.ev_class IN (SELECT oid FROM runtime_writable)),
	(SELECT count(*) FROM pg_event_trigger)`

// accountTableWriteTargetSQL answers whether $5 names an account table or a view over one. The runtime-role
// arguments are unused and passed empty.
const accountTableWriteTargetSQL = accountTableScope + `
SELECT EXISTS (
	SELECT 1
	FROM pg_class AS relation
	WHERE relation.oid IN (SELECT oid FROM account_relations)
	  AND relation.relname::text = btrim($5::text)
)`

// accountTableWriteRestoreSQL writes, for each grant and default privilege this step would remove, the psql line
// that gives it back exactly, grant option included. The application never runs it: the pre-update dry run saves its
// output as each site's recovery script (data/migration_inventory/2026-10-04/wl124-stage2/), run with psql, and the
// round-trip test runs such a script with psql after the step and finds every entry back. Role names appear only as
// psql variables, so a saved script names no role: :"basic_role" and the like for the configured roles ($5 and $6
// are the administrator and main role names, used only to label grantors and default-privilege owners), and
// :"role_<oid>" for any other grantor or creator, which the script's first lines look up by OID with psql's \gset;
// a role that no longer exists stops the script at that line.
const accountTableWriteRestoreSQL = accountTableScope + `,
labelled_roles (label, role_oid) AS (
	SELECT DISTINCT ON (candidate.role_oid) candidate.label || '_role', candidate.role_oid
	FROM (
		SELECT label, role_oid, 1 AS rank FROM runtime_roles WHERE role_oid IS NOT NULL
		UNION ALL
		SELECT 'admin', oid, 2 FROM pg_roles WHERE rolname = $5::text
		UNION ALL
		SELECT 'main', oid, 3 FROM pg_roles WHERE rolname = $6::text
	) AS candidate
	ORDER BY candidate.role_oid, candidate.rank, candidate.label
),
restorable_entries AS (
	SELECT relation.oid, relation.relkind, relation.relowner, relation.qualified_name, NULL::text AS column_name,
	       entry.grantor, entry.grantee, entry.privilege_type, entry.is_grantable
	FROM user_relations AS relation
	CROSS JOIN LATERAL aclexplode(relation.relacl) AS entry
	UNION ALL
	SELECT relation.oid, relation.relkind, relation.relowner, relation.qualified_name, table_column.attname::text,
	       entry.grantor, entry.grantee, entry.privilege_type, entry.is_grantable
	FROM user_tables AS relation
	JOIN pg_attribute AS table_column
	  ON table_column.attrelid = relation.oid AND table_column.attacl IS NOT NULL AND NOT table_column.attisdropped
	CROSS JOIN LATERAL aclexplode(table_column.attacl) AS entry
),
removed_entries AS (
	SELECT entry.*
	FROM restorable_entries AS entry
	WHERE (entry.relkind <> 'S'
	       AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges)
	       AND ((entry.oid IN (SELECT oid FROM account_relations)
	             AND entry.grantee IN (SELECT role_oid FROM runtime_roles WHERE role_oid IS NOT NULL))
	            OR (entry.oid IN (SELECT oid FROM public_relations)
	                AND entry.grantee = (SELECT role_oid FROM confidential_role))))
	   OR (entry.relkind = 'S'
	       AND entry.privilege_type IN ('USAGE', 'UPDATE')
	       AND ((entry.oid IN (SELECT oid FROM account_sequences)
	             AND entry.grantee IN (SELECT role_oid FROM runtime_roles WHERE role_oid IS NOT NULL))
	            OR (entry.oid IN (SELECT oid FROM public_relations)
	                AND entry.grantee = (SELECT role_oid FROM confidential_role))))
),
removed_defaults AS (
	SELECT default_entry.defaclrole, default_entry.defaclnamespace, default_schema.nspname::text AS schema_name,
	       default_entry.defaclobjtype, entry.grantee, entry.privilege_type, entry.is_grantable
	FROM pg_default_acl AS default_entry
	LEFT JOIN pg_namespace AS default_schema ON default_schema.oid = default_entry.defaclnamespace
	CROSS JOIN LATERAL aclexplode(default_entry.defaclacl) AS entry
	WHERE entry.grantee = (SELECT role_oid FROM confidential_role)
	  AND (default_entry.defaclnamespace = 0 OR default_schema.nspname = 'public')
	  AND ((default_entry.defaclobjtype = 'r' AND entry.privilege_type IN (SELECT privilege_name FROM write_privileges))
	       OR (default_entry.defaclobjtype = 'S' AND entry.privilege_type IN ('USAGE', 'UPDATE')))
),
unlabelled_roles (role_oid) AS (
	SELECT entry.grantor FROM removed_entries AS entry
	WHERE entry.grantor <> entry.relowner AND entry.grantor NOT IN (SELECT role_oid FROM labelled_roles)
	UNION
	SELECT defaults.defaclrole FROM removed_defaults AS defaults
	WHERE defaults.defaclrole NOT IN (SELECT role_oid FROM labelled_roles)
),
role_references (role_oid, reference) AS (
	SELECT role_oid, format(':"%s"', label) FROM labelled_roles
	UNION ALL
	SELECT role_oid, format(':"role_%s"', role_oid) FROM unlabelled_roles
),
lookup_lines AS (
	SELECT 0 AS part, '' AS sort_key,
	       format('SELECT rolname AS role_%s FROM pg_catalog.pg_roles WHERE oid = %s \gset', role_oid, role_oid) AS line
	FROM unlabelled_roles
),
grant_lines AS (
	SELECT 1 AS part, entry.qualified_name AS sort_key,
	       CASE WHEN entry.grantor = entry.relowner THEN statement.grant_text
	            ELSE format('SET ROLE %s; %s RESET ROLE;', grantor_reference.reference, statement.grant_text) END AS line
	FROM removed_entries AS entry
	JOIN role_references AS grantee_reference ON grantee_reference.role_oid = entry.grantee
	LEFT JOIN role_references AS grantor_reference ON grantor_reference.role_oid = entry.grantor
	CROSS JOIN LATERAL (
		SELECT format('GRANT %s%s ON %s %s TO %s%s;',
		              entry.privilege_type,
		              CASE WHEN entry.column_name IS NULL THEN '' ELSE format(' (%I)', entry.column_name) END,
		              CASE WHEN entry.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
		              entry.qualified_name,
		              grantee_reference.reference,
		              CASE WHEN entry.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END) AS grant_text
	) AS statement
),
default_lines AS (
	SELECT 2 AS part, coalesce(defaults.schema_name, '') AS sort_key,
	       format('ALTER DEFAULT PRIVILEGES FOR ROLE %s%s GRANT %s ON %s TO %s%s;',
	              creator_reference.reference,
	              CASE WHEN defaults.defaclnamespace = 0 THEN '' ELSE format(' IN SCHEMA %I', defaults.schema_name) END,
	              defaults.privilege_type,
	              CASE defaults.defaclobjtype WHEN 'S' THEN 'SEQUENCES' ELSE 'TABLES' END,
	              grantee_reference.reference,
	              CASE WHEN defaults.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END) AS line
	FROM removed_defaults AS defaults
	JOIN role_references AS grantee_reference ON grantee_reference.role_oid = defaults.grantee
	JOIN role_references AS creator_reference ON creator_reference.role_oid = defaults.defaclrole
)
SELECT line
FROM (
	SELECT part, sort_key, line FROM lookup_lines
	UNION ALL
	SELECT part, sort_key, line FROM grant_lines
	UNION ALL
	SELECT part, sort_key, line FROM default_lines
) AS restore_lines
ORDER BY part, sort_key, line`

// accountTableGalleryChild returns the gallery child table that the card picture rule writes for parentTable, or
// "" when the table has no gallery. It is the runtime resolver itself, so the start-up gate and the writers agree
// on which relation a parent's gallery is; tests replace it.
var accountTableGalleryChild = func(tx *sql.Tx, parentTable string) (string, error) {
	relation, err := dtt_card_picture.PictureRelationOf(tx, parentTable)
	if err != nil || relation == nil {
		return "", err
	}
	return relation.ChildTable, nil
}

// accountTableOwnerRightsCounts are the owner-rights SQL paths left for review (plan_stage2.md, check C5d).
type accountTableOwnerRightsCounts struct {
	definerFunctions int64
	ownerTriggers    int64
	rules            int64
	eventTriggers    int64
}

func (counts accountTableOwnerRightsCounts) total() int64 {
	return counts.definerFunctions + counts.ownerTriggers + counts.rules + counts.eventTriggers
}

// configuredAccountTableRoles reads the four runtime role names as stage 1 does and refuses a confidential role
// that is also the signed-in users' role: removing its writes in public would remove theirs, and that role would
// hold the credential tables (ValidateConfig refuses the same setting before any grant).
func configuredAccountTableRoles() ([]string, error) {
	roles, err := configuredRuntimeWriteRevocationRoles()
	if err != nil {
		return nil, fmt.Errorf("EnsureAccountTableWriteRevocations: %w", err)
	}
	if roles[3] == roles[1] {
		return nil, fmt.Errorf("EnsureAccountTableWriteRevocations: DB_CONFIDENTIAL_USER must differ from DB_BASIC_USER")
	}
	return roles, nil
}

// EnsureAccountTableWriteRevocations removes, at every start, each write right the guest, basic, read-only and
// confidential roles hold on the five account and rights tables, on every view over them and on their sequences,
// and each write right the confidential role holds in schema public, its default privileges there included.
// Every application path that writes these tables uses the administrator connection; the only paths on an
// ordinary user's connection are the generic row tools pointed at them and configured writers (automations,
// file-upload caches, gallery maintenance), and a configured writer that names one of them stops the start before
// anything changes. Every other right of the four roles, reads included, is compared before and after; an unsafe
// setup, a configured writer on an account table, a right that would change elsewhere or one that survives rolls
// the whole step back and stops the start. Earlier start-up steps keep what they committed.
func EnsureAccountTableWriteRevocations(db *sql.DB) error {
	roles, err := configuredAccountTableRoles()
	if err != nil {
		return err
	}
	roleArguments := []interface{}{roles[0], roles[1], roles[2], roles[3]}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(accountTableWriteRevocationLockSQL); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations lock: %w", err)
	}

	var roleProblems string
	if err := tx.QueryRow(accountTableWriteRevocationPreconditionSQL, roleArguments...).Scan(&roleProblems); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations inspect roles: %w", err)
	}
	writerProblems, err := accountTableConfiguredWriterProblems(tx, roleArguments)
	if err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations inspect configured writers: %w", err)
	}
	if problems := joinAccountTableProblems(roleProblems, writerProblems); problems != "" {
		return fmt.Errorf("EnsureAccountTableWriteRevocations: unsafe setup, nothing changed: %s", problems)
	}

	var keptBefore string
	if err := tx.QueryRow(accountTableKeptRightsSQL, roleArguments...).Scan(&keptBefore); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations read kept rights: %w", err)
	}

	revocations, err := listAccountTableWriteRevocations(tx, roleArguments)
	if err != nil {
		return err
	}
	for _, revocation := range revocations {
		if err := applyRuntimeWriteRevocation(tx, revocation); err != nil {
			return fmt.Errorf("EnsureAccountTableWriteRevocations: %w", err)
		}
	}

	var keptAfter string
	if err := tx.QueryRow(accountTableKeptRightsSQL, roleArguments...).Scan(&keptAfter); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations reread kept rights: %w", err)
	}
	if keptAfter != keptBefore {
		return fmt.Errorf(
			"EnsureAccountTableWriteRevocations: refused because other rights would change (%s)",
			describeKeptRightsDifference(keptBefore, keptAfter),
		)
	}

	var violations string
	if err := tx.QueryRow(accountTableWriteRevocationViolationsSQL, roleArguments...).Scan(&violations); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations verify: %w", err)
	}
	if violations != "" {
		return fmt.Errorf(
			"EnsureAccountTableWriteRevocations: rights remain after the revocations (%s); the connecting role must be a superuser, or own these objects and be a member of their grantors",
			violations,
		)
	}

	var review accountTableOwnerRightsCounts
	if err := tx.QueryRow(accountTableOwnerRightsReviewSQL, roleArguments...).Scan(
		&review.definerFunctions, &review.ownerTriggers, &review.rules, &review.eventTriggers,
	); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations count owner-rights paths: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("EnsureAccountTableWriteRevocations commit: %w", err)
	}
	logAccountTableWriteRevocations(revocations, review)
	return nil
}

// accountTableConfiguredWriterProblems names every configured writer that would write an account table or a view
// over one on an ordinary user's connection: an automation's destination, a file-upload cache target, and either
// end of a card picture gallery as the runtime resolver finds it, for every dataset with a card picture field and
// for every account relation.
func accountTableConfiguredWriterProblems(tx *sql.Tx, roleArguments []interface{}) ([]string, error) {
	accountNames, err := queryAccountTableStrings(tx, accountTableNamesSQL, roleArguments...)
	if err != nil {
		return nil, fmt.Errorf("list account tables: %w", err)
	}
	isAccount := make(map[string]bool, len(accountNames))
	for _, name := range accountNames {
		isAccount[name] = true
	}

	var hasAutomations, hasRegistry bool
	if err := tx.QueryRow(accountTableRegistrySQL).Scan(&hasAutomations, &hasRegistry); err != nil {
		return nil, fmt.Errorf("inspect registry tables: %w", err)
	}

	var problems []string
	if hasAutomations {
		pairs, err := queryAccountTablePairs(tx, accountTableAutomationTargetsSQL)
		if err != nil {
			return nil, fmt.Errorf("list automations: %w", err)
		}
		for _, pair := range pairs {
			if isAccount[pair[1]] {
				problems = append(problems, fmt.Sprintf("automation %s writes %s", pair[0], pair[1]))
			}
		}
	}
	if !hasRegistry {
		return problems, nil
	}

	pairs, err := queryAccountTablePairs(tx, accountTableCacheTargetsSQL)
	if err != nil {
		return nil, fmt.Errorf("list file-upload cache targets: %w", err)
	}
	for _, pair := range pairs {
		if isAccount[pair[1]] {
			problems = append(problems, fmt.Sprintf("file-upload relation %s caches into %s", pair[0], pair[1]))
		}
	}

	parents, err := queryAccountTableStrings(tx, accountTableGalleryParentsSQL)
	if err != nil {
		return nil, fmt.Errorf("list card picture parents: %w", err)
	}
	// The account relations are candidate parents too, card picture field or not: every new gallery row locks its
	// parent row FOR NO KEY UPDATE (dtt_asset_linking.AppendGalleryRows), which needs UPDATE on the parent. This also
	// covers an automation whose destination is a gallery (dtt_card_picture.GalleryOf finds the same parent).
	resolved := make(map[string]bool, len(parents)+len(accountNames))
	for _, parent := range append(parents, accountNames...) {
		if resolved[parent] {
			continue
		}
		resolved[parent] = true
		child, err := accountTableGalleryChild(tx, parent)
		if err != nil {
			return nil, fmt.Errorf("resolve the gallery of %s: %w", parent, err)
		}
		if child == "" {
			continue
		}
		if isAccount[parent] || isAccount[child] {
			problems = append(problems, fmt.Sprintf("the gallery of %s (%s) writes an account table or a view over one", parent, child))
		}
	}
	return problems, nil
}

func joinAccountTableProblems(roleProblems string, writerProblems []string) string {
	parts := make([]string, 0, len(writerProblems)+1)
	if strings.TrimSpace(roleProblems) != "" {
		parts = append(parts, roleProblems)
	}
	if len(writerProblems) > 0 {
		parts = append(parts, "configured writers name an account table: "+strings.Join(writerProblems, ", "))
	}
	return strings.Join(parts, "; ")
}

func queryAccountTableStrings(tx *sql.Tx, query string, args ...interface{}) ([]string, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var values []string
	for rows.Next() {
		var value sql.NullString
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, value.String)
	}
	return values, rows.Err()
}

func queryAccountTablePairs(tx *sql.Tx, query string) ([][2]string, error) {
	rows, err := tx.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pairs [][2]string
	for rows.Next() {
		var first, second sql.NullString
		if err := rows.Scan(&first, &second); err != nil {
			return nil, err
		}
		pairs = append(pairs, [2]string{first.String, second.String})
	}
	return pairs, rows.Err()
}

func listAccountTableWriteRevocations(tx *sql.Tx, roleArguments []interface{}) ([]runtimeWriteRevocation, error) {
	rows, err := tx.Query(accountTableWriteRevocationStatementsSQL, roleArguments...)
	if err != nil {
		return nil, fmt.Errorf("EnsureAccountTableWriteRevocations list grants: %w", err)
	}
	defer rows.Close()
	var revocations []runtimeWriteRevocation
	for rows.Next() {
		var revocation runtimeWriteRevocation
		if err := rows.Scan(&revocation.category, &revocation.actingRole, &revocation.statement); err != nil {
			return nil, fmt.Errorf("EnsureAccountTableWriteRevocations read grant: %w", err)
		}
		revocations = append(revocations, revocation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("EnsureAccountTableWriteRevocations list grants: %w", err)
	}
	return revocations, nil
}

// AccountTableWriteTarget reports whether relationName names one of the five account tables or a view over one,
// so editors of configured writers can refuse such a destination before it is stored.
func AccountTableWriteTarget(q rowQueryer, relationName string) (bool, error) {
	var target bool
	if err := q.QueryRow(accountTableWriteTargetSQL, "", "", "", "", relationName).Scan(&target); err != nil {
		return false, fmt.Errorf("AccountTableWriteTarget: %w", err)
	}
	return target, nil
}

func logAccountTableWriteRevocations(revocations []runtimeWriteRevocation, review accountTableOwnerRightsCounts) {
	if len(revocations) > 0 {
		counts := map[string]int{}
		for _, revocation := range revocations {
			counts[revocation.category]++
		}
		log.Printf(
			"[ACCOUNT TABLE WRITE REVOCATIONS] removed runtime-role write grants on account tables or views over them: %d, on account sequences: %d; confidential-role write grants in public: %d on relations, %d on sequences, %d in default privileges",
			counts["account_relation"],
			counts["account_sequence"],
			counts["confidential_relation"],
			counts["confidential_sequence"],
			counts["confidential_default"],
		)
	}
	if review.total() > 0 {
		log.Printf(
			"[ACCOUNT TABLE WRITE REVOCATIONS] warning: owner-rights SQL paths these revocations cannot stop, to review: %d SECURITY DEFINER function(s) a runtime role may call, %d owner-run trigger(s) and %d rule(s) on relations a runtime role may write, %d event trigger(s)",
			review.definerFunctions,
			review.ownerTriggers,
			review.rules,
			review.eventTriggers,
		)
	}
}
