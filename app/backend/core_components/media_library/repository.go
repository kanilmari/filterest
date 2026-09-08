// repository.go
// Attaches and detaches registered images through existing asset child rows.
// Between request transactions, immutable file identities, and parent image caches.
// Exists to keep a repeated link idempotent and detachment independent of physical deletion.
package media_library

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/event_bus"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"strconv"
	"strings"
)

func registerSource(ctx context.Context, tx *sql.Tx, root string, rel relation, src source, actor dbutils.RequestActorContext) (asset, error) {
	if a, ok := parseReference(src.Reference); ok {
		err := tx.QueryRow(`SELECT relation_id,source_row_id,filename FROM public.system_media_assets WHERE id=$1 AND parent_table_uid=$2 AND child_table_uid=$3 AND foreign_key_column=$4 AND filename_column=$5`, a.ID, rel.ParentUID, rel.ChildUID, rel.ForeignKey, rel.Filename).Scan(&a.RelationID, &a.SourceID, &a.Filename)
		if err != nil || a.RelationID != rel.ID {
			return asset{}, ErrDenied
		}
		return a, nil
	}
	copied, err := copyAsset(root, rel, src, uuid.NewString())
	if err != nil {
		return asset{}, err
	}
	if !dbutils.RegisterAfterRollbackHook(ctx, copied.Cleanup) {
		copied.Cleanup()
		return asset{}, errors.New("media reuse requires rollback-capable request transaction")
	}
	caption := map[string]interface{}{}
	for _, k := range []string{"title", "description"} {
		if v, ok := src.Metadata[k]; ok {
			caption[k] = v
		}
	}
	raw, _ := json.Marshal(caption)
	a := copied.Asset
	err = tx.QueryRow(`INSERT INTO public.system_media_assets
 (id,relation_id,source_row_id,source_reference,filename,original_sha256,default_caption,created_by,parent_table_uid,child_table_uid,foreign_key_column,filename_column)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
 ON CONFLICT(relation_id,source_row_id,source_reference,original_sha256) DO NOTHING RETURNING id`,
		a.ID, rel.ID, src.ID, src.Reference, a.Filename, copied.Hash, string(raw), actor.UserID, rel.ParentUID, rel.ChildUID, rel.ForeignKey, rel.Filename).Scan(&a.ID)
	if errors.Is(err, sql.ErrNoRows) {
		copied.Cleanup()
		err = tx.QueryRow(`SELECT id,filename FROM public.system_media_assets
   WHERE relation_id=$1 AND source_row_id=$2 AND source_reference=$3 AND original_sha256=$4 AND parent_table_uid=$5 AND child_table_uid=$6 AND foreign_key_column=$7 AND filename_column=$8`,
			rel.ID, src.ID, src.Reference, copied.Hash, rel.ParentUID, rel.ChildUID, rel.ForeignKey, rel.Filename).Scan(&a.ID, &a.Filename)
	}
	return a, err
}

