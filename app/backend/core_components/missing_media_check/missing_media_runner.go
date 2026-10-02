// missing_media_runner.go
// Starts the missing-media check in the background and lets only one run exist at a time.
// Between the startup maintenance goroutine, the administration screen and the scan itself.
// Exists so the check never blocks startup, never runs twice at once, runs by itself after
// an update, and always stores the answer, even a failed one, where an administrator can read it.
package missing_media_check

import (
	"context"
	"errors"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"
)

// resultSaveTimeout bounds storing a result. It is a fresh deadline of its own, because
// a run that used all of its time must still leave its answer behind.
const resultSaveTimeout = 15 * time.Second

// settingsReadTimeout bounds reading the settings before a run starts.
const settingsReadTimeout = 15 * time.Second

// Reasons StartRun gives for not starting, kept stable for the administration screen.
const (
	notStartedDisabled            = "disabled"
	notStartedAlreadyRunning      = "already_running"
	notStartedSettingsUnavailable = "settings_unavailable"
	notStartedSettingsProblem     = "settings_problem"
)

// RunIdentity names the installation a run checks: the application and database
// versions an update changes, and the build as information only. Every native
// rebuild has a new build id without being an update, so the build never decides.
type RunIdentity struct {
	AppVersion string
	DBVersion  string
	BuildID    string
}

var runnerState struct {
	mutex    sync.Mutex
	running  bool
	identity RunIdentity
}

// runCheck is the scan runAndStore performs. Tests replace it to prove that a failed
// or crashed run is stored all the same.
var runCheck = Run

// RunAllowed reports whether a run with this trigger may start at all. A disabled
// check does nothing, on demand or automatically; each automatic trigger also has
// its own switch. StartRun and StartupTrigger both decide through this one function.
func RunAllowed(settings Settings, trigger string) bool {
	if !settings.Enabled {
		return false
	}
	switch trigger {
	case TriggerStartup:
		return settings.RunOnStartup
	case TriggerUpdate:
		return settings.RunAfterUpdate
	default:
		return true
	}
}

// StartupTrigger decides whether the start of the server runs the check, and as what.
// A check switched off never runs. After an update, which is an application or
// database version the last result did not check, or when no result exists, it runs
// as "update" if run_after_update allows; otherwise it runs as "startup" only if
// run_on_startup asks for every start. An empty answer means no run.
func StartupTrigger(settings Settings, last *Result, identity RunIdentity) string {
	if RunAllowed(settings, TriggerUpdate) && versionsChanged(last, identity) {
		return TriggerUpdate
	}
	if RunAllowed(settings, TriggerStartup) {
		return TriggerStartup
	}
	return ""
}

// versionsChanged reports whether this installation has not been checked yet. A
// version 1 result, which recorded no versions, counts as an older installation.
func versionsChanged(last *Result, identity RunIdentity) bool {
	if last == nil {
		return true
	}
	return last.AppVersion != identity.AppVersion || last.DBVersion != identity.DBVersion
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

func configureIdentity(identity RunIdentity) {
	runnerState.mutex.Lock()
	runnerState.identity = identity
	runnerState.mutex.Unlock()
}

func currentIdentity() RunIdentity {
	runnerState.mutex.Lock()
	defer runnerState.mutex.Unlock()
	return runnerState.identity
}

// StartRun begins one background check and returns immediately.
// It reports started=false with a reason when the check is switched off, already
// running, or its stored settings cannot be read, so the administration screen can
// say which of these happened.
func StartRun(trigger string) (started bool, reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), settingsReadTimeout)
	settings, err := LoadSettings(ctx, backend.Db)
	cancel()
	if errors.Is(err, ErrSettingsProblem) {
		log.Printf("\033[31merror: [MEDIA CHECK] not running the check: %v\033[0m", err)
		return false, notStartedSettingsProblem
	}
	if err != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] settings unavailable: %v\033[0m", err)
		return false, notStartedSettingsUnavailable
	}
	if !RunAllowed(settings, trigger) {
		return false, notStartedDisabled
	}
	if !claimRun() {
		return false, notStartedAlreadyRunning
	}
	identity := currentIdentity()
	go func() {
		defer releaseRun()
		runAndStore(settings, trigger, identity)
	}()
	return true, ""
}

