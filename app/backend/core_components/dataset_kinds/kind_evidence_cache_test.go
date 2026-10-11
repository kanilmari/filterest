// kind_evidence_cache_test.go
// Proves evidence TTL, bounded retention, shared fingerprints and cold-query safety.
// Connects scripted catalogue snapshots to the public named and batched readers.
// Keeps cache correctness observable without database access or wall-clock sleeps.
package dataset_kinds

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func countedEvidenceDB(t *testing.T, read func() Snapshot) (*sql.DB, *atomic.Int64) {
	t.Helper()
	InvalidateAll()
	t.Cleanup(InvalidateAll)
	count := &atomic.Int64{}
	name := fmt.Sprintf("kind_counted_%d", readerSequence.Add(1))
	sql.Register(name, evidenceDriver{readRaw: func() []byte {
		raw, err := json.Marshal(read())
		if err != nil {
			panic(err)
		}
		return raw
	}, checkScope: func(_ string, _ []driver.NamedValue) error { count.Add(1); return nil }})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, count
}

func TestKindEvidenceExpiryAndInvalidation(t *testing.T) {
	for _, refresh := range []string{"TTL", "invalidation"} {
		t.Run(refresh, func(t *testing.T) {
			s := fixtureSnapshot()
			db, calls := countedEvidenceDB(t, func() Snapshot { return s })
			read := func() Capabilities {
				c, err := ReadForName(context.Background(), db, "host")
				if err != nil {
					t.Fatal(err)
				}
				return c
			}
			if !read().ChildEmbeddings {
				t.Fatal("fixture has no child")
			}
			s.Shapes[1].ForeignKeys = nil
			if !read().ChildEmbeddings || calls.Load() != 1 {
				t.Fatal("external DDL must retain warm evidence until TTL/invalidation", calls.Load())
			}
			if refresh == "TTL" {
				evidenceCache.mu.Lock()
				for _, entry := range evidenceCache.values {
					entry.cachedAt = time.Now().Add(-SchemaMetadataTTL)
				}
				evidenceCache.mu.Unlock()
			} else {
				// The same entry point InvalidateSchemaCache calls after app commits.
				InvalidateAll()
			}
			if read().ChildEmbeddings || calls.Load() != 2 {
				t.Fatal("expired/invalidated evidence hid child FK drift", calls.Load())
			}
		})
	}
}

func TestKindEvidenceConcurrentColdStartSharesQuery(t *testing.T) {
	db, calls := countedEvidenceDB(t, fixtureSnapshot)
	const workers = 32
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			var c Capabilities
			var err error
			if i%2 == 0 {
				c, err = ReadForName(context.Background(), db, "public.host")
			} else {
				var s Snapshot
				s, err = ReadSnapshot(context.Background(), db, 1, 1)
				c = ResolveCached(s, 1)
			}
			if err != nil || !c.ChildEmbeddings {
				t.Errorf("cold reader: %+v %v", c, err)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("concurrent key must run one evidence query; got", calls.Load())
	}
}

func TestKindEvidenceBatchDeduplicatesAndKeepsStoredFingerprint(t *testing.T) {
	db, calls := countedEvidenceDB(t, fixtureSnapshot)
	for i := 0; i < 2; i++ {
		s, err := ReadSnapshot(context.Background(), db, 1, 3, 1, 3)
		if err != nil {
			t.Fatal(err)
		}
		for _, uid := range []int64{1, 3} {
			entry := s.cachedEvidence[uid]
			if entry == nil || entry.fingerprint == ([32]byte{}) {
				t.Fatal("missing stored fingerprint")
			}
			if got := ResolveCached(s, uid); got.TableUID != uid {
				t.Fatal(got)
			}
			if capabilityCache.values[uid].fingerprint != entry.fingerprint {
				t.Fatal("classification lost stored fingerprint")
			}
		}
		// Public evidence is request-owned; these edits must not corrupt the cache.
		s.Shapes[0].Columns[0].Name = "caller_edit"
		s.Shapes[0].ForeignKeys[0].Columns[0] = "caller_edit"
	}
	if calls.Load() != 1 {
		t.Fatal("warm related batch reread evidence", calls.Load())
	}
	s, _ := ReadSnapshot(context.Background(), db, 1)
	if !Resolve(s, 1).ChildEmbeddings {
		t.Fatal("caller changed cached evidence")
	}
}

func TestKindEvidenceBoundedDatasetKeysAndSourceIsolation(t *testing.T) {
	s := fixtureSnapshot()
	db, _ := countedEvidenceDB(t, func() Snapshot { return s })
	var cache snapshotCache
	for uid := int64(1); uid <= 1000; uid++ {
		name := fmt.Sprintf("public.churn_%d", uid)
		cache.put(evidenceKey{source: db, uid: uid}, Snapshot{Registrations: []Registration{{UID: uid, Name: name, Kind: Ordinary}}})
		if len(cache.values) > maximumCachedDatasets || len(cache.names) > maximumCachedDatasets {
			t.Fatal("unbounded evidence aliases")
		}
	}
	if c, err := ReadForName(context.Background(), db, "host"); err != nil || !c.ChildEmbeddings {
		t.Fatal(c, err)
	}
	other := evidenceDB(t, []byte(`{"registrations":[],"shapes":[]}`), false)
	if c, err := ReadForName(context.Background(), other, "host"); err != nil || c.ChildEmbeddings {
		t.Fatal("another database reused evidence", c, err)
	}
}

func TestKindEvidenceInvalidationWaitsForColdPublication(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var first atomic.Bool
	db, calls := countedEvidenceDB(t, func() Snapshot {
		if first.CompareAndSwap(false, true) {
			close(entered)
			<-release
		}
		return fixtureSnapshot()
	})
	done := make(chan error, 1)
	go func() { _, err := ReadSnapshot(context.Background(), db, 1); done <- err }()
	<-entered
	invalidated := make(chan struct{})
	go func() { InvalidateAll(); close(invalidated) }()
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	<-invalidated
	if _, err := ReadSnapshot(context.Background(), db, 1); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatal("cold publication survived commit invalidation", calls.Load())
	}
}
