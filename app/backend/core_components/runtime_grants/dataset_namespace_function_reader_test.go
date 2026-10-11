// dataset_namespace_function_reader_test.go
// Pins namespace trigger and nested helper reviews to the shipped migration.
// Connects trusted invoker body policy with source and disposable PostgreSQL.
// Rejects changing a helper under an unchanged reviewed trigger entry point.
package runtime_grants

import (
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestNamespaceFunctionReviewMatchesMigration(t *testing.T) {
	var functions []struct {
		Name      string `json:"name"`
		Arguments string `json:"argument_types"`
		Digest    string `json:"body_md5"`
		Returns   string `json:"returns"`
	}
	if err := json.Unmarshal(reviewedNamespaceFunctions, &functions); err != nil {
		t.Fatal(err)
	}
	if len(functions) != 9 {
		t.Fatal("namespace helper review is incomplete", len(functions))
	}
	for _, function := range functions {
		_, body, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: function.Name, ArgumentTypes: function.Arguments})
		digest := md5.Sum([]byte(body))
		if hex.EncodeToString(digest[:]) != function.Digest {
			t.Fatal("namespace helper changed without SQL side-effect review", function.Name)
		}
		if function.Returns == "trigger" && (!isNamespaceTriggerDigest(function.Digest) || !reviewedTriggerBodies[function.Digest]) {
			t.Fatal("namespace trigger is not reviewed", function.Name)
		}
	}
}

func TestNamespaceFunctionReviewRefusesChangedHelperPostgres(t *testing.T) {
	owner, _, config, _ := reviewPostgresFixture(t)
	var functions []struct {
		Name      string `json:"name"`
		Arguments string `json:"argument_types"`
	}
	if err := json.Unmarshal(reviewedNamespaceFunctions, &functions); err != nil {
		t.Fatal(err)
	}
	for _, function := range functions {
		definition, _, _ := newestDefinerMigrationFunction(t, definerFunctionIdentity{Schema: "public", Name: function.Name, ArgumentTypes: function.Arguments})
		fixtureExec(t, owner, definition)
	}
	var snapshot GrantSnapshot
	for label, name := range config.Names {
		var oid int64
		if err := owner.QueryRow(`SELECT oid FROM pg_roles WHERE rolname=$1`, name).Scan(&oid); err != nil {
			t.Fatal(err)
		}
		snapshot.Roles = append(snapshot.Roles, Role{Label: label, OID: oid})
	}
	check := func(want bool) {
		t.Helper()
		tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		got, err := readNamespaceFunctionSafety(context.Background(), tx, &snapshot)
		if err != nil || got != want {
			t.Fatalf("nested helper review: got=%v want=%v error=%v", got, want, err)
		}
	}
	check(true)
	fixtureExec(t, owner, `CREATE OR REPLACE FUNCTION public.app_lock_dataset_namespace() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;`)
	check(false)
}
