// filterbar_ai_coding_agent_runner_client.go
// Dispatches administrator jobs to one explicitly configured local Unix socket.
// Bridges the existing chat API and durable jobs outside the web-server process.
// Keeps commands, site identity and credentials outside browser-controlled input.
package dtt_1_row_read

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"
)

var codingAgentJobIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type codingAgentJobRequest struct {
	filterbarAICodexQueryRequest
	RequestID string `json:"request_id"`
	// ImageTokens name the administrator's own waiting attachments. They are
	// resolved to paths here and never forwarded to the runner as tokens.
	ImageTokens []string `json:"image_tokens,omitempty"`
}
type codingAgentJobResult struct {
	JobID        string                   `json:"job_id"`
	Status       string                   `json:"status"`
	Dataset      string                   `json:"dataset"`
	Answer       string                   `json:"answer,omitempty"`
	ErrorCode    string                   `json:"error_code,omitempty"`
	ChangedFiles []string                 `json:"changed_files,omitempty"`
	Maintenance  []map[string]interface{} `json:"maintenance,omitempty"`
	// PendingChanges lists write calls the assistant wants the administrator to
	// approve. The chat's own filter plan keeps the name "plan", so this field
	// deliberately differs from it.
	PendingChanges []codingAgentPlanEntry `json:"pending_changes,omitempty"`
	Mode    string `json:"mode"`
	DevOnly bool   `json:"dev_only"`
}

// codingAgentPlanEntry describes one waiting write in the words of the API call
// itself. The browser sees the call, never the delegation behind it.
type codingAgentPlanEntry struct {
	Method      string                 `json:"method"`
	Path        string                 `json:"path"`
	BodyHash    string                 `json:"body_sha256"`
	Query       map[string]interface{} `json:"query,omitempty"`
	Body        interface{}            `json:"body,omitempty"`
	Description string                 `json:"description,omitempty"`
	Status      string                 `json:"status,omitempty"`
}

// codingAgentRunnerPayload adds the job's own short-lived site access to the
// browser-supplied request. The browser can neither send nor read these fields.
type codingAgentRunnerPayload struct {
	codingAgentJobRequest
	SiteAssistant *codingAgentSiteAccess `json:"site_assistant,omitempty"`
	// Images are the administrator's own attachments, named by a path on this
	// machine. The browser never sees or supplies a path.
	Images []codingAgentImage `json:"images,omitempty"`
}

type codingAgentImage struct {
	Path string `json:"path"`
	Name string `json:"name,omitempty"`
}

type codingAgentSiteAccess struct {
	DelegationCode string `json:"delegation_code"`
	SiteBaseURL    string `json:"site_base_url"`
	CatalogRoute   string `json:"api_catalog_route"`
	ExpiresAt      string `json:"expires_at"`
}

// callCodingAgentRunner uses only the operator-selected local socket and site.
// The dedicated service verifies peer UID, fixed site identity and job owner.
func callCodingAgentRunner(ctx context.Context, method, path string, actor int, payload interface{}, result interface{}) (int, error) {
	socket := strings.TrimSpace(os.Getenv("FILTEREST_CODING_AGENT_SOCKET"))
	site := strings.TrimSpace(os.Getenv("FILTEREST_CODING_AGENT_SITE_ID"))
	if !filepath.IsAbs(socket) || site == "" {
		return 0, errors.New("coding agent runner is not configured")
	}
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return 0, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://coding-agent"+path, body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Filterest-Site", site)
	req.Header.Set("X-Filterest-Actor", strconv.Itoa(actor))
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		return 0, errors.New("coding agent runner is unreachable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return response.StatusCode, fmt.Errorf("coding agent runner rejected request (%d)", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(result); err != nil {
		return response.StatusCode, errors.New("invalid coding agent response")
	}
	return response.StatusCode, nil
}

