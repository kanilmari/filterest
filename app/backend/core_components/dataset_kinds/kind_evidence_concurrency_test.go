// kind_evidence_concurrency_test.go
// Proves blocked queries cannot delay warm readers or committed invalidation.
// Connects channel-controlled fake catalogue reads to named and UID cache paths.
// Rejects stale publication, duplicate queries and retained registration aliases.
package dataset_kinds

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type evidenceReadResult struct {
	snapshot Snapshot
	err      error
}

func readEvidenceTestKey(ctx context.Context, db *sql.DB, mode string) (Snapshot, error) {
	if mode == "name" {
		return evidenceCache.readName(ctx, db, "public", "host")
	}
	return ReadSnapshot(ctx, db, 1)
}

// Every asynchronous read finishes before the fake DB is closed, even when a
// timeout fails a counterproof. Closing release once also makes failure safe.
func evidenceQueryRelease(t *testing.T, release chan struct{}) (func(), *sync.WaitGroup) {
	t.Helper()
	var once sync.Once
	wg := &sync.WaitGroup{}
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(func() { unblock(); wg.Wait() })
	return unblock, wg
}

func startEvidenceRead(wg *sync.WaitGroup, read func() (Snapshot, error)) <-chan evidenceReadResult {
	done := make(chan evidenceReadResult, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		s, err := read()
		done <- evidenceReadResult{s, err}
	}()
	return done
}

func awaitEvidenceRead(t *testing.T, done <-chan evidenceReadResult) Snapshot {
	t.Helper()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		return result.snapshot
	case <-time.After(time.Second):
		t.Fatal("evidence read waited behind a blocked unrelated query")
		return Snapshot{}
	}
}

func awaitEvidenceSignal(t *testing.T, done <-chan struct{}, failure string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal(failure)
	}
}

func TestKindEvidenceBlockedQueryDoesNotBlockWarmRead(t *testing.T) {
	for _, mode := range []string{"name", "UID"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var blocked atomic.Bool
			db, calls := countedEvidenceDB(t, func() Snapshot {
				if blocked.Load() {
					close(entered)
					<-release
				}
				return fixtureSnapshot()
			})
			_, wg := evidenceQueryRelease(t, release)
			if _, err := ReadSnapshot(context.Background(), db, 3); err != nil {
				t.Fatal(err)
			}
			blocked.Store(true)
			startEvidenceRead(wg, func() (Snapshot, error) { return readEvidenceTestKey(context.Background(), db, mode) })
			awaitEvidenceSignal(t, entered, "cold query did not enter fake querier")
			warm := startEvidenceRead(wg, func() (Snapshot, error) { return ReadSnapshot(context.Background(), db, 3) })
			s := awaitEvidenceRead(t, warm)
			if !Resolve(s, 3).Map || calls.Load() != 2 {
				t.Fatal("warm key lost evidence or queried again", calls.Load())
			}
		})
	}
}

func TestKindEvidenceInvalidationRejectsBlockedGeneration(t *testing.T) {
	for _, mode := range []string{"name", "UID"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var first atomic.Bool
			db, calls := countedEvidenceDB(t, func() Snapshot {
				s := fixtureSnapshot()
				if first.CompareAndSwap(false, true) {
					close(entered)
					<-release
				} else {
					s.Shapes[1].ForeignKeys = nil
				}
				return s
			})
			unblock, wg := evidenceQueryRelease(t, release)
			cold := startEvidenceRead(wg, func() (Snapshot, error) { return readEvidenceTestKey(context.Background(), db, mode) })
			awaitEvidenceSignal(t, entered, "cold query did not enter fake querier")
			invalidated := make(chan struct{})
			wg.Add(1)
			go func() { defer wg.Done(); InvalidateAll(); close(invalidated) }()
			awaitEvidenceSignal(t, invalidated, "InvalidateAll waited for a blocked evidence query")
			fresh := startEvidenceRead(wg, func() (Snapshot, error) { return readEvidenceTestKey(context.Background(), db, mode) })
			s := awaitEvidenceRead(t, fresh)
			if Resolve(s, 1).ChildEmbeddings || calls.Load() != 2 {
				t.Fatal("post-invalidation reader joined old generation", calls.Load())
			}
			unblock()
			old := awaitEvidenceRead(t, cold)
			if !Resolve(old, 1).ChildEmbeddings {
				t.Fatal("old query did not retain its starting snapshot")
			}
			s, err := readEvidenceTestKey(context.Background(), db, mode)
			if err != nil || Resolve(s, 1).ChildEmbeddings || calls.Load() != 2 {
				t.Fatal("old-generation result replaced current evidence", err, calls.Load())
			}
		})
	}
}

