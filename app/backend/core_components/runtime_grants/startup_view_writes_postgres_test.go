// startup_view_writes_postgres_test.go
// Ports the removed before/after real-role write proof to the new startup entry.
// Nested owner-rights account views must lose writes while existing reads survive.
// Both boots use the exclusive barrier and the single catalogue reconciler.
package runtime_grants

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/lib/pq"
)

func TestStartupRevokesActualNestedAccountViewWritesPostgres(t *testing.T) {
	owner, config, connect := startupGrantFixture(t)
	basic := connect(config.Names["basic"])
	fixtureExec(t, owner, "GRANT SELECT,INSERT,UPDATE,DELETE ON account_view,nested_account_view TO "+pq.QuoteIdentifier(config.Names["basic"]))
	fixtureExec(t, owner, "GRANT USAGE ON system_users_id_seq TO "+pq.QuoteIdentifier(config.Names["basic"]))
	proof := func(db *sql.DB, wantDenied bool) {
		t.Helper()
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		_, err = tx.Exec(`INSERT INTO nested_account_view(enabled) VALUES(true)`)
		if !wantDenied {
			if err != nil {
				t.Fatal("before-start write did not reach nested view", err)
			}
			return
		}
		var pg *pq.Error
		if !errors.As(err, &pg) || pg.Code != "42501" {
			t.Fatal("nested account view write survived startup", err)
		}
	}
	proof(basic, false)
	startupRun(t, owner, config)
	proof(basic, true)
	hasFixturePrivilege(t, owner, config.Names["basic"], "account_view", "INSERT", false)
	hasFixturePrivilege(t, owner, config.Names["basic"], "nested_account_view", "INSERT", false)
	hasFixturePrivilege(t, owner, config.Names["basic"], "nested_account_view", "SELECT", true)
	startupRun(t, owner, config)
	proof(basic, true)
}

func TestConcurrentStartupsSerializeBeforeReconciliationPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- WithStartupBarrier(context.Background(), owner, func() error {
			close(firstEntered)
			<-releaseFirst
			_, err := EnsureRuntimeRoleGrants(context.Background(), owner, config)
			return err
		})
	}()
	<-firstEntered
	secondEntered := make(chan struct{})
	secondDone := make(chan error, 1)
	go func() {
		secondDone <- WithStartupBarrier(context.Background(), owner, func() error {
			close(secondEntered)
			_, err := EnsureRuntimeRoleGrants(context.Background(), owner, config)
			return err
		})
	}()
	select {
	case <-secondEntered:
		close(releaseFirst)
		t.Fatal("second startup entered before the first drained")
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseFirst)
	for _, done := range []<-chan error{firstDone, secondDone} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("simultaneous startup did not finish")
		}
	}
}
