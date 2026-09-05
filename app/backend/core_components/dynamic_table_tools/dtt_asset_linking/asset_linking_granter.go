// asset_linking_granter.go
// Grants inherited application and PostgreSQL permissions from a parent table to its asset child table.
// Bridges existing table-level rights, role-specific database pools, and newly created asset child tables.
// Exists to keep permission inheritance centralized so uploads work in fresh and upgraded projects.
package dtt_asset_linking

import (
	"fmt"
	"log"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/security"
	"github.com/lib/pq"
)

var copyableTablePrivileges = map[string]bool{
	"SELECT": true, "INSERT": true, "UPDATE": true, "DELETE": true,
	"TRUNCATE": true, "REFERENCES": true, "TRIGGER": true,
}

// CopyTablePermissions mirrors parent table rights onto the child asset table.
func CopyTablePermissions(q dbutils.Querier, parentUID, childUID int) {
	_, err := q.Exec(
		`INSERT INTO system_group_table_func_rights (user_group_id, function_id, target_table_uid, target_schema_name)
		 SELECT user_group_id, function_id, $1, target_schema_name
		 FROM system_group_table_func_rights
		 WHERE target_table_uid = $2
		 ON CONFLICT DO NOTHING`,
		childUID, parentUID,
	)
	if err != nil {
		log.Printf("[asset_linking] warning: failed to copy permissions from parent (uid=%d) to child (uid=%d): %v",
			parentUID, childUID, err)
	}
}

