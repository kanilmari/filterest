// account_trigger_review.go
// Recognizes the two reviewed account-name protection triggers without widening runtime grants.
// Pins migration bodies, trusted ownership, helper bytes, lookup paths and exact attachments.
// Account tables remain protected; owner-executed reads and serialization need no basic-role grants.
package runtime_grants

import (
	"context"
	"database/sql"
)

const reviewedAccountHelperBody = "071d19378af50082c673808a48e86525"

const reviewedAccountTriggerSQL = `p.prorettype='trigger'::regtype
 AND l.lanname='plpgsql' AND p.provolatile='v' AND p.pronargs=0
 AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   WHERE acl.grantee<>p.proowner OR acl.privilege_type<>'EXECUTE')
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal)
 AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE t.tgfoid=p.oid AND (NOT pg_has_role(p.proowner,c.relowner,'MEMBER') OR NOT (
     p.proname='app_enforce_administrator_names_differ' AND (
       ns.nspname='public' AND c.relname='system_users' AND t.tgname='app_users_names_differ' AND t.tgtype=17
       OR ns.nspname='public' AND c.relname='system_user_group_memberships' AND t.tgname='app_memberships_names_differ' AND t.tgtype=21
       OR ns.nspname='restricted' AND c.relname='users_restricted' AND t.tgname='app_credentials_names_differ' AND t.tgtype=21)
     OR p.proname='app_describe_account_name_setting' AND ns.nspname='public' AND c.relname='system_config'
       AND t.tgname='app_account_name_setting_description' AND t.tgtype=19)))
 AND EXISTS(SELECT 1 FROM pg_proc helper JOIN pg_namespace ns ON ns.oid=helper.pronamespace
   JOIN pg_language helper_language ON helper_language.oid=helper.prolang
   WHERE ns.nspname='public' AND helper.proname='app_is_administrator_account'
   AND oidvectortypes(helper.proargtypes)='bigint' AND NOT helper.prosecdef
   AND helper_language.lanname='sql' AND helper.provolatile='s' AND helper.prorettype='boolean'::regtype AND NOT helper.proretset
   AND helper.proowner=p.proowner AND helper.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND md5(helper.prosrc)='` + reviewedAccountHelperBody + `')`

func readReviewedAccountTrigger(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot, oid int64, digest string) (bool, error) {
	identity, ok := reviewedDefinerBodies[digest]
	if !ok || !identity.AccountTrigger {
		return false, nil
	}
	var accepted bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(WITH runtime_roles AS
      (SELECT role_oid FROM jsonb_to_recordset($4::jsonb) AS r(role_oid oid))
      SELECT 1 FROM pg_trigger attached JOIN pg_proc p ON p.oid=attached.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE attached.oid=$1 AND md5(p.prosrc)=$2 AND n.nspname='public' AND p.proname=$3 AND p.prosecdef
      AND NOT EXISTS(SELECT 1 FROM runtime_roles r WHERE pg_has_role(r.role_oid,p.proowner,'MEMBER'))
      AND `+reviewedAccountTriggerSQL+`)`, oid, digest, identity.Name, string(roleJSON(snapshot.Roles))).Scan(&accepted)
	return accepted, err
}
