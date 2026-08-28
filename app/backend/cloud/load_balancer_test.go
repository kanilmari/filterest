// load_balancer_test.go
// Verifies cloud-layer HTTP routing policy and route eligibility decisions.
// Bridges in-process HTTP backends and AppNode state so traffic behavior can
// be tested without starting real Easelect instances.
// Exists to keep active-primary and drain exclusion safe while #826 evolves.
package cloud

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewLoadBalancerRequiresNodes(t *testing.T) {
	_, err := NewLoadBalancer(nil)
	if err == nil {
		t.Fatal("expected error for empty node list")
	}
}

func TestNewLoadBalancerRejectsInvalidAddress(t *testing.T) {
	_, err := NewLoadBalancer([]*AppNode{
		{ID: "bad", Address: "://not-a-url"},
	})
	if err == nil {
		t.Fatal("expected error for invalid address")
	}
}

func TestNewLoadBalancerWithConfigRejectsUnknownPolicy(t *testing.T) {
	_, err := NewLoadBalancerWithConfig([]*AppNode{
		{ID: "node1", Address: "http://127.0.0.1:8082"},
	}, LoadBalancerConfig{RoutingPolicy: RoutingPolicy("random")})
	if err == nil {
		t.Fatal("expected error for unsupported routing policy")
	}
}

func TestLoadBalancerWeightedRoundRobin(t *testing.T) {
	srv1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "node1")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv1.Close()

	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "node2")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv2.Close()

	nodes := []*AppNode{
		makeAppNode("node1", srv1.URL, 2),
		makeAppNode("node2", srv2.URL, 1),
	}
	lb, err := NewLoadBalancer(nodes)
	if err != nil {
		t.Fatalf("NewLoadBalancer: %v", err)
	}

	hits := map[string]int{}
	for i := 0; i < 60; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		lb.ServeHTTP(rec, req)
		hits[rec.Header().Get("X-Node")]++
	}

	if hits["node1"] < 35 || hits["node1"] > 45 {
		t.Fatalf("node1 hits=%d, expected ~40/60", hits["node1"])
	}
}

func TestLoadBalancerActivePrimaryPrefersActiveNode(t *testing.T) {
	activeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "active")
		w.WriteHeader(http.StatusOK)
	}))
	defer activeSrv.Close()

	standbySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "standby")
		w.WriteHeader(http.StatusOK)
	}))
	defer standbySrv.Close()

	nodes := []*AppNode{
		{ID: "active", Address: activeSrv.URL, DesiredState: AppDesiredStateActive, status: NodeStatusHealthy},
		{ID: "standby", Address: standbySrv.URL, DesiredState: AppDesiredStateStandby, Weight: 100, status: NodeStatusHealthy},
	}
	lb, err := NewLoadBalancerWithConfig(nodes, LoadBalancerConfig{RoutingPolicy: RoutingPolicyActivePrimary})
	if err != nil {
		t.Fatalf("NewLoadBalancerWithConfig: %v", err)
	}

	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		lb.ServeHTTP(rec, req)
		if got := rec.Header().Get("X-Node"); got != "active" {
			t.Fatalf("request %d routed to %q, want active", i, got)
		}
	}
}

func TestLoadBalancerActivePrimaryFailsOverToStandby(t *testing.T) {
	activeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "active")
		w.WriteHeader(http.StatusOK)
	}))
	defer activeSrv.Close()

	standbySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "standby")
		w.WriteHeader(http.StatusOK)
	}))
	defer standbySrv.Close()

	nodes := []*AppNode{
		{ID: "active", Address: activeSrv.URL, DesiredState: AppDesiredStateActive, status: NodeStatusUnhealthy},
		{ID: "standby", Address: standbySrv.URL, DesiredState: AppDesiredStateStandby, status: NodeStatusHealthy},
	}
	lb, err := NewLoadBalancerWithConfig(nodes, LoadBalancerConfig{RoutingPolicy: RoutingPolicyActivePrimary})
	if err != nil {
		t.Fatalf("NewLoadBalancerWithConfig: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	lb.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Node"); got != "standby" {
		t.Fatalf("request routed to %q, want standby failover", got)
	}
}

