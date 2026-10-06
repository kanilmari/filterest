// lifecycle.go
// Recognizes request admission SQL for focused stub-driver tests.
// The real middleware still executes its lock and propagates every failure.
// Keeps business-query queues independent of lifecycle admission statements.
package granttest

import "database/sql/driver"

func IsRequestBarrier(query string, args []driver.NamedValue) bool {
	if query == `SET LOCAL lock_timeout = '5s'` {
		return len(args) == 0
	}
	return query == `SELECT pg_advisory_xact_lock_shared(hashtext($1))` &&
		len(args) == 1 && args[0].Value == "filterest.runtime_startup_barrier"
}
