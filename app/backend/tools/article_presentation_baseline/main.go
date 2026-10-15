// main.go
// Exports the K388 before-list from one explicitly selected database copy.
// Connects PostgreSQL's enforced read-only snapshot to a deterministic JSON report.
// Never loads installation credentials, starts Filterest or runs migrations.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"github.com/lib/pq"
)

func main() {
	dsnEnv := flag.String("dsn-env", "FILTEREST_BASELINE_DSN", "environment variable containing the explicitly selected database-copy DSN")
	timeout := flag.Duration("timeout", 5*time.Minute, "maximum duration of the complete read-only snapshot")
	flag.Parse()
	if flag.NArg() != 0 || *timeout <= 0 {
		fmt.Fprintln(os.Stderr, "error: expected --dsn-env NAME and a positive --timeout")
		os.Exit(2)
	}
	dsn := os.Getenv(*dsnEnv)
	if strings.TrimSpace(dsn) == "" {
		fmt.Fprintln(os.Stderr, "error: the selected DSN environment variable is empty")
		os.Exit(2)
	}
	if err := run(dsn, *timeout); err != nil {
		var postgresError *pq.Error
		if errors.As(err, &postgresError) {
			fmt.Fprintf(os.Stderr, "error: baseline not completed: PostgreSQL %s: %s\n", postgresError.Code, postgresError.Message)
		} else {
			fmt.Fprintln(os.Stderr, "error: baseline not completed (database read or JSON output failed)")
		}
		os.Exit(1)
	}
}
func run(dsn string, timeout time.Duration) error {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	report, err := read.ReadArticlePresentationBaseline(ctx, db)
	if err != nil {
		// lib/pq errors do not contain the DSN; preserve useful schema/query
		// diagnostics without printing the supplied connection credentials.
		return fmt.Errorf("read baseline: %w", err)
	}
	return read.WriteArticlePresentationBaseline(os.Stdout, report)
}
