// foreign_reference_read.go
// Shares add-row's referenced-row authorization with update-row.
// Resolves physical IDs even when a relation stores another unique key.
// Uses the canonical route check and existing locking row-read policy.
package dtt_1_row_read

import (
	"database/sql"
	"errors"
	"fmt"

	"easelect/backend/core_components/permissions"
	"github.com/lib/pq"
)

var ErrForeignRowUnreadable = errors.New("foreign row cannot be read by this actor")
var ErrForeignRowMissing = errors.New("foreign row does not exist")

// CheckReadableForeignReference resolves the stored key and checks the exact
// physical target row under the same read policy and lock used by add-row.
// Lock order stays lifecycle/policy, source mutation rows (update only), then
// referenced rows in caller order. Only the submitted target is key-locked; no
// other candidate or policy row is locked. KEY SHARE is the FK's own strength:
// it blocks deletion and changes to a referenced unique key, not ordinary edits.
func CheckReadableForeignReference(tx *sql.Tx, table, column string, value interface{}, userID int, userRole string) (int64, error) {
	return CheckReadableForeignKeyTuple(tx, table, []string{column}, []interface{}{value}, userID, userRole)
}

// CheckReadableForeignKeyTuple resolves, key-locks and authorizes exactly one
// complete referenced key. Callers must supply every component, in key order.
func CheckReadableForeignKeyTuple(tx *sql.Tx, table string, columns []string, values []interface{}, userID int, userRole string) (int64, error) {
	if len(columns) == 0 || len(columns) != len(values) {
		return 0, errors.New("complete foreign-key tuple is required")
	}
	allowed, err := permissions.CheckRouteTablePermission(tx, "/api/get-results", userID,
		permissions.RouteTableScope{TableName: table}, permissions.StrictRouteTableOptions())
	if err != nil {
		return 0, fmt.Errorf("check foreign-row read permission: %w", err)
	}
	if !allowed {
		return 0, ErrForeignRowUnreadable
	}
	var rowID int64
	query := fmt.Sprintf("SELECT %s FROM %s WHERE %s", pq.QuoteIdentifier("id"), pq.QuoteIdentifier(table), foreignKeyPredicate("", columns, 1))
	if !unlockedReferenceTables[table] {
		// Resolve and lock in ONE statement. PostgreSQL rechecks the key predicate
		// on the current tuple after a concurrent key update, before returning it.
		query += " FOR KEY SHARE"
	}
	if err := tx.QueryRow(query, values...).Scan(&rowID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrForeignRowMissing
		}
		return 0, fmt.Errorf("resolve foreign row: %w", err)
	}
	// Repeat the key predicate under that lock alongside the canonical visibility
	// policy. Never authorize an old physical ID that no longer owns this key.
	visible, err := rowsVisibleForReadKey(tx, table, userRole, userID, []int64{rowID}, columns, values)
	if err != nil {
		return 0, err
	}
	if !visible {
		return 0, ErrForeignRowUnreadable
	}
	return rowID, nil
}

// RecheckReadableForeignReference resolves the stored key again after INSERT or
// UPDATE has acquired its immediate FK lock. Account/rights rows cannot be
// explicitly locked by runtime readers; their earlier physical ID may be stale.
func RecheckReadableForeignReference(tx *sql.Tx, table, column string, value interface{}, userID int, userRole string) error {
	return RecheckReadableForeignKeyTuple(tx, table, []string{column}, []interface{}{value}, userID, userRole)
}

// RecheckReadableForeignKeyTuple preserves full-key identity for unlocked
// account/rights references once the write has acquired its immediate FK lock.
func RecheckReadableForeignKeyTuple(tx *sql.Tx, table string, columns []string, values []interface{}, userID int, userRole string) error {
	if !unlockedReferenceTables[table] {
		return nil
	}
	_, err := CheckReadableForeignKeyTuple(tx, table, columns, values, userID, userRole)
	return err
}