// Attach runs inside the ordinary request transaction, including newly created
// parent rows. Any rejection causes the caller's entire row creation to roll back.
func Attach(ctx context.Context, tx *sql.Tx, root string, actor dbutils.RequestActorContext, req Request) (Result, error) {
	rel, err := resolveRelation(tx, req.Dataset, req.RelationID)
	if err != nil {
		return Result{}, err
	}
	if err = readable(tx, actor, rel); err != nil {
		return Result{}, err
	}
	if err = editableParent(tx, actor, rel, req.ParentRowID); err != nil {
		return Result{}, err
	}
	if err = routeAllowed(tx, actor, rel.Child, rel.ChildUID, "/api/add-row-multipart"); err != nil {
		return Result{}, err
	}
	src, err := readSource(tx, rel, req.SourceRowID)
	if err != nil {
		return Result{}, err
	}
	// Serialize this exact target/relation without locking unrelated rows or
	// requiring UPDATE privileges merely to read the selected source image.
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, fmt.Sprintf("media:%d:%d", rel.ID, req.ParentRowID)); err != nil {
		return Result{}, err
	}
	a, err := registerSource(ctx, tx, root, rel, src, actor)
	if err != nil {
		return Result{}, err
	}
	result := Result{AssetID: a.ID, URL: storageURL(a)}
	err = tx.QueryRow(`SELECT u.child_row_id FROM public.system_media_asset_usages u
 JOIN public.`+pq.QuoteIdentifier(rel.Child)+` c ON c.id=u.child_row_id
 WHERE u.asset_id=$1 AND u.relation_id=$2 AND u.parent_row_id=$3
 AND c.`+pq.QuoteIdentifier(rel.ForeignKey)+`=$3 AND c.`+pq.QuoteIdentifier(rel.Filename)+`=$4`,
		a.ID, rel.ID, req.ParentRowID, result.URL).Scan(&result.UsageRowID)
	if err == nil {
		result.Unchanged = true
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Result{}, err
	}
	// Stale bookkeeping never authorizes a read. A removed/replaced child may be
	// attached again; the prior asset remains retained for other hidden references.
	if _, err = tx.Exec(`DELETE FROM public.system_media_asset_usages WHERE asset_id=$1 AND relation_id=$2 AND parent_row_id=$3`, a.ID, rel.ID, req.ParentRowID); err != nil {
		return Result{}, err
	}
	columns := []string{pq.QuoteIdentifier(rel.ForeignKey), pq.QuoteIdentifier(rel.Filename)}
	values := []string{"$1", "$2"}
	for _, col := range rel.MetadataColumns {
		columns = append(columns, pq.QuoteIdentifier(col))
		values = append(values, pq.QuoteIdentifier(col))
	}
	query := `INSERT INTO public.` + pq.QuoteIdentifier(rel.Child) + ` (` + strings.Join(columns, ",") + `)
 SELECT ` + strings.Join(values, ",") + ` FROM public.` + pq.QuoteIdentifier(rel.Child) + ` WHERE id=$3 RETURNING id`
	if err = tx.QueryRow(query, req.ParentRowID, result.URL, src.ID).Scan(&result.UsageRowID); err != nil {
		return Result{}, err
	}
	if _, err = tx.Exec(`INSERT INTO public.system_media_asset_usages(asset_id,relation_id,parent_row_id,child_row_id) VALUES($1,$2,$3,$4)`, a.ID, rel.ID, req.ParentRowID, result.UsageRowID); err != nil {
		return Result{}, err
	}
	if err = syncParent(ctx, tx, rel, req.ParentRowID, result.UsageRowID); err != nil {
		return Result{}, err
	}
	return result, nil
}

// Detach requires target edit rights, not source metadata visibility. It removes
// only the exact registered child binding; files and other usages are retained.
func Detach(ctx context.Context, tx *sql.Tx, actor dbutils.RequestActorContext, req Request) error {
	rel, err := resolveRelation(tx, req.Dataset, req.RelationID)
	if err != nil {
		return err
	}
	if err = editableParent(tx, actor, rel, req.ParentRowID); err != nil {
		return err
	}
	a := asset{ID: req.AssetID}
	if parsed, e := uuid.Parse(a.ID); e != nil || parsed.String() != a.ID {
		return ErrDenied
	}
	var rowID int64
	err = tx.QueryRow(`SELECT u.child_row_id,a.filename FROM public.system_media_asset_usages u
 JOIN public.system_media_assets a ON a.id=u.asset_id
 WHERE u.asset_id=$1 AND u.relation_id=$2 AND u.parent_row_id=$3 FOR UPDATE OF u`, a.ID, rel.ID, req.ParentRowID).Scan(&rowID, &a.Filename)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = routeAllowed(tx, actor, rel.Child, rel.ChildUID, "/api/delete-rows"); err != nil {
		return err
	}
	allowed, err := read.RowsVisibleForDelete(tx, rel.Child, actor.UserRole, actor.UserID, []int64{rowID})
	if err != nil {
		return err
	}
	if !allowed {
		return ErrDenied
	}
	// DELETE privileges remain enforced by the role-specific database connection.
	where := " WHERE id=$1 AND " + pq.QuoteIdentifier(rel.ForeignKey) + "=$2 AND " + pq.QuoteIdentifier(rel.Filename) + "=$3"
	where, args, err := read.AppendMutationRowPolicyToWhereClause(tx, rel.Child, actor.UserRole, actor.UserID, where, []interface{}{rowID, req.ParentRowID, storageURL(a)})
	if err != nil {
		return err
	}
	res, err := tx.Exec("DELETE FROM public."+pq.QuoteIdentifier(rel.Child)+where, args...)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrConflict
	}
	if _, err = tx.Exec(`DELETE FROM public.system_media_asset_usages WHERE asset_id=$1 AND relation_id=$2 AND parent_row_id=$3`, a.ID, rel.ID, req.ParentRowID); err != nil {
		return err
	}
	return syncParent(ctx, tx, rel, req.ParentRowID, rowID)
}
func syncParent(ctx context.Context, tx *sql.Tx, rel relation, parentID, childID int64) error {
	err := links.ResyncSharedAssetParentCache(tx, links.SharedAssetCacheSyncPlan{ParentTable: rel.Parent, ChildTable: rel.Child, ForeignKeyColumn: rel.ForeignKey, ParentRowIDs: []int64{parentID}})
	if err != nil {
		return err
	}
	dbutils.RegisterAfterCommitHook(ctx, func() {
		event_bus.Bus.Publish(rel.Parent, event_bus.Event{Table: rel.Parent, RowID: parentID, Action: "update", ChangedFields: []string{"cached_image"}})
		event_bus.Bus.Publish(rel.Child, event_bus.Event{Table: rel.Child, RowID: childID, Action: "update"})
	})
	return nil
}

