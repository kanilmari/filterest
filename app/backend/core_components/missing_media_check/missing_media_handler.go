// missing_media_handler.go
// Serves the administrator view of the missing-media check and starts it on demand.
// Between the media maintenance administration screen and the check's settings, runner and result.
// Exists so an administrator can read the last answer, change every setting within its range
// and ask for a fresh run from the same screen that already repairs media folders.
package missing_media_check

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

// statusResponse is what the administration screen renders. Limits and
// SamplingMethods come from the same table Sanitize uses, so the screen offers only
// values the check keeps. SettingsProblem is set when the stored value cannot be
// read: Settings then holds the defaults, shown for saving, and the check does not run.
type statusResponse struct {
	Settings        Settings                `json:"settings"`
	SettingsProblem string                  `json:"settings_problem,omitempty"`
	Limits          map[string]SettingLimit `json:"limits"`
	SamplingMethods []string                `json:"sampling_methods"`
	Running         bool                    `json:"running"`
	HasResult       bool                    `json:"has_result"`
	LastResult      *Result                 `json:"last_result"`
}

type commandRequest struct {
	Action   string    `json:"action"`
	Settings *Settings `json:"settings"`
}

// Actions the administration screen may ask for.
const (
	actionRun          = "run"
	actionSaveSettings = "save_settings"
)

// AdminMissingMediaCheckHandler reads the current state (GET) and runs or
// reconfigures the check (POST). It never repairs or deletes anything.
func AdminMissingMediaCheckHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		respondWithStatus(w, r)
	case http.MethodPost:
		handleCommand(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// loadSettingsForScreen reads the settings the screen shows. An unreadable stored
// value is not a server failure: it answers with the defaults and names the problem.
func loadSettingsForScreen(ctx context.Context) (Settings, string, error) {
	settings, err := LoadSettings(ctx, backend.Db)
	if errors.Is(err, ErrSettingsProblem) {
		log.Printf("\033[31merror: [MEDIA CHECK] %v; showing the defaults\033[0m", err)
		return settings, err.Error(), nil
	}
	return settings, "", err
}

func respondWithStatus(w http.ResponseWriter, r *http.Request) {
	settings, problem, err := loadSettingsForScreen(r.Context())
	if err != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] reading settings failed: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "missing media check settings unavailable")
		return
	}
	response := statusResponse{
		Settings:        settings,
		SettingsProblem: problem,
		Limits:          SettingLimits(),
		SamplingMethods: SamplingMethods(),
		Running:         IsRunning(),
	}
	lastResult, hasResult, resultErr := LoadLastResult(r.Context(), backend.Db)
	if resultErr != nil {
		log.Printf("\033[31merror: [MEDIA CHECK] reading the stored result failed: %v\033[0m", resultErr)
	} else if hasResult {
		response.HasResult = true
		response.LastResult = &lastResult
	}
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithJSON(w, http.StatusOK, response)
}

func handleCommand(w http.ResponseWriter, r *http.Request) {
	request, err := decodeCommandRequest(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid missing media check request")
		return
	}

	switch request.Action {
	case actionSaveSettings:
		if request.Settings == nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "settings missing from request")
			return
		}
		if _, saveErr := SaveSettings(r.Context(), backend.Db, *request.Settings); saveErr != nil {
			log.Printf("\033[31merror: [MEDIA CHECK] saving settings failed: %v\033[0m", saveErr)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "saving missing media check settings failed")
			return
		}
		respondWithStatus(w, r)
	case actionRun:
		started, reason := StartRun(TriggerManual)
		if !started && reason == notStartedSettingsUnavailable {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "missing media check settings unavailable")
			return
		}
		settings, problem, settingsErr := loadSettingsForScreen(r.Context())
		if settingsErr != nil {
			log.Printf("\033[31merror: [MEDIA CHECK] reading settings failed: %v\033[0m", settingsErr)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "missing media check settings unavailable")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"started":          started,
			"reason":           reason,
			"running":          IsRunning(),
			"settings":         settings,
			"settings_problem": problem,
		})
	default:
		httpresponse.RespondWithError(w, http.StatusBadRequest, "unknown missing media check action")
	}
}

func decodeCommandRequest(w http.ResponseWriter, r *http.Request) (commandRequest, error) {
	request := commandRequest{}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request must contain one JSON value")
	}
	return request, nil
}
