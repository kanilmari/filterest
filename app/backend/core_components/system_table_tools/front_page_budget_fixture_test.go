// front_page_budget_fixture_test.go
// Caps Home budget proofs independently of their SQL and request goroutines.
// Connects a per-test deadline to disposable PostgreSQL shutdown and cleanup.
// A stalled query or rollback must release every fixture lock before package timeout.
package system_table_tools

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func frontPageBudgetContext(t *testing.T) context.Context {
	t.Helper()
	// Includes initdb, bootstrap and all requests; shutdown has a separate 2 s cap.
	// t.Context is cancelled before Cleanup runs; keep the watchdog alive until
	// the fixture has actually stopped, including connection cleanup on failures.
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func frontPageWatchPostgres(t *testing.T, ctx context.Context, bin, data string) {
	t.Helper()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			// Never use the expired test context or a possibly blocked SQL connection.
			// Immediate shutdown terminates all fixture backends and releases all locks.
			shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			command := exec.CommandContext(shutdown, filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-t", "2", "-w", "stop")
			command.WaitDelay = time.Second
			if out, err := command.CombinedOutput(); err != nil {
				t.Errorf("stop fixture: %v %s", err, out)
			}
		})
	}
	done := make(chan struct{})
	disarm := context.AfterFunc(ctx, func() {
		defer close(done)
		t.Errorf("Home budget PostgreSQL proof exceeded its test deadline: %v", ctx.Err())
		stop()
	})
	t.Cleanup(func() {
		// Keep the watchdog armed while earlier cleanup closes SQL connections.
		stop()
		if !disarm() {
			<-done
		}
	})
}

// Exercise the watchdog without PostgreSQL: the child test waits until the
// independent callback invokes pg_ctl. Deadline expiry must fail that child;
// ordinary cleanup must stop the fixture once without reporting a timeout.
func TestFrontPageBudgetFixtureWatchdog(t *testing.T) {
	const modeKey = "FILTEREST_TEST_HOME_WATCHDOG_MODE"
	const fixtureKey = "FILTEREST_TEST_HOME_WATCHDOG_FIXTURE"
	if mode := os.Getenv(modeKey); mode != "" {
		fixture := os.Getenv(fixtureKey)
		ctx := context.Background()
		if mode == "deadline" {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, 30*time.Millisecond)
			defer cancel()
		}
		frontPageWatchPostgres(t, ctx, fixture, "unused")
		if mode == "deadline" {
			until := time.Now().Add(time.Second)
			for {
				if _, err := os.Stat(filepath.Join(fixture, "stopped")); err == nil {
					break
				}
				if time.Now().After(until) {
					t.Fatal("independent watchdog never stopped the fixture")
				}
				time.Sleep(time.Millisecond)
			}
		}
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"cleanup", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			fixture := t.TempDir()
			fakeControl := "#!/bin/sh\nprintf 'stopped\\n' >> \"$" + fixtureKey + "/stopped\"\n"
			if err := os.WriteFile(filepath.Join(fixture, "pg_ctl"), []byte(fakeControl), 0700); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, executable, "-test.run=^TestFrontPageBudgetFixtureWatchdog$")
			command.Env = append(os.Environ(), modeKey+"="+mode, fixtureKey+"="+fixture)
			out, err := command.CombinedOutput()
			if ctx.Err() != nil || (err != nil) != (mode == "deadline") || (mode == "deadline" && !strings.Contains(string(out), "proof exceeded its test deadline")) {
				t.Fatalf("watchdog did not terminate/report correctly: %v %v %s", ctx.Err(), err, out)
			}
			stops, err := os.ReadFile(filepath.Join(fixture, "stopped"))
			if err != nil || string(stops) != "stopped\n" {
				t.Fatalf("fixture was not stopped exactly once: %q %v", stops, err)
			}
		})
	}
}
