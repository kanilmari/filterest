// node.go
// Defines the AppNode and DBNode types used throughout the cloud layer.
// AppNode represents a backend HTTP application server; DBNode represents
// a PostgreSQL instance (primary or read replica).
// Bridges routing, drain state, health probes, and DB pool bookkeeping.
// Exists to provide a shared, concurrency-safe node model without circular
// imports.
package cloud

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// NodeStatus represents the current health of a registered node.
type NodeStatus string

const (
	// NodeStatusHealthy means the node is reachable and accepting traffic.
	NodeStatusHealthy NodeStatus = "healthy"
	// NodeStatusUnhealthy means the node failed its most recent health check.
	NodeStatusUnhealthy NodeStatus = "unhealthy"
	// NodeStatusUnknown is the initial status before the first health check completes.
	NodeStatusUnknown NodeStatus = "unknown"
)

// AppDesiredState describes whether an app node may receive new traffic.
type AppDesiredState string

const (
	// AppDesiredStateActive means the node is the preferred traffic target.
	AppDesiredStateActive AppDesiredState = "active"
	// AppDesiredStateStandby means the node is ready but used only for failover.
	AppDesiredStateStandby AppDesiredState = "standby"
	// AppDesiredStateDraining means the node must receive no new traffic.
	AppDesiredStateDraining AppDesiredState = "draining"
	// AppDesiredStateInactive means the node must receive no traffic.
	AppDesiredStateInactive AppDesiredState = "inactive"
	// AppDesiredStateMaintenance means the node is operator-owned and never routed.
	AppDesiredStateMaintenance AppDesiredState = "maintenance"
)

// DBRole classifies a database node's replication role.
type DBRole string

const (
	// DBRolePrimary accepts reads and writes.
	DBRolePrimary DBRole = "primary"
	// DBRoleReplica is read-only.
	DBRoleReplica DBRole = "replica"
)

// AppNode is a backend HTTP application server registered with the load balancer.
type AppNode struct {
	// ID is a human-readable unique identifier (e.g. "app-1").
	ID string
	// Address is the base URL of the server, e.g. "https://app1.internal:8082".
	Address string
	// Weight controls proportional traffic share in weighted round-robin.
	// A weight of 0 is treated as 1.
	Weight int
	// DesiredState controls routing eligibility; empty means active.
	DesiredState AppDesiredState

	mu              sync.RWMutex
	status          NodeStatus
	lastChecked     time.Time
	consecutiveFail int
	activeRequests  atomic.Int64
}

// Status returns the node's current health status (safe for concurrent use).
func (n *AppNode) Status() NodeStatus {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.status
}

// DesiredStateValue returns the node's routing state; empty maps to active.
func (n *AppNode) DesiredStateValue() AppDesiredState {
	n.mu.RLock()
	defer n.mu.RUnlock()
	if n.DesiredState == "" {
		return AppDesiredStateActive
	}
	return n.DesiredState
}

// SetDesiredState updates the node's routing state after validating it.
func (n *AppNode) SetDesiredState(state AppDesiredState) error {
	normalized, ok := normalizeAppDesiredState(state)
	if !ok {
		return fmt.Errorf("invalid app desired state %q", state)
	}
	n.mu.Lock()
	n.DesiredState = normalized
	n.mu.Unlock()
	return nil
}

// LastChecked returns the timestamp of the node's latest health observation.
func (n *AppNode) LastChecked() time.Time {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.lastChecked
}

// ActiveRequests returns the number of in-flight proxied requests for this node.
func (n *AppNode) ActiveRequests() int64 {
	return n.activeRequests.Load()
}

// RouteEligible reports whether this node can receive a new ordinary request.
func (n *AppNode) RouteEligible() bool {
	return routeEligible(n)
}

// beginRequest increments in-flight request accounting for operator visibility.
func (n *AppNode) beginRequest() {
	n.activeRequests.Add(1)
}

// endRequest decrements in-flight request accounting after proxying finishes.
func (n *AppNode) endRequest() {
	n.activeRequests.Add(-1)
}

// setStatus updates the node's health status and bookkeeping fields.
func (n *AppNode) setStatus(s NodeStatus, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if s == NodeStatusHealthy {
		n.consecutiveFail = 0
	} else {
		n.consecutiveFail++
	}
	n.status = s
	n.lastChecked = now
}

// effectiveWeight returns Weight, treating 0 as 1.
func (n *AppNode) effectiveWeight() int {
	if n.Weight <= 0 {
		return 1
	}
	return n.Weight
}

// normalizeAppDesiredState keeps desired routing states bounded.
func normalizeAppDesiredState(state AppDesiredState) (AppDesiredState, bool) {
	switch state {
	case "", AppDesiredStateActive:
		return AppDesiredStateActive, true
	case AppDesiredStateStandby:
		return AppDesiredStateStandby, true
	case AppDesiredStateDraining:
		return AppDesiredStateDraining, true
	case AppDesiredStateInactive:
		return AppDesiredStateInactive, true
	case AppDesiredStateMaintenance:
		return AppDesiredStateMaintenance, true
	default:
		return "", false
	}
}

// DBNode is a PostgreSQL instance registered with the DB connection pool.
type DBNode struct {
	// ID is a human-readable unique identifier (e.g. "db-primary", "db-replica-1").
	ID string
	// DSN is the libpq-compatible connection string used to open a *sql.DB.
	DSN string
	// Role distinguishes the primary (read-write) from replicas (read-only).
	Role DBRole
	// HealthCheckQuery is executed during health checks (default: "SELECT 1").
	HealthCheckQuery string

	mu          sync.RWMutex
	status      NodeStatus
	lastChecked time.Time
}

// Status returns the node's current health status (safe for concurrent use).
func (n *DBNode) Status() NodeStatus {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.status
}

// setStatus updates the node's health status.
func (n *DBNode) setStatus(s NodeStatus, now time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.status = s
	n.lastChecked = now
}

// healthCheckQuery returns the configured query or the safe default.
func (n *DBNode) healthCheckQuery() string {
	if n.HealthCheckQuery != "" {
		return n.HealthCheckQuery
	}
	return "SELECT 1"
}
