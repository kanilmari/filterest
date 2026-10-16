// metadata_cache_invalidation.go
// Connects committed registry writes to dependent readers' metadata caches.
// Lets readers subscribe without importing row handlers into the mutation layer.
// Keeps generic column-metadata and CSV saves on the same invalidation boundary.
package runtime_grant_mutations

import "sync"

var metadataCacheInvalidators struct {
	sync.RWMutex
	hooks []func()
}

// RegisterMetadataCacheInvalidator connects a reader during package initialization.
// Callbacks run synchronously after commit and must not perform database I/O.
func RegisterMetadataCacheInvalidator(invalidate func()) {
	metadataCacheInvalidators.Lock()
	defer metadataCacheInvalidators.Unlock()
	metadataCacheInvalidators.hooks = append(metadataCacheInvalidators.hooks, invalidate)
}

func invalidateDependentMetadataCaches() {
	metadataCacheInvalidators.RLock()
	hooks := append([]func(){}, metadataCacheInvalidators.hooks...)
	metadataCacheInvalidators.RUnlock()
	for _, invalidate := range hooks {
		invalidate()
	}
}
