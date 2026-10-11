// kind_evidence_cache.go
// Retains scoped schema evidence and its fingerprint for the metadata cache TTL.
// Connects named reads and UID batches through one bounded dataset cache.
// Shares generation-scoped cold reads without delaying committed invalidation.
package dataset_kinds

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"reflect"
	"slices"
	"sync"
	"time"
)

// SchemaMetadataTTL is shared with the row reader's column metadata cache.
const SchemaMetadataTTL = 5 * time.Minute

type evidenceKey struct {
	source schemaQuerier // Pools/transactions have separate database identities.
	uid    int64
	name   string // Unresolved names keep their own flight/negative-evidence key.
}

type evidenceName struct {
	source schemaQuerier
	name   string
}

type snapshotEvidence struct {
	snapshot    Snapshot
	fingerprint [32]byte
	cachedAt    time.Time
}

// An in-flight read belongs to one generation. Clearing the pending map detaches
// older queries immediately; their original callers still receive their result.
type evidenceFlight struct {
	generation uint64
	done       chan struct{}
	resultKey  evidenceKey
	entry      *snapshotEvidence
	err        error
}

type snapshotCache struct {
	mu         sync.Mutex
	values     map[evidenceKey]*snapshotEvidence
	names      map[evidenceName]evidenceKey
	pending    map[evidenceKey]*evidenceFlight
	generation uint64
}

const maximumCachedEvidenceAliases = 256

var evidenceCache snapshotCache

// Cache map helpers require mu; snapshots and fingerprints are prepared outside it.
func (c *snapshotCache) get(key evidenceKey) *snapshotEvidence {
	entry := c.values[key]
	if entry != nil && time.Since(entry.cachedAt) < SchemaMetadataTTL && evidenceMatches(key, key, entry) {
		return entry
	}
	if entry != nil {
		delete(c.values, key)
		c.removeAliases(key)
	}
	return nil
}

// Compare the discovered root, not a remembered alias or a dependency's name.
// Empty evidence is a valid negative lookup only under its actual query key.
func evidenceMatches(requestKey, resultKey evidenceKey, entry *snapshotEvidence) bool {
	if entry == nil || requestKey.source != resultKey.source {
		return false
	}
	root, registered := entry.snapshot.registration(resultKey.uid)
	if requestKey.name != "" {
		if registered {
			return root.Name == requestKey.name
		}
		return resultKey.name == requestKey.name && len(entry.snapshot.Registrations) == 0
	}
	return resultKey == requestKey && (registered || len(entry.snapshot.Registrations) == 0)
}

func (c *snapshotCache) removeAliases(key evidenceKey) {
	for name, target := range c.names {
		if target == key {
			delete(c.names, name)
		}
	}
}

func prepareEvidence(key evidenceKey, s Snapshot) *snapshotEvidence {
	s = scopeEvidence(s, key.uid)
	raw, _ := json.Marshal(s)
	return &snapshotEvidence{s, sha256.Sum256(raw), time.Now()}
}

func (c *snapshotCache) put(key evidenceKey, s Snapshot) *snapshotEvidence {
	entry := prepareEvidence(key, s)
	c.publish(key, entry)
	return entry
}

func (c *snapshotCache) publish(key evidenceKey, entry *snapshotEvidence) {
	if !evidenceMatches(key, key, entry) {
		return
	}
	if c.values == nil {
		c.values = make(map[evidenceKey]*snapshotEvidence)
		c.names = make(map[evidenceName]evidenceKey)
	}
	if _, exists := c.values[key]; !exists && len(c.values) >= maximumCachedDatasets {
		clear(c.values)
		clear(c.names)
	}
	// A UID retains only its current name, including after a TTL refresh.
	c.removeAliases(key)
	c.values[key] = entry
	name := key.name
	if root, ok := entry.snapshot.registration(key.uid); ok {
		name = root.Name
	}
	if name != "" {
		alias := evidenceName{key.source, name}
		if _, exists := c.names[alias]; !exists && len(c.names) >= maximumCachedEvidenceAliases {
			clear(c.names)
		}
		c.names[alias] = key
	}
}

