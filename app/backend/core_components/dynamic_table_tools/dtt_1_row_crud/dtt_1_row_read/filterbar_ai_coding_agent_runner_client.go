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
)

var codingAgentJobIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type codingAgentJobRequest struct {
	filterbarAICodexQueryRequest
	RequestID string `json:"request_id"`
}
type codingAgentJobResult struct {
	JobID        string                   `json:"job_id"`
	Status       string                   `json:"status"`
	Dataset      string                   `json:"dataset"`
	Answer       string                   `json:"answer,omitempty"`
	ErrorCode    string                   `json:"error_code,omitempty"`
	ChangedFiles []string                 `json:"changed_files,omitempty"`
	Maintenance  []map[string]interface{} `json:"maintenance,omitempty"`
	Mode         string                   `json:"mode"`
	DevOnly      bool                     `json:"dev_only"`
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
	var result codingAgentJobResult
	status, err := codingAgentSocketCall(r.Context(), http.MethodPost, "/v1/jobs", actor, payload, &result)
	if err != nil {
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