func dispatchCodingAgentJob(w http.ResponseWriter, r *http.Request, actor int, devOnly bool) {
	var payload codingAgentJobRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		httpresponse.RespondWithError(w, 400, "invalid coding agent request")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		httpresponse.RespondWithError(w, 400, "invalid coding agent request")
		return
	}
	payload.Dataset = strings.TrimSpace(payload.Dataset)
	payload.Query = strings.TrimSpace(payload.Query)
	if payload.Dataset == "" || payload.Query == "" || len(payload.Query) > 24000 || !codingAgentJobIDPattern.MatchString(payload.RequestID) {
		httpresponse.RespondWithError(w, 400, "dataset, query and valid request_id are required")
		return
	}
	payload.Messages = trimFilterbarAICodexMessages(payload.Messages)

	// The attachments belong to the asking administrator, so an unknown or
	// someone else's token stops the job instead of silently dropping an image
	// the person believes the assistant can see.
	images, imageErr := resolveCodingAgentImages(actor, payload.ImageTokens)
	if imageErr != nil {
		httpresponse.RespondWithError(w, 400, "an attached image is no longer available")
		return
	}
	payload.ImageTokens = nil

	runnerPayload := codingAgentRunnerPayload{codingAgentJobRequest: payload, Images: images}
	access, delegationID, accessErr := issueCodingAgentSiteAccess(r, actor, payload.RequestID)
	if accessErr != nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Site access for this job could not be prepared")
		return
	}
	runnerPayload.SiteAssistant = access

	var result codingAgentJobResult
	status, err := codingAgentSocketCall(r.Context(), http.MethodPost, "/v1/jobs", actor, runnerPayload, &result)
	if err != nil {
		// A job that never started keeps no site access.
		site_assistant.DefaultStore.Revoke(delegationID)
		respondCodingAgentRunnerError(w, status)
		return
	}
	result.Mode = "codex"
	result.DevOnly = devOnly
	httpresponse.RespondWithJSON(w, http.StatusAccepted, result)
}
func readCodingAgentJob(w http.ResponseWriter, r *http.Request, actor int, jobID string, devOnly bool) {
	dataset := strings.TrimSpace(r.URL.Query().Get("dataset"))
	if dataset == "" || !codingAgentJobIDPattern.MatchString(jobID) {
		httpresponse.RespondWithError(w, 400, "dataset and valid job_id are required")
		return
	}
	var result codingAgentJobResult
	status, err := codingAgentSocketCall(r.Context(), http.MethodGet, "/v1/jobs/"+jobID+"?dataset="+url.QueryEscape(dataset), actor, nil, &result)
	if err != nil {
		respondCodingAgentRunnerError(w, status)
		return
	}
	result.Mode = "codex"
	result.DevOnly = devOnly
	httpresponse.RespondWithJSON(w, http.StatusOK, result)
}
func respondCodingAgentRunnerError(w http.ResponseWriter, status int) {
	switch status {
	case 400, 403, 404, 409, 429:
	default:
		status = 503
	}
	httpresponse.RespondWithError(w, status, "Coding agent job is unavailable; check runner status")
}

// codingAgentSiteAccessLifetime bounds one job's access to its own site.
const codingAgentSiteAccessLifetime = 30 * time.Minute

// issueCodingAgentSiteAccess gives one job a one-time code for acting as this
// administrator on this site. The code never reaches the browser; only the
// runner receives it over the private socket.
func issueCodingAgentSiteAccess(r *http.Request, actor int, jobID string) (*codingAgentSiteAccess, string, error) {
	baseURL, err := codingAgentSiteBaseURL()
	if err != nil {
		return nil, "", err
	}
	username := codingAgentSessionUsername(r)
	if username == "" {
		return nil, "", errors.New("the administrator's username is unavailable")
	}
	code, delegation, err := site_assistant.DefaultStore.Issue(
		actor, username, jobID, strings.TrimSpace(os.Getenv("FILTEREST_CODING_AGENT_SITE_ID")), codingAgentSiteAccessLifetime)
	if err != nil {
		return nil, "", err
	}
	return &codingAgentSiteAccess{
		DelegationCode: code,
		SiteBaseURL:    baseURL,
		CatalogRoute:   "/api/admin/site-assistant/api-catalog",
		ExpiresAt:      delegation.ExpiresAt.UTC().Format(time.RFC3339),
	}, delegation.ID, nil
}

// codingAgentSiteBaseURL resolves the loopback address the host-side runner uses
// for this site. An operator may override it; it is never browser input.
func codingAgentSiteBaseURL() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("FILTEREST_SITE_ASSISTANT_BASE_URL")); configured != "" {
		parsed, err := url.Parse(configured)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			return "", errors.New("configured site assistant base URL is invalid")
		}
		return strings.TrimRight(configured, "/"), nil
	}
	port := strings.TrimSpace(os.Getenv("APP_PORT"))
	if _, err := strconv.Atoi(port); err != nil {
		return "", errors.New("site assistant base URL is not configured")
	}
	return "http://127.0.0.1:" + port, nil
}

// codingAgentSessionUsername reads the requesting administrator's username from
// the authenticated session, not from the request body.
func codingAgentSessionUsername(r *http.Request) string {
	store := e_sessions.GetStore()
	if store == nil {
		return ""
	}
	session, err := store.Get(r, e_sessions.SessionName)
	if err != nil {
		return ""
	}
	username, _ := session.Values["username"].(string)
	return strings.TrimSpace(username)
}
