// filterbar_ai_site_assistant_approval.go
// Lets the asking administrator approve the changes an assistant job prepared.
// Bridges the chat's approval click, the delegation store and the runner's apply step.
// Exists so a write happens only after the person who asked has seen the exact call.
package dtt_1_row_read

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/site_assistant"
)

type siteAssistantApprovalRequest struct {
	Dataset   string                       `json:"dataset"`
	JobID     string                       `json:"job_id"`
	Approvals []siteAssistantApprovalEntry `json:"approvals"`
}

type siteAssistantApprovalEntry struct {
	Method   string `json:"method"`
	Path     string `json:"path"`
	Query    string `json:"query"`
	BodyHash string `json:"body_sha256"`
}

type siteAssistantApplyRequest struct {
	Dataset       string                 `json:"dataset"`
	SiteAssistant *codingAgentSiteAccess `json:"site_assistant"`
}

// SiteAssistantApprovalHandler approves the named waiting changes of one
// assistant job and runs them. Only the administrator who started the job may
// approve it, the approved calls must match what that job actually prepared,
// and each approved call runs once.
func SiteAssistantApprovalHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")

	actor, ok := dbutils.GetRequestActorContext(r.Context())
	if !ok || !actor.IsAdmin || actor.UserID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator access is required")
		return
	}

	var request siteAssistantApprovalRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid approval request")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid approval request")
		return
	}
	request.Dataset = strings.TrimSpace(request.Dataset)
	if request.Dataset == "" || !codingAgentJobIDPattern.MatchString(request.JobID) || len(request.Approvals) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset, job_id and approvals are required")
		return
	}

	// The waiting changes come from the runner's own job record, never from the browser.
	var job codingAgentJobResult
	status, err := codingAgentSocketCall(r.Context(), http.MethodGet,
		"/v1/jobs/"+request.JobID+"?dataset="+url.QueryEscape(request.Dataset), actor.UserID, nil, &job)
	if err != nil {
		respondCodingAgentRunnerError(w, status)
		return
	}
	approved, err := matchWaitingChanges(job.PendingChanges, request.Approvals)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
		return
	}

	access, delegationID, accessErr := issueCodingAgentSiteAccess(r, actor.UserID, request.JobID)
	if accessErr != nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "Site access for this approval could not be prepared")
		return
	}
	defer site_assistant.DefaultStore.Revoke(delegationID)
	if err := site_assistant.DefaultStore.Approve(delegationID, approved); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "approved changes are invalid")
		return
	}

	var result codingAgentJobResult
	status, err = codingAgentSocketCall(r.Context(), http.MethodPost, "/v1/jobs/"+request.JobID+"/apply",
		actor.UserID, siteAssistantApplyRequest{Dataset: request.Dataset, SiteAssistant: access}, &result)
	if err != nil {
		respondCodingAgentRunnerError(w, status)
		return
	}
	result.Mode = "codex"
	httpresponse.RespondWithJSON(w, http.StatusOK, result)
}

// matchWaitingChanges keeps approval bound to the calls the job actually
// prepared, so a browser cannot approve a call the assistant never made.
func matchWaitingChanges(waiting []codingAgentPlanEntry, requested []siteAssistantApprovalEntry) ([]site_assistant.ApprovedCall, error) {
	approved := make([]site_assistant.ApprovedCall, 0, len(requested))
	for _, entry := range requested {
		method := strings.ToUpper(strings.TrimSpace(entry.Method))
		path := strings.TrimSpace(entry.Path)
		query, queryErr := site_assistant.CanonicalQuery(entry.Query)
		hash := strings.ToLower(strings.TrimSpace(entry.BodyHash))
		found := false
		for _, candidate := range waiting {
			candidateQuery, candidateQueryErr := site_assistant.CanonicalQuery(candidate.ApprovalQuery)
			if strings.EqualFold(candidate.Method, method) && candidate.Path == path &&
				queryErr == nil && candidateQueryErr == nil && candidateQuery == query &&
				strings.EqualFold(candidate.BodyHash, hash) && candidate.Status != "done" {
				found = true
				break
			}
		}
		if !found {
			return nil, errUnknownWaitingChange
		}
		approved = append(approved, site_assistant.ApprovedCall{Method: method, Path: path, Query: query, BodyHash: hash})
	}
	return approved, nil
}

var errUnknownWaitingChange = &approvalMismatchError{}

type approvalMismatchError struct{}

func (*approvalMismatchError) Error() string {
	return "the approved change is not waiting in this job"
}
