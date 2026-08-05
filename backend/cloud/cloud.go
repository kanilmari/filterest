// cloud.go
// Package cloud implements a standalone cloud layer for Easelect that
// distributes HTTP traffic across multiple application servers and database
// connections across primary/replica PostgreSQL nodes.
//
// The package is intentionally self-contained and does NOT import any other
// easelect package.  It is wired up by the caller (main.go or a dedicated
// cloud entry-point) and must not be connected to the existing application
// unless explicitly integrated in a future phase.
//
// Core components:
//
//	LoadBalancer  — active-primary or weighted HTTP reverse proxy over AppNodes.
//	DBPool        — read-replica-aware *sql.DB router over DBNodes.
//	HealthChecker — periodic prober that updates NodeStatus on all nodes.
//
// Quick-start:
//
//	appNodes := []*cloud.AppNode{
//	    {ID: "app-1", Address: "http://10.0.0.1:8082", DesiredState: cloud.AppDesiredStateActive},
//	    {ID: "app-2", Address: "http://10.0.0.2:8082", DesiredState: cloud.AppDesiredStateStandby},
//	}
//	dbNodes := []*cloud.DBNode{
//	    {ID: "db-primary",   DSN: "host=db1 ...", Role: cloud.DBRolePrimary},
//	    {ID: "db-replica-1", DSN: "host=db2 ...", Role: cloud.DBRoleReplica},
//	}
//
//	lb, _ := cloud.NewLoadBalancerWithConfig(appNodes, cloud.LoadBalancerConfig{
//	    RoutingPolicy: cloud.RoutingPolicyActivePrimary,
//	})
//	pool, _ := cloud.NewDBPool(dbNodes, nil)
//
//	hc := cloud.NewHealthChecker(cloud.HealthCheckerConfig{}, appNodes, dbNodes, nil)
//	hc.Start(ctx)
//
//	http.ListenAndServe(":80", lb)
package cloud