// AuthorizeStorageRead is shared by original and every thumbnail. It does not
// trust cached URLs: one exact live child/parent reference and current policy
// must still authorize this request's role and user.
func AuthorizeStorageRead(q dbutils.Querier, actor dbutils.RequestActorContext, id, filename string) bool {
	if q == nil {
		return false
	}
	var relID int64
	var dataset, stored string
	err := q.QueryRow(`SELECT a.relation_id,p.table_name,a.filename FROM public.system_media_assets a
 JOIN public.system_foreign_key_relations_1_m f ON f.id=a.relation_id
 JOIN public.system_db_tables p ON p.table_uid=f.target_table_uid WHERE a.id=$1
 AND a.parent_table_uid=f.target_table_uid AND a.child_table_uid=f.source_table_uid
 AND a.foreign_key_column=f.source_column_name
 AND a.filename_column=f.target_insert_specs->'file_upload'->>'filename_column'`, id).Scan(&relID, &dataset, &stored)
	if err != nil || stored != filename {
		return false
	}
	rel, err := resolveRelation(q, dataset, relID)
	if err != nil || readable(q, actor, rel) != nil {
		return false
	}
	var exists bool
	err = q.QueryRow(`SELECT EXISTS(SELECT 1 FROM public.system_media_asset_usages u
 JOIN public.`+pq.QuoteIdentifier(rel.Child)+` c ON c.id=u.child_row_id
 JOIN public.`+pq.QuoteIdentifier(rel.Parent)+` p ON p.id=c.`+pq.QuoteIdentifier(rel.ForeignKey)+`
 WHERE u.asset_id=$1 AND u.relation_id=$2 AND u.parent_row_id=p.id
 AND c.`+pq.QuoteIdentifier(rel.Filename)+`=$3)`, id, relID, storageURL(asset{ID: id, Filename: filename})).Scan(&exists)
	return err == nil && exists
}
func candidateURL(rel relation, src source) string {
	if _, ok := parseReference(src.Reference); ok {
		return src.Reference
	}
	base, file, err := legacyLocation(rel, src)
	if err != nil {
		return ""
	}
	return "/storage/" + base + "/original/" + file
}
func sourceName(src source) string {
	if name, ok := src.Metadata["original_name"].(string); ok && name != "" {
		return name
	}
	return "Image " + strconv.FormatInt(src.ID, 10)
}

// The row serializers depend only on this callback contract, keeping the media
// package out of their dependency graph while sharing one exact read decision.
func init() {
	read.RegisterIndependentMediaAuthorizer(func(q dbutils.Querier, actor dbutils.RequestActorContext, reference string) bool {
		a, ok := parseReference(reference)
		return ok && AuthorizeStorageRead(q, actor, a.ID, a.Filename)
	})
}
