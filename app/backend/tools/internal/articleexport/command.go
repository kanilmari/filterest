// command.go
// Runs explicitly selected BEFORE/AFTER exporters without installation setup.
// Connects command flags to the shared read-only snapshot and deterministic writer.
// Diagnostics are allowlisted so connection errors can never disclose the DSN.
package articleexport

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	_ "github.com/lib/pq"
)

// Run returns a process exit code; snapshot reading finishes before JSON is written.
func Run(args []string, out, diagnostics io.Writer, after bool) int {
	flags := flag.NewFlagSet("article presentation export", flag.ContinueOnError)
	// flag errors may echo supplied arguments. Never print untrusted flag text.
	flags.SetOutput(io.Discard)
	dsnEnv := flags.String("dsn-env", "", "required environment variable containing the chosen database DSN")
	timeout := flags.Duration("timeout", 5*time.Minute, "maximum snapshot duration")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *timeout <= 0 || strings.TrimSpace(*dsnEnv) == "" {
		fmt.Fprintln(diagnostics, "error: expected --dsn-env NAME and a positive --timeout")
		return 2
	}
	dsn := os.Getenv(*dsnEnv)
	if strings.TrimSpace(dsn) == "" {
		fmt.Fprintln(diagnostics, "error: the selected DSN environment variable is empty")
		return 2
	}
	db, err := sql.Open("postgres", dsn)
	if err == nil {
		defer db.Close()
		db.SetMaxOpenConns(1)
		ctx, cancel := context.WithTimeout(context.Background(), *timeout)
		defer cancel()
		var report read.ArticleBaselineReport
		if after {
			report, err = read.ReadArticlePresentationAfter(ctx, db)
		} else {
			report, err = read.ReadArticlePresentationBaseline(ctx, db)
		}
		if err == nil {
			err = read.WriteArticlePresentationBaseline(out, report)
		}
	}
	if err != nil {
		switch {
		case errors.Is(err, read.ErrArticleBaselineUpgraded):
			fmt.Fprintln(diagnostics, "error:", read.ErrArticleBaselineUpgraded)
		case errors.Is(err, read.ErrArticleAfterIncomplete):
			fmt.Fprintln(diagnostics, "error:", read.ErrArticleAfterIncomplete)
		default:
			fmt.Fprintln(diagnostics, "error: export not completed (database read or JSON output failed)")
		}
		return 1
	}
	return 0
}
