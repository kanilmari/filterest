// filterbar_ai_coding_agent_policy.go
// Decides which coding-agent modes this site permits, separately from runner readiness.
// Bridges current system_config, the existing AdminProfile and the configured runner.
// Keeps code editing a development-only mode by a fixed rule no setting can widen.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

const codingAgentDevOnlyKey = "coding_agent_dev_only"

// The runner's job modes. Code work edits this machine's source checkout; the
// site assistant works only through the site's API with approval for writes.
const (
	codingAgentModeCodeWorkspace = "code_workspace"
	codingAgentModeSiteAssistant = "site_assistant"
)

type codingAgentModeAvailability struct {
	Mode  string `json:"mode"`
	Ready bool   `json:"ready"`
}

type codingAgentAvailability struct {
	FeatureEnabled         bool                          `json:"feature_enabled"`
	DevOnly                bool                          `json:"dev_only"`
	RunnerReady            bool                          `json:"runner_ready"`
	ReasonCode             string                        `json:"reason_code,omitempty"`
	AuthenticationVerified bool                          `json:"authentication_verified"`
	Modes                  []codingAgentModeAvailability `json:"modes"`
}

// codingAgentRunnerCapabilities is the runner's own readiness report.
type codingAgentRunnerCapabilities struct {
	RunnerReady            bool     `json:"runner_ready"`
	ReasonCode             string   `json:"reason_code"`
	AuthenticationVerified bool     `json:"authentication_verified"`
	Modes                  []string `json:"modes"`
	OfferedModes           []string `json:"offered_modes"`
}

var codingAgentPolicyReader = readCodingAgentDevOnly
var codingAgentSocketCall = callCodingAgentRunner

// readCodingAgentDevOnly defaults missing configuration to the restrictive policy.
// A malformed present value or read error never enables production execution.
func readCodingAgentDevOnly(ctx context.Context) (bool, error) {
	if backend.Db == nil {
		return true, nil
	}
	var value sql.NullBool
	err := backend.Db.QueryRowContext(ctx, "SELECT boolean_value FROM public.system_config WHERE key = $1", codingAgentDevOnlyKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	if !value.Valid {
		return true, errors.New("coding agent policy must be boolean")
	}
	return value.Bool, nil
}

func codingAgentIsDev() bool { return strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE")) == "dev" }

// codingAgentPermittedModes applies this site's policy. Code work is permitted
// only in development, as a fixed rule rather than a setting; the site
// assistant follows coding_agent_dev_only.
func codingAgentPermittedModes(devOnly bool) []string {
	modes := []string{}
	if codingAgentIsDev() {
		modes = append(modes, codingAgentModeCodeWorkspace)
	}
	if codingAgentIsDev() || !devOnly {
		modes = append(modes, codingAgentModeSiteAssistant)
	}
	return modes
}

func codingAgentModeIn(mode string, modes []string) bool {
	for _, candidate := range modes {
		if candidate == mode {
			return true
		}
	}
	return false
}

// handleConfiguredCodingAgent serves the administrator-only route. GET never
// starts a model; POST dispatches to the configured runner only, in one mode
// this site permits. There is no in-server launcher and no silent fallback.
func handleConfiguredCodingAgent(w http.ResponseWriter, r *http.Request) {
	socket := strings.TrimSpace(os.Getenv("FILTEREST_CODING_AGENT_SOCKET"))
	devOnly, err := codingAgentPolicyReader(r.Context())
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Coding agent configuration is unavailable")
		return
	}
	permitted := codingAgentPermittedModes(devOnly)
	enabled := len(permitted) > 0
	if !enabled && r.Method == http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusNotFound, "Coding agent is restricted to development")
		return
	}
	// AdminProfile seeds this canonical actor. Job ownership never comes from
	// browser payloads, URL parameters or an asserted role supplied by a caller.
	actor, ok := dbutils.GetRequestActorContext(r.Context())
	if !ok || !actor.IsAdmin || actor.UserID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "Administrator access required")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodPost {
		if socket == "" {
			httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Coding agent runner is not configured")
			return
		}
		dispatchCodingAgentJob(w, r, actor.UserID, devOnly, permitted)
		return
	}
	if jobID := r.URL.Query().Get("job_id"); jobID != "" {
		if !enabled || socket == "" {
			httpresponse.RespondWithError(w, http.StatusForbidden, "Coding agent is unavailable")
			return
		}
		readCodingAgentJob(w, r, actor.UserID, jobID, devOnly)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, readCodingAgentAvailability(r, actor.UserID, devOnly, permitted, socket))
}

// readCodingAgentAvailability lists each permitted mode the runner offers and
// whether it is ready now. An unreachable runner keeps the permitted modes
// visible but not ready, so the chat can say the runner is not running.
func readCodingAgentAvailability(r *http.Request, actor int, devOnly bool, permitted []string, socket string) codingAgentAvailability {
	available := codingAgentAvailability{FeatureEnabled: len(permitted) > 0, DevOnly: devOnly, Modes: []codingAgentModeAvailability{}}
	if !available.FeatureEnabled {
		available.ReasonCode = "development_only"
		return available
	}
	offered, ready := permitted, []string{}
	switch {
	case socket == "":
		available.ReasonCode = "runner_not_configured"
	default:
		var status codingAgentRunnerCapabilities
		if _, err := codingAgentSocketCall(r.Context(), http.MethodGet, "/v1/capabilities", actor, nil, &status); err != nil {
			available.ReasonCode = "runner_not_running"
			break
		}
		available.ReasonCode = status.ReasonCode
		available.AuthenticationVerified = status.AuthenticationVerified
		offered = status.OfferedModes
		if len(offered) == 0 {
			// A runner from before modes existed offered only the site assistant.
			offered = []string{codingAgentModeSiteAssistant}
		}
		if status.RunnerReady {
			ready = status.Modes
		}
	}
	for _, mode := range permitted {
		if !codingAgentModeIn(mode, offered) {
			continue
		}
		modeReady := codingAgentModeIn(mode, ready)
		available.Modes = append(available.Modes, codingAgentModeAvailability{Mode: mode, Ready: modeReady})
		available.RunnerReady = available.RunnerReady || modeReady
	}
	if available.ReasonCode == "" && len(available.Modes) == 0 {
		available.ReasonCode = "runner_mode_unavailable"
	}
	return available
}
