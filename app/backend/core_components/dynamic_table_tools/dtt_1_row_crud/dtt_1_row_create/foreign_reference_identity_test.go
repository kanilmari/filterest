// foreign_reference_identity_test.go
// Guards add-row's stored-key lock and post-insert account-key resolution.
// Uses the unchanged queue fixture for offline fail-before/pass-after evidence.
// PostgreSQL proofs below run the real validator, INSERT and post-write check.
package dtt_1_row_create

import (
	"database/sql"
	"database/sql/driver"
	"strings"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/internal/referencetest"
	"easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestAddRowForeignReferenceLocksStoredKey(t *testing.T) {
	tx := relationKeyTx(t)
	pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
	pushQuery(queuedQuery{wantSQL: `SELECT "id" FROM "targets" WHERE "code" = $1 FOR KEY SHARE`,
		wantArgs: []driver.Value{"ONE"}, cols: []string{"id"}, rows: [][]driver.Value{{int64(1)}}})
	pushQuery(queuedQuery{cols: []string{"column_name"}})
	pushQuery(queuedQuery{wantSQL: `SELECT "targets"."id" FROM "targets" WHERE "targets"."id" = ANY($1) AND "targets"."code" = $2 ORDER BY "targets"."id" FOR KEY SHARE`,
		wantArgs: []driver.Value{"{1}", "ONE"}, cols: []string{"id"}, rows: [][]driver.Value{{int64(1)}}})
	refs, err := validateMainForeignKeyReads(tx, []dtt_models.AddRowColumnInfo{{ColumnName: "target_code", ForeignTableName: "targets", ForeignColumnName: "code"}},
		map[string]interface{}{"target_code": "ONE"}, 4, "admin", nil)
	if err != nil || len(refs) != 1 || refs[0].rowID != 1 {
		t.Fatalf("stored-key reference: %+v, %v", refs, err)
	}
}

func TestAddRowAccountReferenceRechecksStoredKey(t *testing.T) {
	tx := relationKeyTx(t)
	pushQuery(queuedQuery{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}})
	pushQuery(queuedQuery{wantSQL: `SELECT "id" FROM "system_users" WHERE "code" = $1`,
		wantArgs: []driver.Value{"ONE"}, cols: []string{"id"}, rows: [][]driver.Value{{int64(2)}}})
	pushQuery(queuedQuery{cols: []string{"column_name"}})
	pushQuery(queuedQuery{cols: []string{"id"}}) // The stored key now belongs to hidden row 2.
	err := recheckReferencesAfterInsert(tx, []checkedReference{{tableName: "system_users", rowID: 1, keyColumn: "code", keyValue: "ONE"}}, nil, 4, "basic")
	if err == nil || !strings.Contains(err.Error(), foreignRowUnreadable) {
		t.Fatalf("post-insert key reassignment: %v", err)
	}
}

func TestAddRowForeignReferenceIdentityPostgres(t *testing.T) {
	for _, account := range []bool{false, true} {
		name := "ordinary"
		if account {
			name = "account"
		}
		t.Run(name, func(t *testing.T) {
			referencetest.Run(t, account, func(tx *sql.Tx, target string) error {
				refs, err := validateMainForeignKeyReads(tx, []dtt_models.AddRowColumnInfo{{ColumnName: "target_code", ForeignTableName: target, ForeignColumnName: "code"}},
					map[string]interface{}{"target_code": "ONE"}, 4, "basic", nil)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(`INSERT INTO reference_sources(id,target_code) VALUES(42,$1)`, "ONE"); err != nil {
					return err
				}
				return recheckReferencesAfterInsert(tx, refs, nil, 4, "basic")
			})
		})
	}
}
