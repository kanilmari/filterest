// row_event_read_checker.go
// Applies the normal results visibility predicate to one live row event.
// Bridges SSE delivery and the existing mandatory flags, owner exception and row ACL.
// A deleted or hidden row cannot disclose its identity through a change notice.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"fmt"
	"github.com/lib/pq"
)

func RowVisibleForEvent(ctx context.Context, db *sql.DB, table string, rowID int64, actor dbutils.RequestActorContext) (bool, error) {
	if actor.IsAdmin {
		return true, nil
	}
	// The pilot's RLS reads transaction-local actor settings. Match the normal
	// result path on a fresh read-only transaction for each event, never on the
	// subscription's released request transaction.
	var connection dbutils.ContextSQL = db
	if table == rlsPilotTableName {
		tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
		if err != nil {
			return false, err
		}
		defer tx.Rollback()
		if err := dbutils.ApplyRequestActorToTx(tx, actor); err != nil {
			return false, err
		}
		connection = tx
	}
	q := dbutils.BindQueryContext(ctx, connection)
	policy, err := getLegacyMustTrueReadPolicy(q, table)
	if err != nil {
		return false, err
	}
	where, args := appendReadPolicyToWhereClause(table, actor.UserRole, actor.UserID, policy,
		fmt.Sprintf(" WHERE %s.id = $1", pq.QuoteIdentifier(table)), []interface{}{rowID})
	var visible bool
	err = q.QueryRow(fmt.Sprintf("SELECT EXISTS (SELECT 1 FROM %s%s)", pq.QuoteIdentifier(table), where), args...).Scan(&visible)
	return visible, err
}