func TestLoadBalancerExcludesDrainingNodeFromTraffic(t *testing.T) {
	activeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "active")
		w.WriteHeader(http.StatusOK)
	}))
	defer activeSrv.Close()

	drainingSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Node", "draining")
		w.WriteHeader(http.StatusOK)
	}))
	defer drainingSrv.Close()

	nodes := []*AppNode{
		{ID: "active", Address: activeSrv.URL, DesiredState: AppDesiredStateActive, status: NodeStatusHealthy},
		{ID: "draining", Address: drainingSrv.URL, DesiredState: AppDesiredStateDraining, status: NodeStatusHealthy},
	}
	lb, err := NewLoadBalancerWithConfig(nodes, LoadBalancerConfig{RoutingPolicy: RoutingPolicyActivePrimary})
	if err != nil {
		t.Fatalf("NewLoadBalancerWithConfig: %v", err)
	}

	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		lb.ServeHTTP(rec, req)
		if got := rec.Header().Get("X-Node"); got != "active" {
			t.Fatalf("request %d routed to %q, want active", i, got)
		}
	}
	if got := lb.RouteEligibleCount(); got != 1 {
		t.Fatalf("RouteEligibleCount() = %d, want 1", got)
	}
}

func TestLoadBalancerUnknownNodeIsNotRouteEligible(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	node := &AppNode{ID: "unknown", Address: srv.URL, DesiredState: AppDesiredStateActive, status: NodeStatusUnknown}
	lb, err := NewLoadBalancerWithConfig([]*AppNode{node}, LoadBalancerConfig{RoutingPolicy: RoutingPolicyActivePrimary})
	if err != nil {
		t.Fatalf("NewLoadBalancerWithConfig: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	lb.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 for unknown node", rec.Code)
	}
}

func TestLoadBalancerSkipsUnhealthyNodes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	healthy := makeAppNode("healthy", srv.URL, 1)
	unhealthy := makeAppNode("unhealthy", srv.URL, 1)
	unhealthy.status = NodeStatusUnhealthy

	lb, err := NewLoadBalancer([]*AppNode{healthy, unhealthy})
	if err != nil {
		t.Fatalf("NewLoadBalancer: %v", err)
	}

	for i := 0; i < 10; i++ {
		node := lb.pick()
		if node == nil {
			t.Fatal("pick() returned nil with one healthy node")
		}
		if node.ID != "healthy" {
			t.Fatalf("expected healthy node, got %q", node.ID)
		}
	}
}

func TestLoadBalancerNoHealthyNodesReturns503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()

	n := makeAppNode("n", srv.URL, 1)
	n.status = NodeStatusUnhealthy

	lb, err := NewLoadBalancer([]*AppNode{n})
	if err != nil {
		t.Fatalf("NewLoadBalancer: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	lb.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestLoadBalancerTracksActiveRequests(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	node := makeAppNode("tracked", srv.URL, 1)
	lb, err := NewLoadBalancer([]*AppNode{node})
	if err != nil {
		t.Fatalf("NewLoadBalancer: %v", err)
	}

	done := make(chan struct{})
	go func() {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		lb.ServeHTTP(rec, req)
		close(done)
	}()

	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream request was not reached")
	}

	if got := node.ActiveRequests(); got != 1 {
		t.Fatalf("ActiveRequests() during proxy = %d, want 1", got)
	}
	close(release)

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("proxied request did not finish")
	}
	if got := node.ActiveRequests(); got != 0 {
		t.Fatalf("ActiveRequests() after proxy = %d, want 0", got)
	}
}

func TestLoadBalancerHealthyCount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()

	n1 := makeAppNode("n1", srv.URL, 1)
	n2 := makeAppNode("n2", srv.URL, 1)
	n2.status = NodeStatusUnhealthy

	lb, err := NewLoadBalancer([]*AppNode{n1, n2})
	if err != nil {
		t.Fatalf("NewLoadBalancer: %v", err)
	}

	if count := lb.HealthyCount(); count != 1 {
		t.Fatalf("expected HealthyCount=1, got %d", count)
	}
}
