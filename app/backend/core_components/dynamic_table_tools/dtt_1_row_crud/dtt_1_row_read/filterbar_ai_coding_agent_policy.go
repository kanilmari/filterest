// filterbar_ai_coding_agent_policy.go
// Separates administrator coding-agent permission from execution readiness.
// Bridges current system_config, the existing AdminProfile and optional runner.
// Keeps production permission independent of the application's development mode.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

const codingAgentDevOnlyKey = "coding_agent_dev_only"

type codingAgentAvailability struct {
	FeatureEnabled         bool   `json:"feature_enabled"`
	DevOnly                bool   `json:"dev_only"`
	RunnerReady            bool   `json:"runner_ready"`
	RunnerKind             string `json:"runner_kind"`
	ReasonCode             string `json:"reason_code,omitempty"`
	AuthenticationVerified bool   `json:"authentication_verified"`
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

// handleConfiguredCodingAgent extends the existing administrator-only route.
// GET never starts a model. Without a socket DEV POST keeps its existing adapter;
// production POST can only dispatch to the explicitly configured external runner.
func handleConfiguredCodingAgent(w http.ResponseWriter, r *http.Request) bool {
	socket := strings.TrimSpace(os.Getenv("FILTEREST_CODING_AGENT_SOCKET"))
	if r.Method == http.MethodPost && codingAgentIsDev() && socket == "" {
		return false
	}

	devOnly, err := codingAgentPolicyReader(r.Context())
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Coding agent configuration is unavailable")
		return true
	}
	enabled := codingAgentIsDev() || !devOnly
	if !enabled && r.Method == http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusNotFound, "Coding agent is restricted to development")
		return true
	}
	// AdminProfile seeds this canonical actor. Job ownership never comes from
	// browser payloads, URL parameters or an asserted role supplied by a caller.
	actor, ok := dbutils.GetRequestActorContext(r.Context())
	if !ok || !actor.IsAdmin || actor.UserID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "Administrator access required")
		return true
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodPost {
		if socket == "" {
			httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Coding agent runner is not configured")
			return true
		}
		dispatchCodingAgentJob(w, r, actor.UserID, devOnly)
		return true
	}
	if jobID := r.URL.Query().Get("job_id"); jobID != "" {
		if !enabled || socket == "" {
			httpresponse.RespondWithError(w, http.StatusForbidden, "Coding agent is unavailable")
			return true
		}
		readCodingAgentJob(w, r, actor.UserID, jobID, devOnly)
		return true
	}
	available := codingAgentAvailability{FeatureEnabled: enabled, DevOnly: devOnly, RunnerKind: "external"}
	switch {
	case !enabled:
		available.ReasonCode = "development_only"
	case socket != "":
		var status codingAgentAvailability
		if _, err := codingAgentSocketCall(r.Context(), http.MethodGet, "/v1/capabilities", actor.UserID, nil, &status); err != nil {
			available.ReasonCode = "runner_unreachable"
		} else {
			available.RunnerReady = status.RunnerReady
			available.ReasonCode = status.ReasonCode
			available.AuthenticationVerified = status.AuthenticationVerified
		}
	case codingAgentIsDev():
		available.RunnerKind = "legacy_dev"
		command, _ := resolveFilterbarAICodexCommand()
		_, err := exec.LookPath(command)
		available.RunnerReady = err == nil
		// This preserves the installed development launcher (including npx).
		// Availability is not a claim that its account has been authenticated.
		if err != nil {
			available.ReasonCode = "launcher_missing"
		}
	default:
		available.ReasonCode = "runner_not_configured"
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, available)
	return true
}
