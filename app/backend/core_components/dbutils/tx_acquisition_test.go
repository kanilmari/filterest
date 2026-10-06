// tx_acquisition_test.go
// Proves request cancellation interrupts a saturated SQL transaction pool.
// Uses the existing stub driver and a held slot, without a database connection.
// Keeps uncancellable Begin from returning to lazy request helpers.
package dbutils

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRequireTxCancelsWorkPoolAcquisition(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	db.SetMaxOpenConns(1)
	occupied, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx = SetLazyTx(ctx, NewLazyTx(db))
	done := make(chan error, 1)
	go func() { _, err := RequireTxWithError(ctx); done <- err }()
	deadline := time.After(time.Second)
	for db.Stats().WaitCount == 0 {
		select {
		case <-deadline:
			t.Fatal("transaction did not wait for pool")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("lost cancellation cause", err)
		}
	case <-time.After(time.Second):
		t.Fatal("administrator transaction acquisition ignored request cancellation")
	}
}

func TestBoundQueryContextCancelsWorkerDatabasePhases(t *testing.T) {
	db := openDBUtilsTestDB(t, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	q := BindQueryContext(ctx, db)
	if _, err := q.Exec("worker write"); !errors.Is(err, context.Canceled) {
		t.Fatal("worker write ignored cancellation", err)
	}
	if _, err := q.Query("worker metadata"); !errors.Is(err, context.Canceled) {
		t.Fatal("worker metadata ignored cancellation", err)
	}
	var value bool
	if err := q.QueryRow("worker claim").Scan(&value); !errors.Is(err, context.Canceled) {
		t.Fatal("worker claim ignored cancellation", err)
	}
}
