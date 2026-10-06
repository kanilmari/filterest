// row_group_membership_editor.go
// Serializes heading assignments and replaces a class's other values atomically.
// Bridges legacy stable settings keys and shared bulk row-access validation.
// Exists so concurrent POST and DELETE cannot leave two values of one class on a row.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/lib/pq"
)

func assignRowGroupInDB(ctx context.Context, tx *sql.Tx, request rowGroupMembershipRequest) error {
	return mutateRowGroupMembership(ctx, tx, request, true)
}

func removeRowGroupInDB(ctx context.Context, tx *sql.Tx, request rowGroupMembershipRequest) error {
	return mutateRowGroupMembership(ctx, tx, request, false)
}

func resolveRowGroupMembershipTarget(ctx context.Context, tx *sql.Tx, request rowGroupMembershipRequest) (rowAccessTarget, error) {
	if request.Dataset != "" {
		return resolveRowAccessTarget(ctx, tx, request.Dataset)
	}
	target := rowAccessTarget{TableUID: request.TableUID}
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(schema_name,''),'public'),table_name
  FROM public.system_db_tables WHERE table_uid=$1`, request.TableUID).Scan(&target.SchemaName, &target.TableName)
	if errors.Is(err, sql.ErrNoRows) {
		return target, errRowGroupTarget
	}
	return target, err
}

func mutateRowGroupMembership(ctx context.Context, tx *sql.Tx, request rowGroupMembershipRequest, assign bool) error {
	// This MUST be its own statement. A statement snapshot acquired before waiting
	// would miss a competing assignment committed while the advisory lock was held.
	// A heading's identity is immutable; NULL legacy values share a separate lock.
	var locked any
	err := tx.QueryRowContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(
  'filterest:row-group-heading:' || COALESCE(classification_id::text,'legacy'),0))
  FROM public.system_row_groups WHERE id=$1`, request.GroupID).Scan(&locked)
	if errors.Is(err, sql.ErrNoRows) {
		return errRowGroupUnavailable
	}
	if err != nil {
		return err
	}
	var headingID *int64
	var single, enabled bool
	err = tx.QueryRowContext(ctx, `SELECT g.classification_id, COALESCE(c.is_single,false),
  g.enabled AND COALESCE(c.enabled,true) FROM public.system_row_groups g
  LEFT JOIN public.system_row_group_classifications c ON c.id=g.classification_id WHERE g.id=$1`, request.GroupID).Scan(&headingID, &single, &enabled)
	if err != nil {
		return err
	}
	if assign && !enabled {
		return errRowGroupUnavailable
	}
	target, err := resolveRowGroupMembershipTarget(ctx, tx, request)
	if err != nil {
		return err
	}
	rowIDs := request.RowIDs
	if len(rowIDs) == 0 && request.RowID > 0 {
		rowIDs = []int64{request.RowID}
	}
	rowIDs, err = normalizeRowAccessRowIDs(rowIDs)
	if err != nil {
		return errors.Join(errRowGroupTarget, err)
	}
	// Validate every row before replacing anything: an unknown row writes nothing.
	if err := validateRowAccessRows(ctx, tx, target, rowIDs, true); err != nil {
		return err
	}
	keys := []string{}
	stable := target.SchemaName == "public" && target.TableName == "system_config"
	if stable {
		rows, err := tx.QueryContext(ctx, `SELECT key FROM public.system_config WHERE id=ANY($1::bigint[]) ORDER BY id`, pq.Array(rowIDs))
		if err != nil {
			return err
		}
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				rows.Close()
				return err
			}
			keys = append(keys, key)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	if assign && single {
		// Include disabled peer values: hidden vocabulary must not violate cardinality.
		_, err = tx.ExecContext(ctx, `DELETE FROM public.system_row_group_memberships m USING public.system_row_groups g
   WHERE m.group_id=g.id AND g.classification_id=$1 AND g.id<>$2 AND m.table_uid=$3
    AND (m.row_id=ANY($4::bigint[]) OR m.target_stable_key=ANY($5::text[]))`, headingID, request.GroupID, target.TableUID, pq.Array(rowIDs), pq.Array(keys))
		if err != nil {
			return err
		}
	}
	if !assign {
		_, err = tx.ExecContext(ctx, `DELETE FROM public.system_row_group_memberships
   WHERE group_id=$1 AND table_uid=$2 AND (row_id=ANY($3::bigint[]) OR target_stable_key=ANY($4::text[]))`, request.GroupID, target.TableUID, pq.Array(rowIDs), pq.Array(keys))
	} else if stable {
		_, err = tx.ExecContext(ctx, `INSERT INTO public.system_row_group_memberships(group_id,table_uid,row_id,target_stable_key)
   SELECT $1,$2,id,key FROM public.system_config WHERE id=ANY($3::bigint[])
   ON CONFLICT (group_id,table_uid,target_stable_key) WHERE target_stable_key IS NOT NULL
   DO UPDATE SET row_id=EXCLUDED.row_id,updated=now()`, request.GroupID, target.TableUID, pq.Array(rowIDs))
	} else {
		_, err = tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO public.system_row_group_memberships(group_id,table_uid,row_id)
   SELECT $1,$2,id FROM %s.%s WHERE id=ANY($3::bigint[])
   ON CONFLICT (group_id,table_uid,row_id) DO NOTHING`, pq.QuoteIdentifier(target.SchemaName), pq.QuoteIdentifier(target.TableName)), request.GroupID, target.TableUID, pq.Array(rowIDs))
	}
	return err
}
