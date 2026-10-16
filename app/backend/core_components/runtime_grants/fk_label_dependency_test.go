// fk_label_dependency_test.go
// Proves the real dependency reader requires target Read before granting labels.
// Uses catalogue-only replies, then evaluates the unchanged grant policy.
// Includes a PostgreSQL counterpart for actual role privileges.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"strings"
	"testing"
)

func TestForeignLabelDependencyRequiresRead(t *testing.T) {
	s := policyFixture()
	db := metadataTestDB(t, func(query string, _ []driver.NamedValue) (int, [][]driver.Value, error) {
		if !strings.Contains(query, "SELECT c.oid,c.conrelid") {
			t.Fatal(query)
		}
		return 5, [][]driver.Value{{int64(1), int64(10), int64(11), "target_id", "id"}}, nil
	})
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := loadDependencies(context.Background(), tx, &s); err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, dep := range s.Dependencies {
		if dep.Kind == "label" {
			found = true
			if dep.Requires != Read {
				t.Fatal("label dependency does not require target Read")
			}
		}
	}
	if !found {
		t.Fatal("label dependency missing")
	}
	s.Rights = []Right{{3, 1, 1}}
	if containsGrant(grantsFor(t, s), "guest", 11, "title", "SELECT") {
		t.Fatal("source-only grant disclosed label")
	}
	s.Rights = append(s.Rights, Right{3, 1, 2})
	if !containsGrant(grantsFor(t, s), "guest", 11, "title", "SELECT") {
		t.Fatal("readable target lost label")
	}
}

func TestForeignLabelGrantRequiresReadPostgres(t *testing.T) {
	owner, connect, config, _ := reviewPostgresFixture(t)
	s := readFixtureSnapshot(t, owner, config)
	target := oidByName(&s, "fresh_target")
	grants := grantsFor(t, s)
	if containsGrant(grants, "guest", target, "title", "SELECT") {
		t.Fatal("label inferred target read")
	}
	applyFixtureGrants(t, owner, s, grants)
	guest := connect(config.Names["guest"])
	var label string
	if err := guest.QueryRow(`SELECT title FROM fresh_target WHERE id=1`).Scan(&label); err == nil {
		t.Fatal("source-only guest read target label")
	}
	fixtureExec(t, owner, `INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid) VALUES(3,1,2)`)
	s = readFixtureSnapshot(t, owner, config)
	applyFixtureGrants(t, owner, s, grantsFor(t, s))
	if err := guest.QueryRow(`SELECT title FROM fresh_target WHERE id=1`).Scan(&label); err != nil || label != "visible label" {
		t.Fatal(label, err)
	}
}
