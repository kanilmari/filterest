// config_cache_test.go
// Proves the moved configuration cache preserves timestamp expiry and replacement.
// Connects existing results-page settings to the shared five-minute store.
// Protects cached integer metadata while middleware adds scoped booleans.
package system_config_cache

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConfigCacheLifetimeAndReplacement(t *testing.T) {
	const key = "results_load_amount"
	t.Cleanup(func() { Delete(key) })
	SetAt(key, 20, time.Now())
	if Get(key) != 20 {
		t.Fatal("fresh value missing")
	}
	SetAt(key, 30, time.Now())
	if Get(key) != 30 {
		t.Fatal("replacement missing")
	}
	SetAt(key, 40, time.Now().Add(-TTL))
	if Get(key) != nil {
		t.Fatal("expired value returned")
	}
	PurgeExpired(time.Now())
	store.Lock()
	_, exists := store.entries[key]
	store.Unlock()
	if exists {
		t.Fatal("expired value retained")
	}
	SetAt(key, 20, time.Now())
	Delete(key)
	if Get(key) != nil {
		t.Fatal("deleted value returned")
	}
}

func TestSlowConfigLoadDoesNotBlockOtherWarmKeys(t *testing.T) {
	const slowKey, warmKey = "e2e_slow_config", "e2e_warm_config"
	t.Cleanup(func() { Delete(slowKey); Delete(warmKey) })
	SetAt(warmKey, 20, time.Now())
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(finished)
		Load(slowKey, nil, func() any {
			close(started)
			<-release
			return false
		})
	}()
	<-started
	defer func() { close(release); <-finished }()

	read := make(chan bool, 1)
	go func() {
		read <- Get(warmKey) == 20 && Load(warmKey, nil, func() any { return -1 }) == 20
	}()
	select {
	case correct := <-read:
		if !correct {
			t.Fatal("warm integer changed during another key's refresh")
		}
	case <-time.After(time.Second):
		t.Fatal("warm config read waited for an unrelated loader")
	}
}

func TestConfigLoadsCoalesceAndExplicitChangesWin(t *testing.T) {
	for _, operation := range []string{"coalesce", "delete", "replace"} {
		t.Run(operation, func(t *testing.T) {
			key := "e2e_config_load_" + operation
			t.Cleanup(func() { Delete(key) })
			started, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			var readers sync.WaitGroup
			results := make(chan any, 20)
			for range 20 {
				readers.Go(func() {
					results <- Load(key, nil, func() any {
						if calls.Add(1) == 1 {
							close(started)
							<-release
							return 10
						}
						if operation == "delete" {
							return 20
						}
						return 10
					})
				})
			}
			<-started
			switch operation {
			case "delete":
				Delete(key)
			case "replace":
				SetAt(key, 30, time.Now())
			}
			close(release)
			readers.Wait()
			wantCalls, wantValue := int32(1), 10
			if operation == "delete" {
				wantCalls = 2 // The next reader refreshes the explicitly invalidated entry.
				wantValue = 20
			}
			if operation == "replace" {
				wantValue = 30
			}
			if calls.Load() != wantCalls || Get(key) != wantValue {
				t.Fatalf("loads=%d, value=%v; want %d, %d", calls.Load(), Get(key), wantCalls, wantValue)
			}
			for range 20 {
				if value := <-results; value != wantValue {
					t.Errorf("reader returned %v; want current value %d", value, wantValue)
				}
			}
		})
	}
}
