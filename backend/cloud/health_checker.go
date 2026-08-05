// health_checker.go
// Implements a periodic health checker that probes registered AppNodes and
// DBNodes and updates their status accordingly.
// Bridges the node registry and the load balancer / DB pool: status changes
// here are immediately visible to both routing components because they share
// the same node pointers.
// Exists to provide automatic failure detection and recovery for all nodes in
// the cloud layer without requiring the calling application to manage it.
package cloud

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// HealthCheckerConfig holds tuning parameters for the HealthChecker.
type HealthCheckerConfig struct {
	// Interval is how often each node is probed.  Default: 10 seconds.
	Interval time.Duration
	// Timeout is the per-probe deadline.  Default: 3 seconds.
	Timeout time.Duration
	// HealthPath is the HTTP path used to probe AppNodes.  Default: "/system/ready".
	HealthPath string
	// Transport optionally overrides HTTP transport for app health probes.
	Transport http.RoundTripper
	// UnhealthyThreshold is the number of consecutive failures before a node
	// is marked unhealthy.  Default: 2.
	UnhealthyThreshold int
}

func (c *HealthCheckerConfig) withDefaults() HealthCheckerConfig {
	out := *c
	if out.Interval <= 0 {
		out.Interval = 10 * time.Second
	}
	if out.Timeout <= 0 {
		out.Timeout = 3 * time.Second
	}
	if out.HealthPath == "" {
		out.HealthPath = "/system/ready"
	}
	if out.UnhealthyThreshold <= 0 {
		out.UnhealthyThreshold = 2
	}
	return out
}

// HealthChecker concurrently probes AppNodes and DBNodes on a fixed interval
// and updates their NodeStatus.
//
// Usage:
//
//	hc := NewHealthChecker(cfg, appNodes, dbNodes, dbOpenFn)
//	ctx, cancel := context.WithCancel(context.Background())
//	hc.Start(ctx)
//	// ... serve traffic ...
//	cancel() // stop health checker
type HealthChecker struct {
	cfg      HealthCheckerConfig
	appNodes []*AppNode
	dbNodes  []*DBNode
	openFn   OpenFunc // used to open short-lived DB connections for DB checks
	client   *http.Client
	once     sync.Once
}

// NewHealthChecker creates a HealthChecker.
//
//   - cfg controls timing and thresholds; zero values are replaced with defaults.
//   - appNodes is the slice of HTTP backend nodes to probe (may be nil).
//   - dbNodes is the slice of database nodes to probe (may be nil).
//   - openFn is called to open a fresh *sql.DB for each DB health check;
//     if nil, sql.Open is used.
func NewHealthChecker(cfg HealthCheckerConfig, appNodes []*AppNode, dbNodes []*DBNode, openFn OpenFunc) *HealthChecker {
	if openFn == nil {
		openFn = sql.Open
	}
	resolved := cfg.withDefaults()
	client := &http.Client{
		Timeout: resolved.Timeout,
	}
	if resolved.Transport != nil {
		client.Transport = resolved.Transport
	}
	return &HealthChecker{
		cfg:      resolved,
		appNodes: appNodes,
		dbNodes:  dbNodes,
		openFn:   openFn,
		client:   client,
	}
}

// Start launches background goroutines that probe nodes every cfg.Interval.
// It is idempotent: calling Start more than once has no additional effect.
// Goroutines stop when ctx is cancelled.
func (hc *HealthChecker) Start(ctx context.Context) {
	hc.once.Do(func() {
		for _, n := range hc.appNodes {
			go hc.runAppLoop(ctx, n)
		}
		for _, n := range hc.dbNodes {
			go hc.runDBLoop(ctx, n)
		}
	})
}

// runAppLoop probes a single AppNode on the configured interval until ctx is
// cancelled.
func (hc *HealthChecker) runAppLoop(ctx context.Context, n *AppNode) {
	ticker := time.NewTicker(hc.cfg.Interval)
	defer ticker.Stop()

	// Probe immediately so the first result is available before the first tick.
	hc.checkApp(ctx, n)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hc.checkApp(ctx, n)
		}
	}
}