// StartStartupRun is the background startup task. It records the installation the
// server runs as, decides with StartupTrigger whether this start runs the check,
// and waits for the configured delay first so the rest of startup maintenance
// finishes before disk scanning. The identity comes from startup, which already
// knows the versions; the check does not read version files of its own.
func StartStartupRun(identity RunIdentity) {
	configureIdentity(identity)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("\033[31merror: [MEDIA CHECK] the startup decision stopped unexpectedly: %v\n%s\033[0m", recovered, debug.Stack())
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), settingsReadTimeout)
		settings, err := LoadSettings(ctx, backend.Db)
		if err != nil {
			cancel()
			log.Printf("\033[31merror: [MEDIA CHECK] not running the check at startup: %v\033[0m", err)
			return
		}
		var last *Result
		stored, hasResult, resultErr := LoadLastResult(ctx, backend.Db)
		cancel()
		if resultErr != nil {
			// An unreadable result is treated as none, so the check writes a new one.
			log.Printf("\033[31merror: [MEDIA CHECK] reading the stored result failed: %v\033[0m", resultErr)
		} else if hasResult {
			last = &stored
		}
		trigger := StartupTrigger(settings, last, identity)
		if trigger == "" {
			if !settings.Enabled {
				log.Println("[MEDIA CHECK] Missing media files check is switched off; skipping it at this start.")
			} else {
				log.Println("[MEDIA CHECK] Missing media files check skipped at this start: no update since the last check, and it is not set to run at every start.")
			}
			return
		}
		if settings.StartupDelaySeconds > 0 {
			time.Sleep(time.Duration(settings.StartupDelaySeconds) * time.Second)
		}
		if !claimRun() {
			return
		}
		defer releaseRun()
		runAndStore(settings, trigger, identity)
	}()
}

// runAndStore runs one check and stores its result, also when the run fails or
// panics, so the administration screen always shows what the last attempt did.
func runAndStore(settings Settings, trigger string, identity RunIdentity) {
	startedAt := time.Now().UTC()
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("\033[31merror: [MEDIA CHECK] the missing media files check stopped unexpectedly: %v\n%s\033[0m", recovered, debug.Stack())
			input := CheckInput{Settings: settings.Sanitize(), Trigger: trigger, Identity: identity}
			crashed := newResult(input.Settings, input, startedAt)
			storeResult(markRunFailed(crashed, fmt.Errorf("the check stopped unexpectedly: %v", recovered), startedAt))
		}
	}()

	ctx, cancel := context.WithTimeout(
		context.Background(),
		time.Duration(settings.MaxRunSeconds+30)*time.Second,
	)
	defer cancel()

	result, err := runCheck(ctx, CheckInput{
		Database:    backend.Db,
		StorageRoot: runtimepaths.Current().StorageRoot,
		Settings:    settings,
		Trigger:     trigger,
		Identity:    identity,
	})
	if err != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] missing media files check failed: %v\033[0m", err)
		result = markRunFailed(result, err, startedAt)
	}
	storeResult(result)
	log.Printf(
		"[MEDIA CHECK] Checked %d row(s) in %d dataset(s); %d missing file(s)%s",
		result.RowsChecked,
		result.DatasetsChecked,
		result.MissingCount,
		budgetNotice(result),
	)
}

// markRunFailed turns what a run returned with its error into a failed result. A run
// that returned nothing at all still gets the fields an administrator reads.
func markRunFailed(result Result, err error, startedAt time.Time) Result {
	result.Failed = true
	if result.SchemaVersion == 0 {
		result.SchemaVersion = ResultSchemaVersion
	}
	if result.StartedAt == "" {
		result.StartedAt = startedAt.Format(time.RFC3339)
	}
	if result.FinishedAt == "" {
		finishResult(&result, time.Now().UTC(), startedAt)
	}
	result.Errors = append(result.Errors, err.Error())
	if result.MissingRows == nil {
		result.MissingRows = []MissingMediaRow{}
	}
	if result.UnusedFiles == nil {
		result.UnusedFiles = []string{}
	}
	if result.Datasets == nil {
		result.Datasets = []DatasetSummary{}
	}
	if result.UnreachedDatasets == nil {
		result.UnreachedDatasets = []UnreachedDataset{}
	}
	return result
}

func storeResult(result Result) {
	ctx, cancel := context.WithTimeout(context.Background(), resultSaveTimeout)
	defer cancel()
	if err := SaveLastResult(ctx, backend.Db, result); err != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] storing the result failed: %v\033[0m", err)
	}
}

func budgetNotice(result Result) string {
	switch {
	case result.Failed:
		return " (the run failed; the stored result lists why)"
	case result.DatasetsExceedBudget:
		return " (more datasets than the row budget; some datasets were not reached)"
	case result.TimeBudgetReached:
		return " (stopped on the time budget)"
	case result.RowBudgetReached:
		return " (stopped on the row budget; a sample was checked)"
	case len(result.UnreachedDatasets) > 0:
		return " (some datasets could not be reached; the stored result lists them)"
	default:
		return ""
	}
}
