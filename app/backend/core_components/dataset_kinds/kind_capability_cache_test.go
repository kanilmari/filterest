// kind_capability_cache_test.go
// Exercises dataset-local fingerprints, bounded cache lifetime and concurrent use.
// Connects live dependency drift to memoization without PostgreSQL or row data.
// Ensures unrelated catalogues do not evict warm results and callers own their slices.
package dataset_kinds

import (
	"fmt"
	"reflect"
	"sync"
	"testing"
)

func TestKindCacheUnrelatedEvidenceDoesNotEvictWarmDatasets(t *testing.T) {
	s := fixtureSnapshot()
	for i := int64(10); i < 2010; i++ {
		name := fmt.Sprintf("public.unrelated_%d", i)
		s.Registrations = append(s.Registrations, Registration{UID: i, Name: name, Kind: Ordinary})
		s.Shapes = append(s.Shapes, Shape{Name: name, Columns: []Column{{Name: "id", Type: "int8"}}})
	}
	var cache Cache
	cache.Resolve(s, 1)
	cache.Resolve(s, 3)
	s.Registrations[len(s.Registrations)-1].MultilingualEmbeddings = true
	s.Shapes[len(s.Shapes)-1].Columns[0].Type = "text"
	cache.Resolve(s, 1)
	if len(cache.values) != 2 {
		t.Fatal("unrelated evidence evicted a warm dataset", len(cache.values))
	}
	// Reading a different dataset through its own scoped snapshot must retain
	// the already warm host, while changed child evidence refreshes that host.
	cache.Resolve(Snapshot{Registrations: s.Registrations[2:3], Shapes: s.Shapes[2:3]}, 3)
	if len(cache.values) != 2 {
		t.Fatal("per-dataset snapshot evicted another dataset")
	}
	s.Shapes[1].ForeignKeys = nil
	if cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("child drift stayed cached")
	}
}

func TestKindCacheConcurrentResolveAndInvalidate(t *testing.T) {
	s := fixtureSnapshot()
	var cache Cache
	var wg sync.WaitGroup
	start := make(chan struct{})
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			<-start
			for i := 0; i < 200; i++ {
				if worker%3 == 0 {
					cache.Invalidate()
					continue
				}
				uid := int64(1 + worker%3)
				got := cache.Resolve(s, uid)
				if !reflect.DeepEqual(got, Resolve(s, uid)) {
					t.Errorf("concurrent classification differs: %+v", got)
					return
				}
				got.Views[0] = "caller-owned"
			}
		}(worker)
	}
	close(start)
	wg.Wait()
	if !cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("invalidation lost a dependency")
	}
}

func TestKindScopedEvidenceMatchesFullContractsAndBoundsDroppedUIDs(t *testing.T) {
	s := chatSnapshot()
	for _, reg := range s.Registrations {
		if got, want := Resolve(scopeEvidence(s, reg.UID), reg.UID), Resolve(s, reg.UID); !reflect.DeepEqual(got, want) {
			t.Fatal("dependency scope lost contract evidence", reg.UID, got, want)
		}
	}
	var cache Cache
	for uid := int64(1); uid < 1000; uid++ {
		name := fmt.Sprintf("public.recreated_%d", uid)
		cache.Resolve(Snapshot{Registrations: []Registration{{UID: uid, Name: name, Kind: Ordinary}}, Shapes: []Shape{{Name: name}}}, uid)
		if len(cache.values) > maximumCachedDatasets {
			t.Fatal("drop/recreate churn retained unbounded entries", len(cache.values))
		}
	}
}