// runDBLoop probes a single DBNode on the configured interval until ctx is
// cancelled.
func (hc *HealthChecker) runDBLoop(ctx context.Context, n *DBNode) {
	ticker := time.NewTicker(hc.cfg.Interval)
	defer ticker.Stop()

	// Probe immediately.
	hc.checkDB(ctx, n)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hc.checkDB(ctx, n)
		}
	}
}

// checkApp performs a single HTTP probe against an AppNode.
// It marks the node healthy on 2xx, unhealthy otherwise.
// Consecutive-failure tracking is done inside AppNode.setStatus.
func (hc *HealthChecker) checkApp(ctx context.Context, n *AppNode) {
	probeURL := n.Address + hc.cfg.HealthPath

	reqCtx, cancel := context.WithTimeout(ctx, hc.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, probeURL, nil)
	if err != nil {
		hc.recordAppFailure(n, fmt.Errorf("build request: %w", err))
		return
	}

	resp, err := hc.client.Do(req)
	if err != nil {
		hc.recordAppFailure(n, err)
		return
	}
	_ = resp.Body.Close()

	now := time.Now()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		prev := n.Status()
		n.setStatus(NodeStatusHealthy, now)
		if prev != NodeStatusHealthy {
			slog.Info("health_checker: app node recovered",
				slog.String("node", n.ID),
				slog.String("address", n.Address),
			)
		}
		return
	}

	hc.recordAppFailure(n, fmt.Errorf("HTTP %d", resp.StatusCode))
}

// recordAppFailure updates failure bookkeeping and transitions the node to
// unhealthy once the threshold is exceeded.
func (hc *HealthChecker) recordAppFailure(n *AppNode, err error) {
	now := time.Now()
	n.setStatus(NodeStatusUnhealthy, now)

	if n.consecutiveFail >= hc.cfg.UnhealthyThreshold {
		slog.Warn("health_checker: app node unhealthy",
			slog.String("node", n.ID),
			slog.String("address", n.Address),
			slog.Int("consecutive_failures", n.consecutiveFail),
			slog.Any("error", err),
		)
	} else {
		slog.Debug("health_checker: app node probe failed (below threshold)",
			slog.String("node", n.ID),
			slog.Int("consecutive_failures", n.consecutiveFail),
			slog.Any("error", err),
		)
	}
}

// checkDB performs a single database probe against a DBNode by opening a
// short-lived connection and executing the node's health-check query.
func (hc *HealthChecker) checkDB(ctx context.Context, n *DBNode) {
	db, err := hc.openFn("postgres", n.DSN)
	if err != nil {
		hc.recordDBFailure(n, fmt.Errorf("open: %w", err))
		return
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			slog.Debug("health_checker: error closing probe connection",
				slog.String("node", n.ID),
				slog.Any("error", closeErr),
			)
		}
	}()

	probeCtx, cancel := context.WithTimeout(ctx, hc.cfg.Timeout)
	defer cancel()

	row := db.QueryRowContext(probeCtx, n.healthCheckQuery())
	var dummy int
	if err := row.Scan(&dummy); err != nil {
		hc.recordDBFailure(n, fmt.Errorf("query: %w", err))
		return
	}

	now := time.Now()
	prev := n.Status()
	n.setStatus(NodeStatusHealthy, now)
	if prev != NodeStatusHealthy {
		slog.Info("health_checker: db node recovered",
			slog.String("node", n.ID),
			slog.String("role", string(n.Role)),
		)
	}
}

// recordDBFailure marks the node unhealthy and logs the failure.
func (hc *HealthChecker) recordDBFailure(n *DBNode, err error) {
	n.setStatus(NodeStatusUnhealthy, time.Now())
	slog.Warn("health_checker: db node unhealthy",
		slog.String("node", n.ID),
		slog.String("role", string(n.Role)),
		slog.Any("error", err),
	)
}