// CopyPhysicalTablePermissions mirrors the parent's explicit runtime-role ACL
// onto a managed child and grants serial/identity sequence access to every
// copied INSERT-capable role. Application permission rows alone are not enough:
// policy-routed requests can execute through a non-owner PostgreSQL pool.
func CopyPhysicalTablePermissions(q dbutils.Querier, parentTable, childTable string) error {
	parentTable, err := security.SanitizeIdentifier(parentTable)
	if err != nil {
		return fmt.Errorf("validate parent table: %w", err)
	}
	childTable, err = security.SanitizeIdentifier(childTable)
	if err != nil {
		return fmt.Errorf("validate child table: %w", err)
	}

	rows, err := q.Query(`
		SELECT
			CASE WHEN acl.grantee = 0 THEN '' ELSE grantee.rolname END AS grantee_name,
			acl.privilege_type,
			acl.grantee = parent.relowner AS is_parent_owner
		FROM pg_catalog.pg_class AS parent
		JOIN pg_catalog.pg_namespace AS parent_schema
			ON parent_schema.oid = parent.relnamespace
		CROSS JOIN LATERAL aclexplode(
			COALESCE(parent.relacl, acldefault('r', parent.relowner))
		) AS acl
		LEFT JOIN pg_catalog.pg_roles AS grantee
			ON grantee.oid = acl.grantee
		WHERE parent_schema.nspname = 'public'
			AND parent.relname = $1
		ORDER BY grantee_name, acl.privilege_type
	`, parentTable)
	if err != nil {
		return fmt.Errorf("read parent table permissions: %w", err)
	}
	defer rows.Close()

	privilegesByGrantee := map[string]map[string]bool{}
	for rows.Next() {
		var granteeName string
		var privilege string
		var isParentOwner bool
		if err := rows.Scan(&granteeName, &privilege, &isParentOwner); err != nil {
			return fmt.Errorf("scan parent table permission: %w", err)
		}
		if isParentOwner {
			continue
		}
		privilege = strings.ToUpper(strings.TrimSpace(privilege))
		if !copyableTablePrivileges[privilege] {
			return fmt.Errorf("unsupported parent table privilege %q", privilege)
		}
		if privilegesByGrantee[granteeName] == nil {
			privilegesByGrantee[granteeName] = map[string]bool{}
		}
		privilegesByGrantee[granteeName][privilege] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate parent table permissions: %w", err)
	}

	childIdentifier := pq.QuoteIdentifier("public") + "." + pq.QuoteIdentifier(childTable)
	for _, granteeName := range sortedPrivilegeGrantees(privilegesByGrantee) {
		privileges := sortedPrivileges(privilegesByGrantee[granteeName])
		if len(privileges) == 0 {
			continue
		}
		if _, err := q.Exec(fmt.Sprintf(
			"GRANT %s ON TABLE %s TO %s",
			strings.Join(privileges, ", "),
			childIdentifier,
			quotedPrivilegeGrantee(granteeName),
		)); err != nil {
			return fmt.Errorf("grant child table permissions to %s: %w", displayPrivilegeGrantee(granteeName), err)
		}
	}

	sequenceRows, err := q.Query(`
		WITH child_relation AS (
			SELECT child.oid
			FROM pg_catalog.pg_class AS child
			JOIN pg_catalog.pg_namespace AS child_schema
				ON child_schema.oid = child.relnamespace
			WHERE child_schema.nspname = 'public'
				AND child.relname = $1
		), child_sequences AS (
			-- Modern serial/identity sequences are owned by the table itself.
			SELECT dependency.objid AS sequence_oid
			FROM child_relation
			JOIN pg_catalog.pg_depend AS dependency
				ON dependency.refobjid = child_relation.oid
				AND dependency.refclassid = 'pg_class'::regclass
				AND dependency.classid = 'pg_class'::regclass
				AND dependency.deptype IN ('a', 'i')
			UNION
			-- Legacy defaults can call nextval() without an OWNED BY link. In
			-- that case PostgreSQL records the dependency on pg_attrdef.
			SELECT default_dependency.refobjid AS sequence_oid
			FROM child_relation
			JOIN pg_catalog.pg_attrdef AS column_default
				ON column_default.adrelid = child_relation.oid
			JOIN pg_catalog.pg_depend AS default_dependency
				ON default_dependency.classid = 'pg_attrdef'::regclass
				AND default_dependency.objid = column_default.oid
				AND default_dependency.refclassid = 'pg_class'::regclass
		)
		SELECT DISTINCT sequence_schema.nspname, sequence.relname
		FROM child_sequences
		JOIN pg_catalog.pg_class AS sequence
			ON sequence.oid = child_sequences.sequence_oid
			AND sequence.relkind = 'S'
		JOIN pg_catalog.pg_namespace AS sequence_schema
			ON sequence_schema.oid = sequence.relnamespace
		ORDER BY sequence_schema.nspname, sequence.relname
	`, childTable)
	if err != nil {
		return fmt.Errorf("read child sequences: %w", err)
	}
	defer sequenceRows.Close()

	type sequenceIdentifier struct{ schema, name string }
	var sequences []sequenceIdentifier
	for sequenceRows.Next() {
		var sequence sequenceIdentifier
		if err := sequenceRows.Scan(&sequence.schema, &sequence.name); err != nil {
			return fmt.Errorf("scan child sequence: %w", err)
		}
		sequences = append(sequences, sequence)
	}
	if err := sequenceRows.Err(); err != nil {
		return fmt.Errorf("iterate child sequences: %w", err)
	}

	for _, granteeName := range sortedPrivilegeGrantees(privilegesByGrantee) {
		if !privilegesByGrantee[granteeName]["INSERT"] {
			continue
		}
		for _, sequence := range sequences {
			sequenceIdentifier := pq.QuoteIdentifier(sequence.schema) + "." + pq.QuoteIdentifier(sequence.name)
			if _, err := q.Exec(fmt.Sprintf(
				"GRANT USAGE, SELECT ON SEQUENCE %s TO %s",
				sequenceIdentifier,
				quotedPrivilegeGrantee(granteeName),
			)); err != nil {
				return fmt.Errorf("grant child sequence permissions to %s: %w", displayPrivilegeGrantee(granteeName), err)
			}
		}
	}
	return nil
}

func sortedPrivilegeGrantees(privilegesByGrantee map[string]map[string]bool) []string {
	grantees := make([]string, 0, len(privilegesByGrantee))
	for granteeName := range privilegesByGrantee {
		grantees = append(grantees, granteeName)
	}
	sort.Strings(grantees)
	return grantees
}

func sortedPrivileges(privileges map[string]bool) []string {
	order := []string{"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"}
	result := make([]string, 0, len(privileges))
	for _, privilege := range order {
		if privileges[privilege] {
			result = append(result, privilege)
		}
	}
	return result
}

func quotedPrivilegeGrantee(granteeName string) string {
	if granteeName == "" {
		return "PUBLIC"
	}
	return pq.QuoteIdentifier(granteeName)
}

func displayPrivilegeGrantee(granteeName string) string {
	if granteeName == "" {
		return "PUBLIC"
	}
	return granteeName
}
