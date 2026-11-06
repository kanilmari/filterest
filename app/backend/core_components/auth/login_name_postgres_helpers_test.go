// login_name_postgres_helpers_test.go
// Bounds disposable account proofs and restores temporary public-name fixtures.
// Keeps cleanup independent of a completed subtest's canceled context.
package auth

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func loginNamePostgresContext(t *testing.T) context.Context {
	t.Helper()
	// A fresh parent also permits SQL cleanup after the subtest context is canceled.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func setPostgresFixtureDisplayName(t *testing.T, db *sql.DB, id int, display string) {
	t.Helper()
	var original string
	if err := db.QueryRowContext(loginNamePostgresContext(t), `SELECT username FROM system_users WHERE id=$1`, id).Scan(&original); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(loginNamePostgresContext(t), `UPDATE system_users SET username=$1 WHERE id=$2`, original, id); err != nil {
			t.Errorf("restore public-name fixture for user %d: %v", id, err)
		}
	})
	if _, err := db.ExecContext(loginNamePostgresContext(t), `UPDATE system_users SET username=$1 WHERE id=$2`, display, id); err != nil {
		t.Fatal(err)
	}
}
