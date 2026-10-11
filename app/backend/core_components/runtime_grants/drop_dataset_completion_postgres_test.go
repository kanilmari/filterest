// drop_dataset_completion_postgres_test.go
// Proves real table, metadata and ACL rollback after permission completion errors.
// Uses the existing opt-in disposable PostgreSQL fixture and shared drop helpers.
// A canceled completion context must not leave a separately owned tx committable.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	drop "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	"easelect/backend/core_components/dynamic_table_tools/dtt_triggers"
	"easelect/backend/core_components/runtime_grant_mutations"
	. "easelect/backend/core_components/runtime_grants"
	"github.com/lib/pq"
)

func TestDropDatasetCompletionFailureRollbackPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	FixtureExec(t, f.owner, `CREATE ROLE drop_permission_failure NOLOGIN`)
	for i, failure := range []string{"permission reader", "canceled after drop"} {
		t.Run(failure, func(t *testing.T) {
			name, target := fmt.Sprintf("drop_failure_%d", i), fmt.Sprintf("drop_target_%d", i)
			uid := f.create(name, "")
			f.create(target, "")
			f.right(name, "/api/add-row-multipart")
			f.request(dtt_triggers.CreateTriggerHandler, fmt.Sprintf(`{"source_dataset":%q,"target_dataset":%q,"condition":"true","action_values":"{\"title\":\"drop rollback\"}"}`, name, target), 201)
			FixtureExec(t, f.owner, "INSERT INTO "+pq.QuoteIdentifier(name)+"(title) VALUES('kept')")
			beforeACL := ACLFingerprint(t, f.owner)
			metadata := func() string {
				t.Helper()
				var fingerprint string
				err := f.owner.QueryRow(`SELECT json_build_array(
				 (SELECT count(*) FROM system_db_tables WHERE table_uid=$1),
				 (SELECT count(*) FROM system_group_table_func_rights WHERE target_table_uid=$1),
				 (SELECT count(*) FROM system_column_details WHERE table_uid=$1),
				 (SELECT count(*) FROM system_foreign_key_relations_1_m WHERE source_table_uid=$1 OR target_table_uid=$1),
				 (SELECT count(*) FROM system_triggers WHERE source_table=$2 OR target_table=$2))::text`, uid, name).Scan(&fingerprint)
				if err != nil {
					t.Fatal(err)
				}
				return fingerprint
			}
			beforeMetadata := metadata()
			// Request middleware binds its tx to the request too. Keeping this
			// transaction independent proves Finish also protects direct callers.
			tx, err := f.owner.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			mutation, err := runtime_grant_mutations.BeginTx(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			mutation.IncludeTables(name)
			if _, err := tx.Exec("DROP TABLE " + pq.QuoteIdentifier(name) + " CASCADE"); err != nil {
				t.Fatal(err)
			}
			if err := drop.CleanupTableMetadata(tx, uid, "public"); err != nil {
				t.Fatal(err)
			}
			if failure == "canceled after drop" {
				cancel()
			} else if _, err := tx.Exec(`SET LOCAL ROLE drop_permission_failure`); err != nil {
				t.Fatal(err)
			}
			err = mutation.Finish(ctx)
			if err == nil || failure == "canceled after drop" && !errors.Is(err, context.Canceled) {
				t.Fatal("expected permission completion failure", err)
			}
			if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failed completion left a committable transaction", err)
			}
			f.assertUID(name, uid)
			var rows int
			if err := f.owner.QueryRow("SELECT count(*) FROM " + pq.QuoteIdentifier(name)).Scan(&rows); err != nil || rows != 1 {
				t.Fatal("drop rollback lost table data", rows, err)
			}
			if metadata() != beforeMetadata || ACLFingerprint(t, f.owner) != beforeACL {
				t.Fatal("failed drop changed metadata or ACLs")
			}
			f.privilege(target, "", "INSERT", true)
			// The same authorized request can be retried after rollback.
			f.request(drop.DropTableHandler, fmt.Sprintf(`{"dataset_name":%q,"confirm_dataset_name":%q}`, name, name), 200)
			var remains bool
			if err := f.owner.QueryRow(`SELECT to_regclass($1) IS NOT NULL OR EXISTS(SELECT 1 FROM system_db_tables WHERE table_uid=$2) OR EXISTS(SELECT 1 FROM system_group_table_func_rights WHERE target_table_uid=$2) OR EXISTS(SELECT 1 FROM system_triggers WHERE source_table=$1 OR target_table=$1)`, name, uid).Scan(&remains); err != nil || remains {
				t.Fatal("successful retry left dataset or permission metadata", err)
			}
			f.privilege(target, "", "INSERT", false)
		})
	}
}
