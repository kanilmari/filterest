// rls_pilot_protection.go
// Declares and verifies the database protection required to omit pilot flags.
// Bridges the shared SQL compiler with the executing connection's PostgreSQL catalogue.
// Keeps failed or stale protection on the ordinary mandatory visibility predicate.
package dtt_1_row_read

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

// These are conservative pg_get_expr spellings for the supported PostgreSQL
// contract. Only whitespace is ignored: different expressions, roles, commands,
// policy modes or additional policies keep the Go predicate. No policy is
// installed here. In particular the old SELECT policy, which puts mandatory
// flags inside the direct-allow resolver, is insufficient for this optimization.
const pilotOwnerProtection = `CASE
 WHEN (current_setting('app.is_admin'::text, true) = 'true'::text) THEN true
 WHEN ((user_id > 1) AND ((user_id)::text = current_setting('app.user_id'::text, true))) THEN true
 ELSE false
END`

var pilotExpectedFlags = []string{"published", "enabled", "admin_reviewed", "admin_approved"}

var pilotReadProtection = pilotReadProtectionExpression()

// Compose the read expression from the same owner exception and flag declaration
// used to validate metadata; adding a mandatory flag cannot silently leave a
// second policy definition behind. These fixed identifiers are code-owned.
func pilotReadProtectionExpression() string {
	conditions := make([]string, 0, len(pilotExpectedFlags))
	for _, flag := range pilotExpectedFlags {
		conditions = append(conditions, fmt.Sprintf("(%s IS TRUE)", flag))
	}
	return strings.Replace(pilotOwnerProtection, "ELSE false", "ELSE ("+strings.Join(conditions, " AND ")+")", 1)
}

type pilotPolicyProtection struct {
	name, command, using, check string
}

// pilotExpectedPolicies is the single declaration used by verification and
// disposable PostgreSQL tests. SELECT enforces the flags independently of exact
// row allowances; the shared compiler still applies the exact-row decision.
var pilotExpectedPolicies = []pilotPolicyProtection{
	{"app_service_catalog_read_rls_pilot", "r", pilotReadProtection, ""},
	{"app_service_catalog_insert_rls_pilot", "a", "", pilotOwnerProtection},
	{"app_service_catalog_update_rls_pilot", "w", pilotOwnerProtection, pilotOwnerProtection},
	{"app_service_catalog_delete_rls_pilot", "d", pilotOwnerProtection, ""},
}

func pilotPolicyMatchesMetadata(policy ReadRowPolicy) bool {
	if policy.OwnerColumn != rlsPilotOwnerColumn || len(policy.FlagColumns) != len(pilotExpectedFlags) {
		return false
	}
	flags := make(map[string]bool, len(policy.FlagColumns))
	for _, flag := range policy.FlagColumns {
		flags[flag] = true
	}
	for _, flag := range pilotExpectedFlags {
		if !flags[flag] {
			return false
		}
	}
	return true
}

// guardPilotReadPolicy uses an uncorrelated scalar subquery: PostgreSQL caches
// its result as an InitPlan for this statement, never per row or across requests.
// The next statement rechecks the current catalogue/role even in the same
// transaction. The SELECT's relation lock prevents concurrent policy/table DDL
// between verification and the read; row_security_active checks effective role
// ownership (including inherited ownership) and bypass status on the actual
// connection. Missing actor settings fall back; catalogue errors refuse the read.
// Keeping this guard in SQL also makes cached schema metadata safe to reuse.
func guardPilotReadPolicy(fallback string, userID int, policy ReadRowPolicy) string {
	if !pilotPolicyMatchesMetadata(policy) {
		return fallback
	}
	return fmt.Sprintf("CASE WHEN (%s) THEN TRUE ELSE (%s) END", pilotProtectionQuery(userID), fallback)
}

func pilotProtectionQuery(userID int) string {
	if userID <= 0 {
		userID = 1
	}
	values := make([]string, 0, len(pilotExpectedPolicies))
	for _, policy := range pilotExpectedPolicies {
		values = append(values, fmt.Sprintf("(%s, %s, %s, %s)",
			pq.QuoteLiteral(policy.name), pq.QuoteLiteral(policy.command),
			pq.QuoteLiteral(strings.Join(strings.Fields(policy.using), "")),
			pq.QuoteLiteral(strings.Join(strings.Fields(policy.check), ""))))
	}
	return fmt.Sprintf(`SELECT EXISTS (
 SELECT 1 FROM pg_catalog.pg_class AS protected_table
 JOIN pg_catalog.pg_roles AS reading_role ON reading_role.rolname = current_user
 WHERE protected_table.oid = pg_catalog.to_regclass('public.app_service_catalog')
   AND protected_table.oid = pg_catalog.to_regclass('app_service_catalog')
   AND protected_table.relkind = 'r'
   AND protected_table.relrowsecurity
   AND NOT reading_role.rolsuper AND NOT reading_role.rolbypassrls
   AND (protected_table.relforcerowsecurity OR protected_table.relowner <> reading_role.oid)
   AND pg_catalog.row_security_active(protected_table.oid)
   AND current_setting('app.user_id', true) = %s
   AND current_setting('app.is_admin', true) = 'false'
   AND (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid = protected_table.oid) = %d
   AND NOT EXISTS (
    SELECT 1 FROM (VALUES %s) AS expected(name, command, using_expression, check_expression)
    WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_policy AS actual
     WHERE actual.polrelid = protected_table.oid AND actual.polname = expected.name
       AND actual.polcmd::text = expected.command AND actual.polpermissive
       AND actual.polroles = ARRAY[0::oid]
       AND regexp_replace(COALESCE(pg_catalog.pg_get_expr(actual.polqual, actual.polrelid), ''), '[[:space:]]', '', 'g') = expected.using_expression
       AND regexp_replace(COALESCE(pg_catalog.pg_get_expr(actual.polwithcheck, actual.polrelid), ''), '[[:space:]]', '', 'g') = expected.check_expression
    )
   )
)`, pq.QuoteLiteral(strconv.Itoa(userID)), len(pilotExpectedPolicies), strings.Join(values, ","))
}
