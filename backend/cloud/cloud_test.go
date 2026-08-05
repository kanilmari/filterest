// cloud_test.go
// Unit tests for the cloud layer: load balancer, DB pool, and health checker.
// All tests run without network I/O — HTTP servers and DB connections are
// replaced with in-process fakes.
package cloud

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func makeAppNode(id, addr string, weight int) *AppNode {
	return &AppNode{
		ID:      id,
		Address: addr,
		Weight:  weight,
		status:  NodeStatusHealthy,
	}
}

func makeDBNode(id string, role DBRole) *DBNode {
	return &DBNode{ID: id, DSN: "fake", Role: role, status: NodeStatusHealthy}
}

// ---------------------------------------------------------------------------
// node.go
// ---------------------------------------------------------------------------

func TestAppNodeSetStatusHealthy(t *testing.T) {
	n := &AppNode{ID: "n1", status: NodeStatusUnknown}
	n.setStatus(NodeStatusHealthy, time.Now())
	if got := n.Status(); got != NodeStatusHealthy {
		t.Fatalf("expected healthy, got %q", got)
	}
	if n.consecutiveFail != 0 {
		t.Fatalf("consecutiveFail should reset to 0 on healthy, got %d", n.consecutiveFail)
	}
}

func TestAppNodeSetStatusUnhealthyIncrementsFailCount(t *testing.T) {
	n := &AppNode{ID: "n1", status: NodeStatusUnknown}
	n.setStatus(NodeStatusUnhealthy, time.Now())
	n.setStatus(NodeStatusUnhealthy, time.Now())
	if n.consecutiveFail != 2 {
		t.Fatalf("expected consecutiveFail=2, got %d", n.consecutiveFail)
	}
}

func TestAppNodeEffectiveWeightDefault(t *testing.T) {
	n := &AppNode{ID: "n1", Weight: 0}
	if w := n.effectiveWeight(); w != 1 {
		t.Fatalf("effectiveWeight with Weight=0 should be 1, got %d", w)
	}
}

func TestAppNodeDesiredStateDefaultsToActive(t *testing.T) {
	n := &AppNode{ID: "n1"}
	if got := n.DesiredStateValue(); got != AppDesiredStateActive {
		t.Fatalf("DesiredStateValue() = %q, want active", got)
	}
}

func TestAppNodeSetDesiredStateRejectsInvalidState(t *testing.T) {
	n := &AppNode{ID: "n1"}
	if err := n.SetDesiredState(AppDesiredState("sideways")); err == nil {
		t.Fatal("expected invalid desired state to fail")
	}
	if got := n.DesiredStateValue(); got != AppDesiredStateActive {
		t.Fatalf("DesiredStateValue() after invalid set = %q, want active", got)
	}
}

func TestDBNodeHealthCheckQueryDefault(t *testing.T) {
	n := &DBNode{ID: "db1"}
	if q := n.healthCheckQuery(); q != "SELECT 1" {
		t.Fatalf("expected default query 'SELECT 1', got %q", q)
	}
}

func TestDBNodeHealthCheckQueryCustom(t *testing.T) {
	n := &DBNode{ID: "db1", HealthCheckQuery: "SELECT version()"}
	if q := n.healthCheckQuery(); q != "SELECT version()" {
		t.Fatalf("expected custom query, got %q", q)
	}
}

// ---------------------------------------------------------------------------
// db_pool.go — fake driver
// ---------------------------------------------------------------------------

// fakeDriver is a minimal database/sql driver that succeeds on Open and
// returns a single column with value 1 for any query.
type fakeDriver struct{}
type fakeConn struct{}
type fakeStmt struct{}
type fakeRows struct{ done bool }

func (d fakeDriver) Open(_ string) (driver.Conn, error) { return fakeConn{}, nil }

func (c fakeConn) Prepare(query string) (driver.Stmt, error) { return fakeStmt{}, nil }
func (c fakeConn) Close() error                              { return nil }
func (c fakeConn) Begin() (driver.Tx, error)                 { return nil, fmt.Errorf("not supported") }

func (s fakeStmt) Close() error                                 { return nil }
func (s fakeStmt) NumInput() int                                { return 0 }
func (s fakeStmt) Exec(_ []driver.Value) (driver.Result, error) { return nil, nil }
func (s fakeStmt) Query(_ []driver.Value) (driver.Rows, error)  { return &fakeRows{}, nil }

func (r *fakeRows) Columns() []string { return []string{"?column?"} }
func (r *fakeRows) Close() error      { return nil }
func (r *fakeRows) Next(dest []driver.Value) error {
	if r.done {
		return fmt.Errorf("EOF")
	}
	r.done = true
	dest[0] = int64(1)
	return nil
}

func init() {
	sql.Register("fakedb", fakeDriver{})
}

// fakeOpen replaces sql.Open in DB pool tests.
func fakeOpen(driverName, dsn string) (*sql.DB, error) {
	return sql.Open("fakedb", dsn)
}

// ---------------------------------------------------------------------------
// db_pool.go tests
// ---------------------------------------------------------------------------

