// kind_evidence_identity_test.go
// Proves concurrent refreshes return evidence only for the requested identity.
// Connects blocking, scope-aware fake queriers to expired aliases and UID flights.
// Keeps external renames and name reuse from crossing waiter identities.
package dataset_kinds

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

type identityEvidenceQuerier struct {
	query func(context.Context, string, ...any) *sql.Row
}

func (q *identityEvidenceQuerier) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return q.query(ctx, query, args...)
}

func identityEvidenceDB(t *testing.T, uid int64, name string) *sql.DB {
	t.Helper()
	raw, err := json.Marshal(Snapshot{Registrations: []Registration{{UID: uid, Name: name, Kind: Ordinary}}, Shapes: []Shape{{Name: name}}})
	if err != nil {
		t.Fatal(err)
	}
	return evidenceDB(t, raw, false)
}

// The fake honours the actual UID/name/schema query scope rather than handing
// every caller the same fixture. Unexpected queries fail through the fake driver.
func identityEvidenceScope(args []any) string {
	if len(args) != 3 {
		return "invalid"
	}
	uids, _ := args[0].(driver.Valuer).Value()
	names, _ := args[1].(driver.Valuer).Value()
	return fmt.Sprintf("%v|%v|%v", uids, names, args[2])
}

func assertEvidenceIdentity(t *testing.T, s Snapshot, uid int64, name string) {
	t.Helper()
	reg, ok := s.registration(uid)
	entry := s.cachedEvidence[uid]
	if !ok || reg.Name != name || entry == nil {
		t.Fatalf("waiter for UID %d / %s received registrations %+v under cached keys %v", uid, name, s.Registrations, s.cachedEvidence)
	}
	root, ok := entry.snapshot.registration(uid)
	if !ok || root.Name != name {
		t.Fatalf("waiter stored another identity under UID %d: %+v", uid, entry.snapshot.Registrations)
	}
}

func TestKindEvidenceExpiredNameRefreshKeepsUIDWaiterIdentity(t *testing.T) {
	InvalidateAll()
	t.Cleanup(InvalidateAll)
	old := identityEvidenceDB(t, 1, "public.retired")
	renamed := identityEvidenceDB(t, 1, "public.renamed")
	reused := identityEvidenceDB(t, 2, "public.retired")
	unexpected := evidenceDB(t, nil, true)
	entered, release := make(chan struct{}), make(chan struct{})
	unblock, wg := evidenceQueryRelease(t, release)
	var refreshed atomic.Bool
	var uidQueries, nameQueries atomic.Int64
	q := &identityEvidenceQuerier{query: func(ctx context.Context, query string, args ...any) *sql.Row {
		db := unexpected
		switch identityEvidenceScope(args) {
		case "{1}|<nil>|public":
			uidQueries.Add(1)
			db = old
			if refreshed.Load() {
				db = renamed
			}
		case "<nil>|{\"retired\"}|public":
			nameQueries.Add(1)
			close(entered)
			<-release
			db = reused
		}
		return db.QueryRowContext(ctx, query, args...)
	}}
	if _, err := ReadSnapshot(context.Background(), q, 1); err != nil {
		t.Fatal(err)
	}
	// External rename/re-registration becomes visible after the TTL, without
	// application invalidation first removing the remembered alias.
	refreshed.Store(true)
	evidenceCache.mu.Lock()
	evidenceCache.values[evidenceKey{source: q, uid: 1}].cachedAt = time.Now().Add(-SchemaMetadataTTL)
	evidenceCache.mu.Unlock()
	named := startEvidenceRead(wg, func() (Snapshot, error) { return evidenceCache.readName(context.Background(), q, "public", "retired") })
	awaitEvidenceSignal(t, entered, "named refresh did not enter fake querier")
	ctx := &evidenceWaitingContext{Context: context.Background(), waiting: make(chan struct{})}
	uid := startEvidenceRead(wg, func() (Snapshot, error) { return ReadSnapshot(ctx, q, 1) })
	awaitEvidenceSignal(t, ctx.waiting, "UID waiter did not wait for blocked refresh")
	unblock()
	assertEvidenceIdentity(t, awaitEvidenceRead(t, named), 2, "public.retired")
	assertEvidenceIdentity(t, awaitEvidenceRead(t, uid), 1, "public.renamed")
	if uidQueries.Load() != 2 || nameQueries.Load() != 1 {
		t.Fatal("identity mismatch did not resolve through a fresh UID-1 query", uidQueries.Load(), nameQueries.Load())
	}
	// Both refreshed identities stay correct on warm reads, including the alias
	// which was reused by UID 2; neither warm reader repeats database work.
	s, err := ReadSnapshot(context.Background(), q, 1)
	if err != nil {
		t.Fatal(err)
	}
	assertEvidenceIdentity(t, s, 1, "public.renamed")
	s, err = evidenceCache.readName(context.Background(), q, "public", "retired")
	if err != nil {
		t.Fatal(err)
	}
	assertEvidenceIdentity(t, s, 2, "public.retired")
	if uidQueries.Load() != 2 || nameQueries.Load() != 1 {
		t.Fatal("correct warm identities queried again")
	}
}

func TestKindEvidenceNameWaiterRejectsRenamedUIDFlight(t *testing.T) {
	for _, renamedName := range []string{"public.renamed", "archive.retired"} {
		t.Run(renamedName, func(t *testing.T) {
			InvalidateAll()
			t.Cleanup(InvalidateAll)
			renamed := identityEvidenceDB(t, 1, renamedName)
			reused := identityEvidenceDB(t, 2, "public.retired")
			unexpected := evidenceDB(t, nil, true)
			entered, release := make(chan struct{}), make(chan struct{})
			unblock, wg := evidenceQueryRelease(t, release)
			var uidQueries, nameQueries atomic.Int64
			q := &identityEvidenceQuerier{query: func(ctx context.Context, query string, args ...any) *sql.Row {
				db := unexpected
				switch identityEvidenceScope(args) {
				case "{1}|<nil>|public":
					uidQueries.Add(1)
					close(entered)
					<-release
					db = renamed
				case "<nil>|{\"retired\"}|public":
					nameQueries.Add(1)
					db = reused
				}
				return db.QueryRowContext(ctx, query, args...)
			}}
			uid := startEvidenceRead(wg, func() (Snapshot, error) { return ReadSnapshot(context.Background(), q, 1) })
			awaitEvidenceSignal(t, entered, "UID refresh did not enter fake querier")
			// Seed the remembered alias without live evidence while the UID flight
			// is blocked. This directly exercises the mirror join boundary without
			// depending on the expired-name flight-key bug to arrange the state.
			evidenceCache.mu.Lock()
			evidenceCache.names = map[evidenceName]evidenceKey{{q, "public.retired"}: {source: q, uid: 1}}
			evidenceCache.mu.Unlock()
			ctx := &evidenceWaitingContext{Context: context.Background(), waiting: make(chan struct{})}
			named := startEvidenceRead(wg, func() (Snapshot, error) { return evidenceCache.readName(ctx, q, "public", "retired") })
			awaitEvidenceSignal(t, ctx.waiting, "name waiter did not wait for blocked UID flight")
			unblock()
			assertEvidenceIdentity(t, awaitEvidenceRead(t, uid), 1, renamedName)
			assertEvidenceIdentity(t, awaitEvidenceRead(t, named), 2, "public.retired")
			if uidQueries.Load() != 1 || nameQueries.Load() != 1 {
				t.Fatal("renamed UID evidence skipped the correctly scoped named query", uidQueries.Load(), nameQueries.Load())
			}
		})
	}
}
