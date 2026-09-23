// missing_media_runner.go
// Starts the missing-media check in the background and lets only one run exist at a time.
// Between the startup maintenance goroutine, the administration screen and the scan itself.
// Exists so the check never blocks startup, never runs twice at once, and always stores
// the answer where the next administrator can read it.
package missing_media_check

import (
	"context"
	"log"
	"sync"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

var runnerState struct {
	mutex   sync.Mutex
	running bool
}

// RunAllowed reports whether a run with this trigger may start at all.
// A disabled check does nothing, including at startup; that is the whole point
// of the setting, so the decision lives in one place both callers use.
func RunAllowed(settings Settings, trigger string) bool {
	if !settings.Enabled {
		return false
	}
	if trigger == TriggerStartup {
		return settings.RunOnStartup
	}
	return true
}

// IsRunning reports whether a check is in progress right now.
func IsRunning() bool {
	runnerState.mutex.Lock()
	defer runnerState.mutex.Unlock()
	return runnerState.running
}

func claimRun() bool {
	runnerState.mutex.Lock()
	defer runnerState.mutex.Unlock()
	if runnerState.running {
		return false
	}
	runnerState.running = true
	return true
}

func releaseRun() {
	runnerState.mutex.Lock()
	runnerState.running = false
	runnerState.mutex.Unlock()
}

// StartRun begins one background check and returns immediately.
// It reports started=false when the check is switched off or already running, so
// the administration screen can say which of the two happened.
func StartRun(trigger string) (started bool, reason string) {
	settings, err := LoadSettings(context.Background(), backend.Db)
	if err != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] settings unavailable: %v\033[0m", err)
		return false, "settings_unavailable"
	}
	if !RunAllowed(settings, trigger) {
		return false, "disabled"
	}
	if !claimRun() {
		return false, "already_running"
	}
	go func() {
		defer releaseRun()
		runAndStore(settings, trigger)
	}()
	return true, ""
}

// StartStartupRun is the background startup task. It waits for the configured
// delay first so the rest of startup maintenance finishes before disk scanning.
func StartStartupRun() {
	go func() {
		settings, err := LoadSettings(context.Background(), backend.Db)
		if err != nil {
			log.Printf("\033[31merror: [MEDIA CHECK] settings unavailable at startup: %v\033[0m", err)
			return
		}
		if !RunAllowed(settings, TriggerStartup) {
			log.Println("[MEDIA CHECK] Missing media files check is switched off; skipping startup run.")
			return
		}
		if settings.StartupDelaySeconds > 0 {
			time.Sleep(time.Duration(settings.StartupDelaySeconds) * time.Second)
		}
		if !claimRun() {
			return
		}
		defer releaseRun()
		runAndStore(settings, TriggerStartup)
	}()
}

func runAndStore(settings Settings, trigger string) {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		time.Duration(settings.MaxRunSeconds+30)*time.Second,
	)
	defer cancel()

	result, err := Run(ctx, CheckInput{
		Database:    backend.Db,
		StorageRoot: runtimepaths.Current().StorageRoot,
		Settings:    settings,
		Trigger:     trigger,
	})
	if err != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] missing media files check failed: %v\033[0m", err)
		return
	}
	if saveErr := SaveLastResult(ctx, backend.Db, result); saveErr != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] storing the result failed: %v\033[0m", saveErr)
	}
	log.Printf(
		"[MEDIA CHECK] Checked %d row(s) in %d dataset(s); %d missing file(s)%s",
		result.RowsChecked,
		result.DatasetsChecked,
		result.MissingCount,
		budgetNotice(result),
	)
}

func budgetNotice(result Result) string {
	switch {
	case result.DatasetsExceedBudget:
		return " (more datasets than the row budget; some datasets were not reached)"
	case result.TimeBudgetReached:
		return " (stopped on the time budget)"
	case result.RowBudgetReached:
		return " (stopped on the row budget; a sample was checked)"
	default:
		return ""
	}
}