func TestNewDBPoolRequiresPrimary(t *testing.T) {
	_, err := NewDBPool([]*DBNode{
		makeDBNode("r1", DBRoleReplica),
	}, fakeOpen)
	if err == nil {
		t.Fatal("expected error when no primary node provided")
	}
}

func TestNewDBPoolRejectsMultiplePrimaries(t *testing.T) {
	_, err := NewDBPool([]*DBNode{
		makeDBNode("p1", DBRolePrimary),
		makeDBNode("p2", DBRolePrimary),
	}, fakeOpen)
	if err == nil {
		t.Fatal("expected error for duplicate primary nodes")
	}
}

func TestNewDBPoolRejectsUnknownRole(t *testing.T) {
	n := makeDBNode("bad", "")
	n.Role = DBRole("unknown-role")
	_, err := NewDBPool([]*DBNode{n}, fakeOpen)
	if err == nil {
		t.Fatal("expected error for unknown DB role")
	}
}

func TestDBPoolPrimaryReturnsPrimary(t *testing.T) {
	pool, err := NewDBPool([]*DBNode{makeDBNode("p", DBRolePrimary)}, fakeOpen)
	if err != nil {
		t.Fatalf("NewDBPool: %v", err)
	}
	defer pool.Close()

	db, err := pool.Primary()
	if err != nil {
		t.Fatalf("Primary(): %v", err)
	}
	if db == nil {
		t.Fatal("Primary() returned nil")
	}
}

func TestDBPoolPrimaryErrorsWhenUnhealthy(t *testing.T) {
	n := makeDBNode("p", DBRolePrimary)
	n.status = NodeStatusUnhealthy

	pool, err := NewDBPool([]*DBNode{n}, fakeOpen)
	if err != nil {
		t.Fatalf("NewDBPool: %v", err)
	}
	defer pool.Close()

	_, err = pool.Primary()
	if err == nil {
		t.Fatal("expected error when primary is unhealthy")
	}
}

func TestDBPoolReplicaFallsBackToPrimaryWhenNoReplicas(t *testing.T) {
	pool, err := NewDBPool([]*DBNode{makeDBNode("p", DBRolePrimary)}, fakeOpen)
	if err != nil {
		t.Fatalf("NewDBPool: %v", err)
	}
	defer pool.Close()

	// No replicas registered — Replica() must fall back to primary.
	db, err := pool.Replica()
	if err != nil {
		t.Fatalf("Replica() fallback to primary failed: %v", err)
	}
	if db == nil {
		t.Fatal("Replica() returned nil")
	}
}

func TestDBPoolReplicaFallsBackToPrimaryWhenAllUnhealthy(t *testing.T) {
	r := makeDBNode("r1", DBRoleReplica)
	r.status = NodeStatusUnhealthy

	pool, err := NewDBPool([]*DBNode{
		makeDBNode("p", DBRolePrimary),
		r,
	}, fakeOpen)
	if err != nil {
		t.Fatalf("NewDBPool: %v", err)
	}
	defer pool.Close()

	db, err := pool.Replica()
	if err != nil {
		t.Fatalf("Replica() fallback to primary failed: %v", err)
	}
	if db == nil {
		t.Fatal("Replica() returned nil")
	}
}

func TestDBPoolReplicaRoundRobin(t *testing.T) {
	pool, err := NewDBPool([]*DBNode{
		makeDBNode("p", DBRolePrimary),
		makeDBNode("r1", DBRoleReplica),
		makeDBNode("r2", DBRoleReplica),
	}, fakeOpen)
	if err != nil {
		t.Fatalf("NewDBPool: %v", err)
	}
	defer pool.Close()

	// With 2 replicas, 4 calls should alternate between them.
	seen := map[*sql.DB]int{}
	for i := 0; i < 4; i++ {
		db, err := pool.Replica()
		if err != nil {
			t.Fatalf("Replica() call %d: %v", i, err)
		}
		seen[db]++
	}
	if len(seen) != 2 {
		t.Fatalf("expected 2 distinct replica connections, got %d", len(seen))
	}
}

func TestDBPoolNodes(t *testing.T) {
	pool, err := NewDBPool([]*DBNode{
		makeDBNode("p", DBRolePrimary),
		makeDBNode("r1", DBRoleReplica),
	}, fakeOpen)
	if err != nil {
		t.Fatalf("NewDBPool: %v", err)
	}
	defer pool.Close()

	nodes := pool.Nodes()
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
}

// ---------------------------------------------------------------------------
// health_checker.go
// ---------------------------------------------------------------------------

func TestHealthCheckerDefaultConfig(t *testing.T) {
	cfg := HealthCheckerConfig{}
	resolved := cfg.withDefaults()

	if resolved.Interval != 10*time.Second {
		t.Fatalf("default Interval should be 10s, got %v", resolved.Interval)
	}
	if resolved.Timeout != 3*time.Second {
		t.Fatalf("default Timeout should be 3s, got %v", resolved.Timeout)
	}
	if resolved.HealthPath != "/system/ready" {
		t.Fatalf("default HealthPath should be /system/ready, got %q", resolved.HealthPath)
	}
	if resolved.UnhealthyThreshold != 2 {
		t.Fatalf("default UnhealthyThreshold should be 2, got %d", resolved.UnhealthyThreshold)
	}
}

func TestHealthCheckerMarksAppNodeHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n := &AppNode{ID: "n1", Address: srv.URL, status: NodeStatusUnknown}
	hc := NewHealthChecker(HealthCheckerConfig{
		Interval: time.Hour, // long so only the immediate probe runs
		Timeout:  2 * time.Second,
	}, []*AppNode{n}, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hc.Start(ctx)

	// Wait for the immediate probe.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if n.Status() == NodeStatusHealthy {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("app node not marked healthy after 3s; status=%q", n.Status())
}

func TestHealthCheckerMarksAppNodeUnhealthy(t *testing.T) {
	// Server always returns 500.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	n := &AppNode{ID: "n1", Address: srv.URL, status: NodeStatusUnknown}
	hc := NewHealthChecker(HealthCheckerConfig{
		Interval:           50 * time.Millisecond,
		Timeout:            2 * time.Second,
		UnhealthyThreshold: 1,
	}, []*AppNode{n}, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hc.Start(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if n.Status() == NodeStatusUnhealthy {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("app node not marked unhealthy after 3s; status=%q", n.Status())
}

func TestHealthCheckerMarksDBNodeHealthy(t *testing.T) {
	n := &DBNode{ID: "db1", DSN: "fake", Role: DBRolePrimary, status: NodeStatusUnknown}
	hc := NewHealthChecker(HealthCheckerConfig{
		Interval: time.Hour,
		Timeout:  2 * time.Second,
	}, nil, []*DBNode{n}, fakeOpen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hc.Start(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if n.Status() == NodeStatusHealthy {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("db node not marked healthy after 3s; status=%q", n.Status())
}

func TestHealthCheckerMarksDBNodeUnhealthy(t *testing.T) {
	// openFn that always errors.
	failOpen := func(_, _ string) (*sql.DB, error) {
		return nil, fmt.Errorf("connection refused")
	}

	n := &DBNode{ID: "db1", DSN: "bad", Role: DBRolePrimary, status: NodeStatusUnknown}
	hc := NewHealthChecker(HealthCheckerConfig{
		Interval: 50 * time.Millisecond,
		Timeout:  2 * time.Second,
	}, nil, []*DBNode{n}, failOpen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hc.Start(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if n.Status() == NodeStatusUnhealthy {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("db node not marked unhealthy after 3s; status=%q", n.Status())
}

func TestHealthCheckerStartIsIdempotent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n := &AppNode{ID: "n1", Address: srv.URL, status: NodeStatusUnknown}
	hc := NewHealthChecker(HealthCheckerConfig{Interval: time.Hour}, []*AppNode{n}, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Calling Start twice must not panic or launch duplicate goroutines.
	hc.Start(ctx)
	hc.Start(ctx)
}

func TestNewHealthCheckerNilOpenFnDefaultsToSqlOpen(t *testing.T) {
	hc := NewHealthChecker(HealthCheckerConfig{}, nil, nil, nil)
	if hc.openFn == nil {
		t.Fatal("openFn should default to sql.Open, not nil")
	}
}

// ---------------------------------------------------------------------------
// Integration: load balancer + health checker cooperate
// ---------------------------------------------------------------------------

func TestLoadBalancerHealthCheckerIntegration(t *testing.T) {
	// One healthy server, one that always returns 500.
	goodSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer goodSrv.Close()

	badSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer badSrv.Close()

	good := makeAppNode("good", goodSrv.URL, 1)
	bad := makeAppNode("bad", badSrv.URL, 1)
	good.status = NodeStatusUnknown
	bad.status = NodeStatusUnknown

	lb, err := NewLoadBalancer([]*AppNode{good, bad})
	if err != nil {
		t.Fatalf("NewLoadBalancer: %v", err)
	}

	hc := NewHealthChecker(HealthCheckerConfig{
		Interval:           50 * time.Millisecond,
		Timeout:            2 * time.Second,
		UnhealthyThreshold: 1,
		HealthPath:         "/",
	}, []*AppNode{good, bad}, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hc.Start(ctx)

	// Wait for health checker to settle.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if good.Status() == NodeStatusHealthy && bad.Status() == NodeStatusUnhealthy {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if good.Status() != NodeStatusHealthy {
		t.Fatalf("good node should be healthy, got %q", good.Status())
	}
	if bad.Status() != NodeStatusUnhealthy {
		t.Fatalf("bad node should be unhealthy, got %q", bad.Status())
	}

	// Load balancer should now route all traffic to the good node.
	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		lb.ServeHTTP(rec, req)
		if rec.Code == http.StatusServiceUnavailable {
			t.Fatalf("request %d returned 503 — no healthy nodes selected", i)
		}
		// Verify the body does not contain the bad node's 500 (proxied as 502).
		body := rec.Body.String()
		if strings.Contains(body, "bad gateway") {
			t.Fatalf("request %d routed to unhealthy node (502 body)", i)
		}
	}
}
