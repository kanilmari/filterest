// load_balancer.go
// Implements an HTTP reverse proxy load balancer over registered AppNodes.
// Bridges incoming HTTP traffic and a set of backend application servers,
// routing each request to an eligible active-primary or weighted target.
// Exists to distribute HTTP/application traffic across multiple app servers
// while excluding unhealthy, unknown, draining, and disabled nodes.
package cloud

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
	"sync/atomic"
)

// RoutingPolicy selects the target-choice algorithm used by LoadBalancer.
type RoutingPolicy string

const (
	// RoutingPolicyWeightedRoundRobin balances traffic across eligible nodes.
	RoutingPolicyWeightedRoundRobin RoutingPolicy = "weighted-round-robin"
	// RoutingPolicyActivePrimary sends traffic to active nodes before standby.
	RoutingPolicyActivePrimary RoutingPolicy = "active-primary"
)

// LoadBalancerConfig holds routing behavior for the load balancer.
type LoadBalancerConfig struct {
	// RoutingPolicy defaults to weighted-round-robin for backward compatibility.
	RoutingPolicy RoutingPolicy
	// Transport optionally overrides the reverse proxy transport.
	Transport http.RoundTripper
}

// LoadBalancer routes incoming HTTP requests across a set of healthy AppNodes
// using the configured routing policy.
//
// Usage:
//
//	lb, err := NewLoadBalancer([]*AppNode{...})
//	http.ListenAndServe(":80", lb)
type LoadBalancer struct {
	nodes    []*AppNode
	proxies  map[string]*httputil.ReverseProxy // keyed by AppNode.ID
	policy   RoutingPolicy
	mu       sync.RWMutex
	counter  atomic.Uint64                                // monotonically increasing request counter
	onNoNode func(w http.ResponseWriter, r *http.Request) // called when no healthy node is available
}

// NewLoadBalancer creates a LoadBalancer from the supplied nodes.
// It uses weighted-round-robin routing for compatibility with older callers.
func NewLoadBalancer(nodes []*AppNode) (*LoadBalancer, error) {
	return NewLoadBalancerWithConfig(nodes, LoadBalancerConfig{})
}

// NewLoadBalancerWithConfig creates a LoadBalancer with explicit routing config.
// Run a HealthChecker before serving traffic; unknown-status nodes are not
// eligible for new traffic in cloud-readiness mode.
func NewLoadBalancerWithConfig(nodes []*AppNode, cfg LoadBalancerConfig) (*LoadBalancer, error) {
	if len(nodes) == 0 {
		return nil, fmt.Errorf("load balancer requires at least one node")
	}
	policy, ok := normalizeRoutingPolicy(cfg.RoutingPolicy)
	if !ok {
		return nil, fmt.Errorf("unsupported routing policy %q", cfg.RoutingPolicy)
	}

	proxies := make(map[string]*httputil.ReverseProxy, len(nodes))
	for _, n := range nodes {
		u, err := url.Parse(n.Address)
		if err != nil {
			return nil, fmt.Errorf("node %q: invalid address %q: %w", n.ID, n.Address, err)
		}
		proxy := httputil.NewSingleHostReverseProxy(u)
		if cfg.Transport != nil {
			proxy.Transport = cfg.Transport
		}
		// Attach a custom error handler so upstream failures are logged with
		// the node ID rather than swallowed silently.
		proxy.ErrorHandler = makeProxyErrorHandler(n)
		proxies[n.ID] = proxy
	}

	return &LoadBalancer{
		nodes:   nodes,
		proxies: proxies,
		policy:  policy,
		onNoNode: func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "service unavailable: no route-eligible backend nodes", http.StatusServiceUnavailable)
		},
	}, nil
}

// SetNoNodeHandler replaces the default 503 response used when all nodes are
// unhealthy.  The handler must not be nil.
func (lb *LoadBalancer) SetNoNodeHandler(h func(w http.ResponseWriter, r *http.Request)) {
	if h == nil {
		return
	}
	lb.mu.Lock()
	lb.onNoNode = h
	lb.mu.Unlock()
}

// ServeHTTP implements http.Handler. It selects the next route-eligible node,
// accounts for the in-flight request, and proxies the request.
func (lb *LoadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	node := lb.pick()
	if node == nil {
		lb.mu.RLock()
		handler := lb.onNoNode
		lb.mu.RUnlock()
		handler(w, r)
		return
	}
	node.beginRequest()
	defer node.endRequest()

	lb.mu.RLock()
	proxy := lb.proxies[node.ID]
	lb.mu.RUnlock()

	slog.Debug("load_balancer: routing request",
		slog.String("node", node.ID),
		slog.String("path", r.URL.Path),
	)
	proxy.ServeHTTP(w, r)
}