func (c *snapshotCache) start(key evidenceKey) *evidenceFlight {
	if c.pending == nil {
		c.pending = make(map[evidenceKey]*evidenceFlight)
	}
	flight := &evidenceFlight{generation: c.generation, done: make(chan struct{})}
	c.pending[key] = flight
	return flight
}

func (c *snapshotCache) finish(requestKey, resultKey evidenceKey, flight *evidenceFlight, entry *snapshotEvidence, err error) {
	if flight.generation == c.generation {
		if err == nil {
			c.publish(resultKey, entry)
		}
		delete(c.pending, requestKey)
	}
	flight.resultKey, flight.entry, flight.err = resultKey, entry, err
	close(flight.done)
}

func (f *evidenceFlight) wait(ctx context.Context) (*snapshotEvidence, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-f.done:
		return f.entry, f.err
	}
}

// Before a first named query has discovered its UID (or vice versa), the two
// identities cannot be matched. Wait for opposite-form discovery and retry the
// lookup, preserving shared name/UID cold reads. Known/warm keys and unrelated
// same-form queries proceed independently; this wait never holds the mutex.
func (c *snapshotCache) discovery(key evidenceKey) *evidenceFlight {
	for other, flight := range c.pending {
		if other.source == key.source && (other.name != "") != (key.name != "") {
			return flight
		}
	}
	return nil
}

func (c *snapshotCache) readName(ctx context.Context, q schemaQuerier, schema, table string) (Snapshot, error) {
	// Non-comparable custom queriers cannot identify a cache source. Production
	// uses *sql.DB; bypassing here keeps the reader's interface usable by adapters.
	if !reflect.TypeOf(q).Comparable() {
		return readSnapshot(ctx, q, nil, []string{table}, schema)
	}
	name := schema + "." + table
	requestKey := evidenceKey{source: q, name: name}
	for {
		if err := ctx.Err(); err != nil {
			return Snapshot{}, err
		}
		c.mu.Lock()
		alias := evidenceName{q, name}
		key, found := c.names[alias]
		if !found {
			key = requestKey
		}
		if entry := c.get(key); evidenceMatches(requestKey, key, entry) {
			c.mu.Unlock()
			return combineEvidence(map[int64]*snapshotEvidence{key.uid: entry}), nil
		}
		// get may have expired and removed the alias. A missing or mismatched
		// target is equally unresolved: never refresh a name under its old UID.
		delete(c.names, alias)
		key = requestKey
		if flight := c.pending[key]; flight != nil {
			c.mu.Unlock()
			entry, err := flight.wait(ctx)
			if err != nil {
				return Snapshot{}, err
			}
			if !evidenceMatches(requestKey, flight.resultKey, entry) {
				continue
			}
			return combineEvidence(map[int64]*snapshotEvidence{flight.resultKey.uid: entry}), nil
		}
		if flight := c.discovery(key); flight != nil {
			c.mu.Unlock()
			_, _ = flight.wait(ctx)
			continue
		}
		flight := c.start(key)
		c.mu.Unlock()

		s, err := readSnapshot(ctx, q, nil, []string{table}, schema)
		resultKey := evidenceKey{source: q, name: name}
		var entry *snapshotEvidence
		if err == nil {
			for _, reg := range s.Registrations {
				if reg.Name == name {
					resultKey.uid, resultKey.name = reg.UID, ""
					break
				}
			}
			entry = prepareEvidence(resultKey, s)
		}
		c.mu.Lock()
		c.finish(key, resultKey, flight, entry, err)
		c.mu.Unlock()
		if err != nil {
			return Snapshot{}, err // Failures are never cached.
		}
		if !evidenceMatches(requestKey, resultKey, entry) {
			continue
		}
		return combineEvidence(map[int64]*snapshotEvidence{resultKey.uid: entry}), nil
	}
}