// Observe actual waiters through their context's Done method, so the query stays
// blocked until every follower has reached the shared-flight wait (no sleeps).
type evidenceWaitingContext struct {
	context.Context
	waiting chan struct{}
	once    sync.Once
}

func (c *evidenceWaitingContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.waiting) })
	return c.Context.Done()
}

func TestKindEvidenceBlockedSameKeySharesQuery(t *testing.T) {
	for _, mode := range []string{"name", "UID"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var first atomic.Bool
			db, calls := countedEvidenceDB(t, func() Snapshot {
				if first.CompareAndSwap(false, true) {
					close(entered)
				}
				<-release
				return fixtureSnapshot()
			})
			unblock, wg := evidenceQueryRelease(t, release)
			lead := startEvidenceRead(wg, func() (Snapshot, error) { return readEvidenceTestKey(context.Background(), db, mode) })
			awaitEvidenceSignal(t, entered, "cold query did not enter fake querier")
			const readers = 16
			results := []<-chan evidenceReadResult{lead}
			for i := 1; i < readers; i++ {
				base, cancel := context.WithCancel(context.Background())
				t.Cleanup(cancel)
				ctx := &evidenceWaitingContext{Context: base, waiting: make(chan struct{})}
				result := startEvidenceRead(wg, func() (Snapshot, error) { return readEvidenceTestKey(ctx, db, mode) })
				awaitEvidenceSignal(t, ctx.waiting, "same-key follower did not reach a cancellable shared-query wait")
				if i == 1 {
					cancel()
					select {
					case read := <-result:
						if !errors.Is(read.err, context.Canceled) {
							t.Fatal("cancelled follower lost cancellation", read.err)
						}
					case <-time.After(time.Second):
						t.Fatal("cancelled follower waited for blocked query")
					}
				} else {
					results = append(results, result)
				}
			}
			if calls.Load() != 1 {
				t.Fatal("blocked same-key readers started duplicate queries", calls.Load())
			}
			unblock()
			for _, result := range results {
				s := awaitEvidenceRead(t, result)
				if !Resolve(s, 1).ChildEmbeddings {
					t.Fatal("shared read lost evidence")
				}
				if entry := s.cachedEvidence[1]; entry == nil || entry.fingerprint == ([32]byte{}) {
					t.Fatal("shared named/UID read lost stored fingerprint for discovered UID")
				}
			}
			if calls.Load() != 1 {
				t.Fatal("same-key cold readers ran duplicate queries", calls.Load())
			}
		})
	}
}

func TestKindEvidenceRefreshedNamesStayBounded(t *testing.T) {
	var cache snapshotCache
	key := evidenceKey{uid: 1}
	for i := 0; i < 257; i++ {
		cache.put(key, Snapshot{Registrations: []Registration{{UID: 1, Name: fmt.Sprintf("public.name_%d", i), Kind: Ordinary}}})
	}
	if len(cache.names) > maximumCachedDatasets {
		t.Fatal("257 refreshed names retained unbounded aliases", len(cache.names))
	}
	if len(cache.names) != 1 {
		t.Fatal("retired aliases still point to replaced evidence", len(cache.names))
	}
	cache.values[key].cachedAt = time.Now().Add(-SchemaMetadataTTL)
	if cache.get(key) != nil || len(cache.names) != 0 {
		t.Fatal("expiry retained registration aliases", len(cache.names))
	}
}

func TestKindEvidenceRetiredNameResolvesNewUID(t *testing.T) {
	var phase atomic.Int64
	db, calls := countedEvidenceDB(t, func() Snapshot {
		uid, name := int64(1), "public.retired"
		if phase.Load() == 1 {
			name = "public.renamed"
		}
		if phase.Load() == 2 {
			uid = 2
		}
		return Snapshot{Registrations: []Registration{{UID: uid, Name: name, Kind: Ordinary}}}
	})
	if _, err := ReadSnapshot(context.Background(), db, 1); err != nil {
		t.Fatal(err)
	}
	phase.Store(1)
	evidenceCache.mu.Lock()
	evidenceCache.values[evidenceKey{source: db, uid: 1}].cachedAt = time.Now().Add(-SchemaMetadataTTL)
	evidenceCache.mu.Unlock()
	if _, err := ReadSnapshot(context.Background(), db, 1); err != nil {
		t.Fatal(err)
	}
	phase.Store(2)
	c, err := ReadForName(context.Background(), db, "retired")
	if err != nil || c.TableUID != 2 || calls.Load() != 3 {
		t.Fatal("retired name reused stale UID instead of new registration", c.TableUID, err, calls.Load())
	}
}
