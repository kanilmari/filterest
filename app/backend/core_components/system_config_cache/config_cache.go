// config_cache.go
// Shares the existing five-minute runtime configuration cache across readers.
// Connects dataset metadata and middleware settings without duplicate stores.
// Keeps repeated diagnostics cheap and expires both saved and missing values.
package system_config_cache

import (
	"database/sql"
	"sync"
	"time"
)

const TTL = 5 * time.Minute

type entry struct {
	scope    *sql.DB
	value    any
	cachedAt time.Time
}

type pendingLoad struct {
	done        chan struct{}
	invalidated bool
}

var store = struct {
	sync.Mutex
	entries map[string]entry
	loading map[string]*pendingLoad
}{entries: make(map[string]entry), loading: make(map[string]*pendingLoad)}

// Get returns a live unscoped configuration entry, or nil after expiry.
func Get(key string) any {
	store.Lock()
	defer store.Unlock()
	item, ok := store.entries[key]
	if !ok || item.scope != nil || time.Since(item.cachedAt) >= TTL {
		return nil
	}
	return item.value
}

// SetAt retains the original metadata cache's timestamp and five-minute lifetime.
func SetAt(key string, value any, cachedAt time.Time) {
	store.Lock()
	defer store.Unlock()
	store.entries[key] = entry{value: value, cachedAt: cachedAt}
	if pending := store.loading[key]; pending != nil {
		pending.invalidated = true
	}
}

// Load coalesces concurrent misses and scopes a setting to its database handle.
// Loaders must not call this cache recursively; errors should return a safe default.
func Load(key string, scope *sql.DB, loader func() any) any {
	for {
		store.Lock()
		item, ok := store.entries[key]
		if ok && item.scope == scope && time.Since(item.cachedAt) < TTL {
			store.Unlock()
			return item.value
		}
		if pending := store.loading[key]; pending != nil {
			store.Unlock()
			<-pending.done
			continue
		}
		pending := &pendingLoad{done: make(chan struct{})}
		store.loading[key] = pending
		store.Unlock()

		func() {
			// Release waiters even if the loader panics. Other keys never wait
			// for this loader, and explicit writes/invalidations take precedence.
			defer func() {
				store.Lock()
				delete(store.loading, key)
				close(pending.done)
				store.Unlock()
			}()
			value := loader()
			store.Lock()
			if !pending.invalidated {
				store.entries[key] = entry{scope: scope, value: value, cachedAt: time.Now()}
			}
			store.Unlock()
		}()
		// Read the winning entry just like the waiters. An explicit deletion
		// leaves a miss to reload; a replacement must reach this caller too.
	}
}

// Delete invalidates a setting for isolated fixtures and explicit refreshes.
func Delete(key string) {
	store.Lock()
	defer store.Unlock()
	delete(store.entries, key)
	if pending := store.loading[key]; pending != nil {
		pending.invalidated = true
	}
}

// PurgeExpired reuses the dataset metadata cleanup loop for the shared store.
func PurgeExpired(now time.Time) {
	store.Lock()
	defer store.Unlock()
	for key, item := range store.entries {
		if now.Sub(item.cachedAt) >= TTL {
			delete(store.entries, key)
		}
	}
}
