// main.go
// Runs the read-only runtime privilege audit for an explicitly selected database.
// Uses PostgreSQL's PG* connection environment and Filterest's DB_*_USER names.
// Refuses writable identities and prints only metadata findings, never secrets.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"time"

	"easelect/backend/core_components/runtime_grants"
	_ "github.com/lib/pq"
)

func main() {
	timeout := flag.Duration("timeout", 30*time.Second, "maximum time for the read-only audit")
	flag.Parse()
	if flag.NArg() != 0 || *timeout <= 0 {
		fmt.Fprintln(os.Stderr, "blocker: invalid audit options")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	// The driver reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSFILE and PGSSLMODE.
	// No connection string or password is accepted as a command-line argument.
	database, err := sql.Open("postgres", "")
	if err != nil {
		fmt.Fprintln(os.Stderr, "blocker: open audit connection failed")
		os.Exit(1)
	}
	defer database.Close()
	findings, err := runtime_grants.AuditRuntimeGrants(ctx, database, runtime_grants.ConfiguredRoles(os.Getenv))
	if err != nil {
		_ = runtime_grants.WriteFindings(os.Stderr, []runtime_grants.Finding{{Role: "audit", Finding: "blocker", Reason: err.Error()}})
		os.Exit(1)
	}
	if err := runtime_grants.WriteFindings(os.Stdout, findings); err != nil {
		fmt.Fprintln(os.Stderr, "blocker: audit output failed")
		os.Exit(1)
	}
	if runtime_grants.HasBlockers(findings) {
		os.Exit(2)
	}
}
