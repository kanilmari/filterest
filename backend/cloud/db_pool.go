// db_pool.go
// Implements a read-replica-aware database connection pool over multiple
// PostgreSQL nodes.
// Bridges the standard database/sql package and a set of DBNodes, routing
// write operations to the primary and read operations to replicas using
// round-robin selection with automatic primary fallback.
// Exists to hide multi-server DB topology from application code: callers
// request a Primary() or Replica() connection and the pool selects the
// appropriate healthy node transparently.
package cloud

import (
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"

	_ "github.com/lib/pq" // PostgreSQL driver — blank import for side-effects
)

// DBPool manages open *sql.DB connections to a primary PostgreSQL instance
// and zero or more read replicas.
//
// Usage:
//
//	pool, err := NewDBPool(nodes, sql.Open)
//	primary, err := pool.Primary()
//	replica, err  := pool.Replica()   // falls back to primary when no replicas are healthy
type DBPool struct {
	primary  *managedDB
	replicas []*managedDB
	mu       sync.RWMutex
	counter  atomic.Uint64 // used for round-robin replica selection
}

// managedDB pairs a DBNode descriptor with its live *sql.DB connection.
type managedDB struct {
	node *DBNode
	db   *sql.DB
}

// OpenFunc is a function with the same signature as sql.Open.
// Injecting it allows tests to substitute a fake driver without touching
// the real PostgreSQL network.
type OpenFunc func(driverName, dataSourceName string) (*sql.DB, error)

// NewDBPool opens connections to all supplied nodes and organises them into
// a primary + replicas pool.  Exactly one node must have DBRolePrimary.
//
// openFn is typically sql.Open; pass a custom function in tests.
func NewDBPool(nodes []*DBNode, openFn OpenFunc) (*DBPool, error) {
	if openFn == nil {
		openFn = sql.Open
	}

	pool := &DBPool{}

	for _, n := range nodes {
		db, err := openFn("postgres", n.DSN)
		if err != nil {
			return nil, fmt.Errorf("db_pool: open node %q: %w", n.ID, err)
		}
		mdb := &managedDB{node: n, db: db}

		switch n.Role {
		case DBRolePrimary:
			if pool.primary != nil {
				return nil, fmt.Errorf("db_pool: multiple primary nodes registered (%q and %q); exactly one is required",
					pool.primary.node.ID, n.ID)
			}
			pool.primary = mdb
		case DBRoleReplica:
			pool.replicas = append(pool.replicas, mdb)
		default:
			return nil, fmt.Errorf("db_pool: node %q has unknown role %q", n.ID, n.Role)
		}
	}

	if pool.primary == nil {
		return nil, fmt.Errorf("db_pool: no primary node registered; exactly one DBRolePrimary node is required")
	}

	return pool, nil
}

// Primary returns the *sql.DB for the primary (read-write) node.
// Returns an error if the primary is currently marked unhealthy.
func (p *DBPool) Primary() (*sql.DB, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	s := p.primary.node.Status()
	if s == NodeStatusUnhealthy {
		return nil, fmt.Errorf("db_pool: primary node %q is unhealthy", p.primary.node.ID)
	}
	return p.primary.db, nil
}

// Replica returns a *sql.DB from the healthy replica pool using round-robin
// selection.  If no replicas are registered or all replicas are unhealthy,
// it falls back to the primary so the caller never has to handle that case.
func (p *DBPool) Replica() (*sql.DB, error) {
	p.mu.RLock()
	candidates := p.healthyReplicas()
	p.mu.RUnlock()

	if len(candidates) == 0 {
		slog.Debug("db_pool: no healthy replicas, falling back to primary")
		return p.Primary()
	}

	idx := int(p.counter.Add(1)-1) % len(candidates)
	chosen := candidates[idx]
	slog.Debug("db_pool: routing read to replica",
		slog.String("node", chosen.node.ID),
	)
	return chosen.db, nil
}

// Close closes all managed *sql.DB connections (primary and replicas).
// After Close the pool must not be used.
func (p *DBPool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.primary != nil {
		if err := p.primary.db.Close(); err != nil {
			slog.Error("db_pool: error closing primary connection",
				slog.String("node", p.primary.node.ID),
				slog.Any("error", err),
			)
		}
	}
	for _, r := range p.replicas {
		if err := r.db.Close(); err != nil {
			slog.Error("db_pool: error closing replica connection",
				slog.String("node", r.node.ID),
				slog.Any("error", err),
			)
		}
	}
}

// Nodes returns a snapshot of all DBNode descriptors known to the pool.
func (p *DBPool) Nodes() []*DBNode {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var out []*DBNode
	if p.primary != nil {
		out = append(out, p.primary.node)
	}
	for _, r := range p.replicas {
		out = append(out, r.node)
	}
	return out
}

// healthyReplicas returns the subset of replicas that are healthy or unknown.
// Caller must hold p.mu (read).
func (p *DBPool) healthyReplicas() []*managedDB {
	out := make([]*managedDB, 0, len(p.replicas))
	for _, r := range p.replicas {
		s := r.node.Status()
		if s == NodeStatusHealthy || s == NodeStatusUnknown {
			out = append(out, r)
		}
	}
	return out
}
