// dataset_namespace_function_reader.go
// Reviews namespace invoker helpers along with their trigger entry points.
// Connects migration body fingerprints to startup's SQL side-effect policy.
// Prevents changing a nested helper while retaining a reviewed trigger body.
package runtime_grants

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
)

//go:embed reviewed_namespace_functions.json
var reviewedNamespaceFunctions []byte

func isNamespaceTriggerDigest(digest string) bool {
	var functions []struct {
		Digest  string `json:"body_md5"`
		Returns string `json:"returns"`
	}
	if err := json.Unmarshal(reviewedNamespaceFunctions, &functions); err != nil {
		panic(err)
	}
	for _, function := range functions {
		if function.Returns == "trigger" && function.Digest == digest {
			return true
		}
	}
	return false
}

func readNamespaceFunctionSafety(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot) (bool, error) {
	var accepted bool
	err := tx.QueryRowContext(ctx, `WITH expected AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS f(name text, argument_types text,body_md5 text,language text,volatility text,returns text)
    ), runtime_roles AS (SELECT role_oid FROM jsonb_to_recordset($2::jsonb) AS r(role_oid oid))
    SELECT NOT EXISTS (SELECT 1 FROM expected e WHERE NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname='public' AND p.proname=e.name AND oidvectortypes(p.proargtypes)=e.argument_types
        AND md5(p.prosrc)=e.body_md5 AND NOT p.prosecdef AND l.lanname=e.language
        AND p.provolatile::text=e.volatility AND p.prorettype::regtype::text=e.returns
        AND NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')
        AND NOT EXISTS(SELECT 1 FROM runtime_roles r WHERE pg_has_role(r.role_oid,p.proowner,'MEMBER'))
    ))`, string(reviewedNamespaceFunctions), string(roleJSON(snapshot.Roles))).Scan(&accepted)
	return accepted, err
}
