// policy.go
// Resolves image relations and proves a shared reader boundary before reuse or download.
// Between current dataset, field, legacy visibility, RLS, and exact-row permission metadata.
// Exists to fail closed on unsupported row-dependent audiences, including after an ACL changes.
package media_library

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/permissions"
	"encoding/json"
	"github.com/lib/pq"
	"strconv"
	"strings"
)

func resolveRelation(q dbutils.Querier, dataset string, id int64) (relation, error) {
	var rel relation
	var specs []byte
	err := q.QueryRow(`SELECT fk.id,p.table_name,c.table_name,fk.source_column_name,
 p.table_uid,c.table_uid,fk.target_insert_specs
 FROM public.system_foreign_key_relations_1_m fk
 JOIN public.system_db_tables p ON p.table_uid=fk.target_table_uid
 JOIN public.system_db_tables c ON c.table_uid=fk.source_table_uid
 WHERE fk.id=$1 AND p.table_name=$2 AND p.schema_name='public' AND c.schema_name='public'`, id, dataset).
		Scan(&rel.ID, &rel.Parent, &rel.Child, &rel.ForeignKey, &rel.ParentUID, &rel.ChildUID, &specs)
	if err != nil {
		return rel, ErrDenied
	}
	config, err := links.ParseFileUploadConfig(specs)
	if err != nil || !links.UsesSharedAssetRelation(config) {
		return rel, ErrUnsupported
	}
	profile, ok := links.ResolveProfileUploadConfigFromStatus(links.FileUploadRelationStatus{UploadConfig: config}, links.AssetProfileImage)
	if !ok || !profile.Enabled || strings.TrimSpace(config.FilenameColumn) == "" {
		return rel, ErrUnsupported
	}
	rel.Filename = config.FilenameColumn
	// The image cache remains derived from the existing child relation. This first
	// slice supports its established filename field, not arbitrary cache setters.
	if rel.Filename != "filename" {
		return rel, ErrUnsupported
	}
	rows, err := q.Query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
 AND column_name IN ('asset_kind','original_name','mime_type','size_bytes','title','description') ORDER BY ordinal_position`, rel.Child)
	if err != nil {
		return rel, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return rel, err
		}
		rel.MetadataColumns = append(rel.MetadataColumns, name)
	}
	return rel, rows.Err()
}

// stableAudience proves that every row in both relation tables has the same
// potential reader set. It deliberately refuses even dormant row rules: a rule
// becoming active later must never turn an old private image into public media.
func stableAudience(q dbutils.Querier, rel relation) error {
	var safe bool
	err := q.QueryRow(`SELECT
 (SELECT count(*)=2 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ($1,$2) AND c.relkind='r'
    AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
 AND NOT EXISTS(SELECT 1 FROM public.system_column_details
   WHERE table_uid IN ($3,$4) AND must_be_true_unless_own IS TRUE)
 AND NOT EXISTS(SELECT 1 FROM public.system_row_access_rules r
   JOIN public.system_permission_actions a ON a.id=r.action_id
   WHERE r.table_uid IN ($3,$4) AND a.action_key='read')
 AND NOT EXISTS(SELECT 1 FROM public.system_row_group_memberships
   WHERE table_uid IN ($3,$4))`, rel.Parent, rel.Child, rel.ParentUID, rel.ChildUID).Scan(&safe)
	if err != nil {
		return err
	}
	if !safe {
		return ErrUnsupported
	}
	return nil
}
func routeAllowed(q dbutils.Querier, actor dbutils.RequestActorContext, table string, uid int64, route string) error {
	allowed, err := permissions.CheckRouteTablePermission(q, route, actor.UserID,
		permissions.RouteTableScope{TableName: table, TableUID: strconv.FormatInt(uid, 10)}, permissions.AccessControlRouteTableOptions(false))
	if err != nil {
		return err
	}
	if !allowed {
		return ErrDenied
	}
	return nil
}
func readable(q dbutils.Querier, actor dbutils.RequestActorContext, rel relation) error {
	if err := stableAudience(q, rel); err != nil {
		return err
	}
	for _, target := range []struct {
		name string
		uid  int64
	}{{rel.Parent, rel.ParentUID}, {rel.Child, rel.ChildUID}} {
		if err := routeAllowed(q, actor, target.name, target.uid, "/api/get-results"); err != nil {
			return err
		}
	}
	// SQL privileges are evaluated on the request's role, not the metadata-owner pool.
	for _, col := range append([]string{"id", rel.ForeignKey, rel.Filename}, rel.MetadataColumns...) {
		var allowed bool
		err := q.QueryRow(`SELECT has_column_privilege(current_user,quote_ident('public')||'.'||quote_ident($1),$2,'SELECT')`, rel.Child, col).Scan(&allowed)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrDenied
		}
	}
	return nil
}
func editableParent(tx *sql.Tx, actor dbutils.RequestActorContext, rel relation, rowID int64) error {
	if actor.UserID <= 1 || rowID <= 0 {
		return ErrDenied
	}
	if err := routeAllowed(tx, actor, rel.Parent, rel.ParentUID, "/api/update-row"); err != nil {
		return err
	}
	allowed, err := read.LockRowsVisibleForMutation(tx, rel.Parent, actor.UserRole, actor.UserID, []int64{rowID})
	if err != nil {
		return err
	}
	if !allowed {
		return ErrDenied
	}
	return nil
}
func readSource(q dbutils.Querier, rel relation, rowID int64) (source, error) {
	var src source
	var raw []byte
	expr := []string{pq.QuoteIdentifier(rel.Filename)}
	for _, c := range rel.MetadataColumns {
		expr = append(expr, pq.QuoteIdentifier(c))
	}
	// The explicit projection preserves column-level SELECT enforcement.
	query := `SELECT id,` + pq.QuoteIdentifier(rel.ForeignKey) + `,` + pq.QuoteIdentifier(rel.Filename) + `,to_jsonb(metadata)
 FROM (SELECT id,` + pq.QuoteIdentifier(rel.ForeignKey) + `,` + strings.Join(expr, ",") + `
 FROM public.` + pq.QuoteIdentifier(rel.Child) + ` WHERE id=$1) AS metadata`
	if err := q.QueryRow(query, rowID).Scan(&src.ID, &src.ParentID, &src.Reference, &raw); err != nil {
		return src, ErrDenied
	}
	if err := json.Unmarshal(raw, &src.Metadata); err != nil {
		return src, err
	}
	var exists bool
	if err := q.QueryRow(`SELECT EXISTS(SELECT 1 FROM public.`+pq.QuoteIdentifier(rel.Parent)+` WHERE id=$1)`, src.ParentID).Scan(&exists); err != nil {
		return src, err
	}
	if !exists || src.Metadata["asset_kind"] != "image" {
		return src, ErrUnsupported
	}
	return src, nil
}