func (c *snapshotCache) readUIDs(ctx context.Context, q schemaQuerier, uids []int64) (Snapshot, error) {
	if !reflect.TypeOf(q).Comparable() {
		return readSnapshot(ctx, q, uids, nil, "public")
	}
	for {
		if err := ctx.Err(); err != nil {
			return Snapshot{}, err
		}
		c.mu.Lock()
		entries := make(map[int64]*snapshotEvidence, len(uids))
		waiting := make(map[int64]*evidenceFlight)
		missing := []int64{}
		var discovery *evidenceFlight
		for _, uid := range uids {
			if _, seen := entries[uid]; seen {
				continue
			}
			key := evidenceKey{source: q, uid: uid}
			entries[uid] = c.get(key)
			if entries[uid] == nil {
				if flight := c.pending[key]; flight != nil {
					waiting[uid] = flight
				} else {
					missing = append(missing, uid)
					if discovery == nil {
						discovery = c.discovery(key)
					}
				}
			}
		}
		if discovery != nil {
			c.mu.Unlock()
			_, _ = discovery.wait(ctx)
			continue
		}
		for _, uid := range missing {
			waiting[uid] = c.start(evidenceKey{source: q, uid: uid})
		}
		c.mu.Unlock()

		if len(missing) > 0 {
			// Own every missing key before one batched query. Overlapping callers
			// share those flights while querying only their additional cold keys.
			s, err := readSnapshot(ctx, q, missing, nil, "public")
			for _, uid := range missing {
				key := evidenceKey{source: q, uid: uid}
				var entry *snapshotEvidence
				if err == nil {
					entry = prepareEvidence(key, s)
				}
				c.mu.Lock()
				c.finish(key, key, waiting[uid], entry, err)
				c.mu.Unlock()
			}
		}
		retry := false
		for uid, flight := range waiting {
			entry, err := flight.wait(ctx)
			if err != nil {
				return Snapshot{}, err
			}
			if !evidenceMatches(evidenceKey{source: q, uid: uid}, flight.resultKey, entry) {
				retry = true
				continue
			}
			entries[uid] = entry
		}
		if retry {
			continue // Rediscover/join the requested UIDs; never relabel a result.
		}
		return combineEvidence(entries), nil
	}
}

func combineEvidence(entries map[int64]*snapshotEvidence) Snapshot {
	s := Snapshot{cachedEvidence: entries}
	registrations, shapes := make(map[int64]Registration), make(map[string]Shape)
	for _, entry := range entries {
		for _, reg := range entry.snapshot.Registrations {
			// Cached entries are immutable; public slices/configuration belong to
			// this request so callers cannot corrupt another warm or concurrent read.
			if relation := reg.Configuration.Embeddings; relation != nil {
				copy := *relation
				reg.Configuration.Embeddings = &copy
			}
			if relation := reg.Configuration.Locations; relation != nil {
				copy := *relation
				reg.Configuration.Locations = &copy
			}
			registrations[reg.UID] = reg
		}
		for _, shape := range entry.snapshot.Shapes {
			shape.Columns = slices.Clone(shape.Columns)
			shape.PrimaryKey = slices.Clone(shape.PrimaryKey)
			shape.Unique = slices.Clone(shape.Unique)
			for i := range shape.Unique {
				shape.Unique[i] = slices.Clone(shape.Unique[i])
			}
			shape.ForeignKeys = slices.Clone(shape.ForeignKeys)
			for i := range shape.ForeignKeys {
				shape.ForeignKeys[i].Columns = slices.Clone(shape.ForeignKeys[i].Columns)
				shape.ForeignKeys[i].TargetColumns = slices.Clone(shape.ForeignKeys[i].TargetColumns)
			}
			shape.UpdateTriggers = slices.Clone(shape.UpdateTriggers)
			shapes[shape.Name] = shape
		}
	}
	for _, reg := range registrations {
		s.Registrations = append(s.Registrations, reg)
	}
	for _, shape := range shapes {
		s.Shapes = append(s.Shapes, shape)
	}
	slices.SortFunc(s.Registrations, func(a, b Registration) int {
		if a.UID < b.UID {
			return -1
		}
		if a.UID > b.UID {
			return 1
		}
		return 0
	})
	slices.SortFunc(s.Shapes, func(a, b Shape) int {
		if a.Name < b.Name {
			return -1
		}
		if a.Name > b.Name {
			return 1
		}
		return 0
	})
	return s
}
