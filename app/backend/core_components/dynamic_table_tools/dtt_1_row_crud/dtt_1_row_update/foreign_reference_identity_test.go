// foreign_reference_identity_test.go
// Exercises update-row's validators around the real UPDATE in a two-connection race.
// Shares the channel barrier and isolated cluster with the add-row proof.
// Also proves account-key rechecks use the new owner rather than the old ID.
package dtt_1_row_update

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"strings"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/internal/referencetest"
	"easelect/backend/core_components/runtime_grants/granttest"
)

type referenceRecordingDriver struct {
	state   *updRowState
	queries []string
}

type referenceRecordingConn struct {
	*updRowConn
	recording *referenceRecordingDriver
}

func (d *referenceRecordingDriver) Open(string) (driver.Conn, error) {
	return &referenceRecordingConn{updRowConn: &updRowConn{state: d.state}, recording: d}, nil
}

func (d *referenceRecordingDriver) Connect(context.Context) (driver.Conn, error) { return d.Open("") }
func (d *referenceRecordingDriver) Driver() driver.Driver                        { return d }

func (c *referenceRecordingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.recording.queries = append(c.recording.queries, query)
	return c.updRowConn.QueryContext(ctx, query, args)
}

func TestUpdateAccountReferenceRechecksStoredKey(t *testing.T) {
	granttest.ConfigureRoles(t)
	d := &referenceRecordingDriver{state: &updRowState{queries: []queuedQuery{
		{cols: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}},
		{cols: []string{"id"}, rows: [][]driver.Value{{int64(2)}}},
		{cols: []string{"column_name"}},
		{cols: []string{"id"}}, // Hidden row 2 now owns the stored key.
	}}}
	db := sql.OpenDB(d)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	err = recheckUpdatedForeignReferences(tx, []updatedReference{{table: "system_users", id: 1, column: "code", value: "ONE"}}, 4, "basic")
	if err == nil || !strings.Contains(err.Error(), "foreign row cannot be read") {
		t.Fatalf("post-update key reassignment: %v", err)
	}
	if len(d.queries) < 2 || d.queries[1] != `SELECT "id" FROM "system_users" WHERE "code" = $1` {
		t.Fatalf("account recheck did not resolve the stored key: %v", d.queries)
	}
}

func TestUpdateRowForeignReferenceIdentityPostgres(t *testing.T) {
	for _, account := range []bool{false, true} {
		name := "ordinary"
		if account {
			name = "account"
		}
		t.Run(name, func(t *testing.T) {
			referencetest.Run(t, account, func(tx *sql.Tx, _ string) error {
				// Match the handler's existing source-row-before-reference lock order.
				if _, err := tx.Exec(`SELECT id FROM reference_sources WHERE id=41 FOR UPDATE`); err != nil {
					return err
				}
				refs, err := validateUpdatedForeignReferences(tx, "reference_sources", "target_code", "ONE", 4, "basic")
				if err != nil {
					return err
				}
				if _, err := tx.Exec(`UPDATE reference_sources SET target_code=$1 WHERE id=41`, "ONE"); err != nil {
					return err
				}
				return recheckUpdatedForeignReferences(tx, refs, 4, "basic")
			})
		})
	}
}