// Nodes returns a snapshot of all registered nodes (healthy or not).
func (lb *LoadBalancer) Nodes() []*AppNode {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	out := make([]*AppNode, len(lb.nodes))
	copy(out, lb.nodes)
	return out
}

// HealthyCount returns the number of currently healthy nodes.
func (lb *LoadBalancer) HealthyCount() int {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	count := 0
	for _, n := range lb.nodes {
		if n.Status() == NodeStatusHealthy {
			count++
		}
	}
	return count
}

// RouteEligibleCount returns the number of nodes currently eligible for traffic.
func (lb *LoadBalancer) RouteEligibleCount() int {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	return len(lb.routeEligibleCandidates())
}

// RoutingPolicy returns the load balancer's target-choice policy.
func (lb *LoadBalancer) RoutingPolicy() RoutingPolicy {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	return lb.policy
}

// pick selects the next route-eligible node using the configured policy.
// It returns nil if no healthy and allowed node is available.
func (lb *LoadBalancer) pick() *AppNode {
	lb.mu.RLock()
	candidates := lb.routeEligibleCandidates()
	policy := lb.policy
	lb.mu.RUnlock()

	switch policy {
	case RoutingPolicyActivePrimary:
		return pickActivePrimary(candidates)
	default:
		return lb.pickWeightedRoundRobin(candidates)
	}
}

// pickWeightedRoundRobin selects the next candidate using weighted slots.
//
// Algorithm: expand the healthy node list into a virtual slot list according
// to each node's effective weight, then select the slot at
// (counter % totalSlots).  This avoids O(n²) expansion by computing the slot
// winner arithmetically.
func (lb *LoadBalancer) pickWeightedRoundRobin(candidates []*AppNode) *AppNode {
	if len(candidates) == 0 {
		return nil
	}
	if len(candidates) == 1 {
		return candidates[0]
	}

	// Compute total weight.
	total := 0
	for _, c := range candidates {
		total += c.effectiveWeight()
	}
	if total == 0 {
		return candidates[0]
	}

	// Map the monotonic counter to a position in [0, total).
	pos := int(lb.counter.Add(1)-1) % total

	// Walk the candidate list to find which node owns that position.
	cumulative := 0
	for _, c := range candidates {
		cumulative += c.effectiveWeight()
		if pos < cumulative {
			return c
		}
	}
	// Fallback (should not be reached).
	return candidates[0]
}

// pickActivePrimary selects the first active candidate, then standby failover.
func pickActivePrimary(candidates []*AppNode) *AppNode {
	for _, candidate := range candidates {
		if candidate.DesiredStateValue() == AppDesiredStateActive {
			return candidate
		}
	}
	for _, candidate := range candidates {
		if candidate.DesiredStateValue() == AppDesiredStateStandby {
			return candidate
		}
	}
	return nil
}

// routeEligibleCandidates returns nodes eligible to receive traffic.
// A node must be healthy and in an active or standby desired state.
// Caller must hold lb.mu (read).
func (lb *LoadBalancer) routeEligibleCandidates() []*AppNode {
	out := make([]*AppNode, 0, len(lb.nodes))
	for _, n := range lb.nodes {
		if routeEligible(n) {
			out = append(out, n)
		}
	}
	return out
}

// routeEligible decides whether a node may receive a new ordinary request.
func routeEligible(n *AppNode) bool {
	if n == nil || n.Status() != NodeStatusHealthy {
		return false
	}
	switch n.DesiredStateValue() {
	case AppDesiredStateActive, AppDesiredStateStandby:
		return true
	default:
		return false
	}
}

// normalizeRoutingPolicy keeps routing policy values bounded.
func normalizeRoutingPolicy(policy RoutingPolicy) (RoutingPolicy, bool) {
	switch policy {
	case "", RoutingPolicyWeightedRoundRobin:
		return RoutingPolicyWeightedRoundRobin, true
	case RoutingPolicyActivePrimary:
		return RoutingPolicyActivePrimary, true
	default:
		return "", false
	}
}

// makeProxyErrorHandler returns a ReverseProxy.ErrorHandler that logs the
// failure with the originating node ID.
func makeProxyErrorHandler(n *AppNode) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Error("load_balancer: upstream proxy error",
			slog.String("node", n.ID),
			slog.String("address", n.Address),
			slog.String("path", r.URL.Path),
			slog.Any("error", err),
		)
		http.Error(w, "bad gateway: upstream node error", http.StatusBadGateway)
	}
}
