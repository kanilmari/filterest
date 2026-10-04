// account_reference_unlocked_postgres_test.go
// Proves on a disposable PostgreSQL that a reference to an account table is checked without a row lock (WL124 2a, P4a).
// Bridges RowsVisibleForRead with a role that, like the signed-in users' role after stage 2a, may read system_users
// but not update it, and with the foreign-key check of the insert that follows.
// Exists because FOR KEY SHARE needs UPDATE: with it, adding a row that refers to a user failed with 42501.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"
)

func foreignKeyViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23503"
}

func visibleAsReader(t *testing.T, reader *sql.DB, tableName string, userID int, rowIDs ...int64) (bool, error) {
	t.Helper()
	tx, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	return RowsVisibleForRead(tx, tableName, "basic", userID, rowIDs)
}

func TestAccountTableReferenceIsCheckedWithoutRowLockPostgres(t *testing.T) {
	_, reader := ownerResolverPostgres(t)

	// The premise: a key-share lock needs UPDATE, which the reader, like the signed-in users' role after stage 2a,
	// does not hold on system_users.
	if _, err := reader.Exec(`SELECT id FROM system_users WHERE id = 12 FOR KEY SHARE`); err == nil || !strings.Contains(err.Error(), "permission denied for table system_users") {
		t.Fatalf("FOR KEY SHARE as the reader: error = %v, want permission denied", err)
	}

	// Regression: the reference check no longer takes that lock on an account table.
	visible, err := visibleAsReader(t, reader, "system_users", 4, 12)
	if err != nil || !visible {
		t.Fatalf("alice referencing bob: visible = %v, err = %v; want true without 42501", visible, err)
	}

	// Visibility is unchanged: a disabled user is hidden from everyone else, a missing one does not exist, and one
	// hidden row in the set refuses the whole set; a user still sees their own row.
	for _, check := range []struct {
		name   string
		userID int
		rows   []int64
		want   bool
	}{
		{name: "a disabled user, seen by another user", userID: 4, rows: []int64{40}, want: false},
		{name: "a missing user", userID: 4, rows: []int64{99}, want: false},
		{name: "one hidden row among visible ones", userID: 4, rows: []int64{12, 40}, want: false},
		{name: "the disabled user's own row", userID: 40, rows: []int64{40}, want: true},
		{name: "two visible users", userID: 4, rows: []int64{12, 4}, want: true},
	} {
		got, err := visibleAsReader(t, reader, "system_users", check.userID, check.rows...)
		if err != nil || got != check.want {
			t.Fatalf("%s: visible = %v, err = %v; want %v", check.name, got, err, check.want)
		}
	}

	// Every other table keeps its lock: without UPDATE on owned_notes the reader is still refused there.
	if _, err := visibleAsReader(t, reader, "owned_notes", 4, 1); err == nil || !strings.Contains(err.Error(), "permission denied for table owned_notes") {
		t.Fatalf("owned_notes check as the reader: error = %v, want the key-share lock refused as before", err)
	}
}

func TestAccountTableReferenceForeignKeyHoldsTheRowPostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)
	for _, statement := range []string{
		`GRANT INSERT ON owned_notes TO ` + ownerResolverReaderRole,
		`INSERT INTO system_users (id, username, enabled) VALUES (50, 'dave', true), (51, 'erin', true)`,
	} {
		if _, err := owner.Exec(statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}

	// A user deleted between the check and the insert: the delete does not wait for the checking transaction, and
	// the insert then fails with a foreign-key violation instead of leaving a reference to a missing user.
	checking, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	visible, err := RowsVisibleForRead(checking, "system_users", "basic", 4, []int64{50})
	if err != nil || !visible {
		t.Fatalf("check of dave: visible = %v, err = %v", visible, err)
	}
	deleteContext, cancelDelete := context.WithTimeout(context.Background(), 5*time.Second)
	if _, err := owner.ExecContext(deleteContext, `DELETE FROM system_users WHERE id = 50`); err != nil {
		cancelDelete()
		t.Fatalf("administrator delete of dave while a check is open: %v (the check must hold no lock)", err)
	}
	cancelDelete()
	if _, err := checking.Exec(`INSERT INTO owned_notes (id, title, created_by) VALUES (100, 'for dave', 50)`); !foreignKeyViolation(err) {
		checking.Rollback()
		t.Fatalf("insert referencing the deleted user: error = %v, want a foreign-key violation", err)
	}
	checking.Rollback()

	// A user deleted after the insert: the insert's own foreign-key check holds the row until the insert commits,
	// and the delete then fails because the row is referenced.
	inserting, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	visible, err = RowsVisibleForRead(inserting, "system_users", "basic", 4, []int64{51})
	if err != nil || !visible {
		t.Fatalf("check of erin: visible = %v, err = %v", visible, err)
	}
	if _, err := inserting.Exec(`INSERT INTO owned_notes (id, title, created_by) VALUES (101, 'for erin', 51)`); err != nil {
		t.Fatalf("insert referencing erin: %v", err)
	}
	blockedContext, cancelBlocked := context.WithTimeout(context.Background(), 2*time.Second)
	_, blockedErr := owner.ExecContext(blockedContext, `DELETE FROM system_users WHERE id = 51`)
	cancelBlocked()
	if blockedErr == nil {
		t.Fatal("the administrator deleted erin while an uncommitted insert referenced her")
	}
	if err := inserting.Commit(); err != nil {
		t.Fatalf("commit of the insert: %v", err)
	}
	if _, err := owner.Exec(`DELETE FROM system_users WHERE id = 51`); !foreignKeyViolation(err) {
		t.Fatalf("delete of a referenced user: error = %v, want a foreign-key violation", err)
	}

	var dangling int
	if err := owner.QueryRow(`SELECT count(*) FROM owned_notes n WHERE NOT EXISTS (SELECT 1 FROM system_users u WHERE u.id = n.created_by)`).Scan(&dangling); err != nil || dangling != 0 {
		t.Fatalf("notes referring to a missing user: %d (%v), want 0", dangling, err)
	}
}
