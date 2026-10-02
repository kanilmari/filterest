// missing_media_runner_test.go
// Verifies when the missing-media check runs by itself and what a failed run leaves behind.
// Between the stored settings and last result, the running installation's versions and the runner.
// Exists so an update is recognised by its versions and never by a rebuild, a switched-off check
// never runs, and a run that failed still tells the administrator why.
package missing_media_check

import (
	"errors"
	"testing"
	"time"
)

var installedIdentity = RunIdentity{AppVersion: "9.3.19", DBVersion: "9.9.2", BuildID: "build-a"}

func lastResultFor(identity RunIdentity) *Result {
	return &Result{SchemaVersion: ResultSchemaVersion, AppVersion: identity.AppVersion, DBVersion: identity.DBVersion, BuildID: identity.BuildID}
}

func TestRunAllowedRespectsTheOffSwitchAndEachTrigger(t *testing.T) {
	off := DefaultSettings()
	off.Enabled = false
	for _, trigger := range []string{TriggerStartup, TriggerUpdate, TriggerManual} {
		if RunAllowed(off, trigger) {
			t.Fatalf("a switched-off check must not run as %q", trigger)
		}
	}

	settings := DefaultSettings()
	settings.RunOnStartup = false
	settings.RunAfterUpdate = false
	if RunAllowed(settings, TriggerStartup) || RunAllowed(settings, TriggerUpdate) {
		t.Fatal("each automatic run must follow its own setting")
	}
	if !RunAllowed(settings, TriggerManual) {
		t.Fatal("an administrator can still start the check on demand")
	}
}

func TestStartupTriggerRunsOnceAfterAnUpdate(t *testing.T) {
	settings := DefaultSettings()
	cases := []struct {
		name string
		last *Result
		want string
	}{
		{name: "never ran", last: nil, want: TriggerUpdate},
		{name: "a first-shape result without versions", last: &Result{SchemaVersion: 1}, want: TriggerUpdate},
		{name: "new application version", last: lastResultFor(RunIdentity{AppVersion: "9.3.18", DBVersion: "9.9.2"}), want: TriggerUpdate},
		{name: "new database version", last: lastResultFor(RunIdentity{AppVersion: "9.3.19", DBVersion: "9.9.1"}), want: TriggerUpdate},
		{name: "same versions", last: lastResultFor(installedIdentity), want: ""},
		// A native development restart builds a new binary of the same version.
		{name: "a rebuild of the same versions", last: lastResultFor(RunIdentity{AppVersion: "9.3.19", DBVersion: "9.9.2", BuildID: "build-b"}), want: ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := StartupTrigger(settings, testCase.last, installedIdentity); got != testCase.want {
				t.Fatalf("StartupTrigger = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestStartupTriggerFollowsTheSettings(t *testing.T) {
	checked := lastResultFor(installedIdentity)

	everyStart := DefaultSettings()
	everyStart.RunOnStartup = true
	if got := StartupTrigger(everyStart, checked, installedIdentity); got != TriggerStartup {
		t.Fatalf("run_on_startup without an update = %q, want %q", got, TriggerStartup)
	}
	if got := StartupTrigger(everyStart, nil, installedIdentity); got != TriggerUpdate {
		t.Fatalf("an update is named as one even when every start runs = %q", got)
	}

	noUpdates := DefaultSettings()
	noUpdates.RunAfterUpdate = false
	if got := StartupTrigger(noUpdates, nil, installedIdentity); got != "" {
		t.Fatalf("run_after_update off and run_on_startup off = %q, want no run", got)
	}
	noUpdates.RunOnStartup = true
	if got := StartupTrigger(noUpdates, nil, installedIdentity); got != TriggerStartup {
		t.Fatalf("run_after_update off and run_on_startup on = %q, want %q", got, TriggerStartup)
	}

	off := everyStart
	off.Enabled = false
	if got := StartupTrigger(off, nil, installedIdentity); got != "" {
		t.Fatalf("a switched-off check = %q, want no run even after an update", got)
	}
}

func TestAFailedRunIsMarkedWithEverythingTheScreenReads(t *testing.T) {
	startedAt := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	failed := markRunFailed(Result{}, errors.New("list file upload relations: connection refused"), startedAt)
	if !failed.Failed || failed.SchemaVersion != ResultSchemaVersion {
		t.Fatalf("failed result = %+v, want it marked failed in the current schema", failed)
	}
	if failed.StartedAt != "2026-09-29T12:00:00Z" || failed.FinishedAt == "" {
		t.Fatalf("failed result times = %q..%q, want both set", failed.StartedAt, failed.FinishedAt)
	}
	if len(failed.Errors) != 1 || failed.Errors[0] != "list file upload relations: connection refused" {
		t.Fatalf("errors = %v, want the reason", failed.Errors)
	}
	if failed.MissingRows == nil || failed.UnusedFiles == nil || failed.Datasets == nil || failed.UnreachedDatasets == nil {
		t.Fatal("a failed result must still carry empty lists, never null, for the screen")
	}
}
