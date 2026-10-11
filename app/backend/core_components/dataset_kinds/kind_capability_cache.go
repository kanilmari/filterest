// kind_capability_cache.go
// Memoizes classification by each requested dataset's complete scoped dependencies.
// Connects scoped evidence to ordinary, navigation and related response readers.
// Shares fingerprints with the evidence cache and bounds drop/rename churn.
package dataset_kinds

import (
	"crypto/sha256"
	"encoding/json"
	"slices"
	"sync"
)

type Cache struct {
	mu     sync.Mutex
	values map[int64]cachedCapabilities
}

type cachedCapabilities struct {
	fingerprint [32]byte
	value       Capabilities
}

const maximumCachedDatasets = 256

var capabilityCache Cache

func (c *Cache) Resolve(s Snapshot, uid int64) Capabilities {
	s = scopeEvidence(s, uid)
	raw, _ := json.Marshal(s) // Snapshot contains only JSON-compatible value types.
	fingerprint := sha256.Sum256(raw)
	return c.resolveFingerprinted(s, uid, fingerprint)
}

func (c *Cache) resolveFingerprinted(s Snapshot, uid int64, fingerprint [32]byte) Capabilities {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.values == nil {
		c.values = make(map[int64]cachedCapabilities)
	}
	entry, ok := c.values[uid]
	if !ok || entry.fingerprint != fingerprint {
		if !ok && len(c.values) >= maximumCachedDatasets {
			clear(c.values)
		}
		entry = cachedCapabilities{fingerprint: fingerprint, value: Resolve(s, uid)}
		c.values[uid] = entry
	}
	value := entry.value
	value.Views, value.Issues = slices.Clone(value.Views), slices.Clone(value.Issues)
	return value
}

func (c *Cache) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.values = nil
}

// InvalidateAll is called at the existing after-commit schema-cache boundary.
// Detach older in-flight reads without waiting for database I/O; only the
// current generation may publish evidence. External DDL follows TTL.
func InvalidateAll() {
	evidenceCache.mu.Lock()
	evidenceCache.values = nil
	evidenceCache.names = nil
	evidenceCache.pending = nil
	evidenceCache.generation++
	evidenceCache.mu.Unlock()
	capabilityCache.Invalidate()
}
