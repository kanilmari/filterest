// article_function_review.go
// Pins article lifecycle side effects to exact helpers and protected attachments.
// Connects runtime and portable-restore audits to the same reviewed identity data.
// Allows owner-run maintenance without granting registry writes or repair-history reads.
package runtime_grants

import (
	"context"
	"database/sql"
	"encoding/json"
)

// Every nested helper has the same trusted owner and its reviewed body, language,
// volatility, arguments, result and path. Trigger functions have owner-only ACLs
// and exactly the enumerated attachments. The public callable definer only locks
// an existing registry row; it cannot edit settings or repair records.
const reviewedArticleFunctionSQL = `l.lanname='plpgsql' AND p.provolatile='v'
 AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
 AND p.proowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('public.system_db_tables'))
 AND jsonb_typeof(b.identity->'article_helpers')='array'
 AND jsonb_array_length(b.identity->'article_helpers')=20
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.identity->'article_helpers') e WHERE NOT EXISTS(
   SELECT 1 FROM pg_proc h JOIN pg_namespace ns ON ns.oid=h.pronamespace JOIN pg_language hl ON hl.oid=h.prolang
   WHERE ns.nspname='public' AND h.proname=e->>'name' AND oidvectortypes(h.proargtypes)=e->>'arguments'
    AND md5(h.prosrc)=e->>'body_md5' AND h.proowner=p.proowner AND h.prosecdef=(e->>'definer')::boolean
    AND hl.lanname=e->>'language' AND h.provolatile::text=e->>'volatility'
    AND h.prorettype::regtype::text=e->>'returns' AND h.proretset=COALESCE((e->>'set')::boolean,false)
    AND COALESCE(to_jsonb(h.proconfig),'[]')=e->'config'))
 AND ((p.proname='app_lock_article_dataset_uid' AND oidvectortypes(p.proargtypes)='integer' AND p.prorettype='boolean'::regtype AND NOT p.proretset)
  OR (p.prorettype='trigger'::regtype AND p.pronargs=0
   AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
    WHERE acl.grantee<>p.proowner OR acl.privilege_type<>'EXECUTE')
   AND (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid=p.oid)=jsonb_array_length(b.identity->'article_attachments')
   AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE t.tgfoid=p.oid AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.identity->'article_attachments') a
     WHERE ns.nspname='public' AND c.relname=a->>'table' AND c.relowner=p.proowner
      AND t.tgname=a->>'name' AND t.tgtype=(a->>'type')::integer AND NOT t.tgisinternal AND t.tgenabled='O'
      AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgdeferrable=(a->>'deferred')::boolean AND t.tginitdeferred=(a->>'deferred')::boolean
      AND COALESCE((SELECT jsonb_agg(att.attname ORDER BY att.attname) FROM unnest(t.tgattr::smallint[]) col
       JOIN pg_attribute att ON att.attrelid=t.tgrelid AND att.attnum=col),'[]')=a->'columns'))))`

func readReviewedArticleTrigger(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot, oid int64, digest string) (bool, error) {
	identity, ok := reviewedDefinerBodies[digest]
	if !ok || !identity.ArticleFunction {
		return false, nil
	}
	var accepted bool
	err := tx.QueryRowContext(ctx, `WITH reviewed_definer_bodies AS (SELECT key AS body_md5,value AS identity FROM jsonb_each($1::jsonb)),
 reviewed AS (`+reviewedDefinerFunctionsSQL+`), runtime_roles AS (SELECT role_oid FROM jsonb_to_recordset($3::jsonb) r(role_oid oid))
 SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN reviewed r ON r.oid=p.oid
 WHERE t.oid=$2 AND NOT EXISTS(SELECT 1 FROM runtime_roles runtime_role WHERE pg_has_role(runtime_role.role_oid,p.proowner,'MEMBER')))`,
		string(reviewedDefinerBodiesJSON()), oid, string(roleJSON(snapshot.Roles))).Scan(&accepted)
	return accepted, err
}

// The atomic editor adds app_save_article_presentations as an invoker wrapper.
// It calls the reviewed projection service under the caller's transaction and
// privileges; it adds no definer, trigger attachment, owner grant or policy edit.
// Its administrator route is explicitly metadata-classified in route_classifier.go.

// Only the two immutable JSON-literal defaults qualify, never an arbitrary
// immutable wrapper. Invoker execution cannot borrow the owner's privileges.
func reviewedArticleDefault(name, digest string) bool {
	if name != "app_article_opener_defaults" && name != "app_article_section_defaults" {
		return false
	}
	var policy map[string]struct {
		Helpers []struct {
			Name   string `json:"name"`
			Digest string `json:"body_md5"`
		} `json:"article_helpers"`
	}
	if json.Unmarshal(reviewedDefinersJSON, &policy) != nil {
		return false
	}
	for _, identity := range policy {
		for _, helper := range identity.Helpers {
			if helper.Name == name && helper.Digest == digest {
				return true
			}
		}
	}
	return false
}
