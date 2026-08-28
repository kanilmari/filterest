// workline_report_contract.go
// Defines validation and secret-screening contracts for canonical development work reports.
// Bridges Agent Tools JSON payloads with the workline/report database schema.
// Exists so reports remain concise, searchable, append-first, and safe to retrieve in later AI sessions.
package agent_tools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxWorklineTitleRunes = 300
	maxReportTitleRunes   = 300
	maxReportContentRunes = 20000
	maxReportSourceRunes  = 500
	maxReportMetadataSize = 10000
	maxReportTags         = 20
	maxReportTagRunes     = 64
	maxReportGitPaths     = 500
	maxReportGitPathRunes = 500
)

var (
	validWorklineStatuses = map[string]struct{}{
		"active": {}, "paused": {}, "closed": {}, "archived": {},
	}
	validWorklineReportTypes = map[string]struct{}{
		"completion": {}, "progress": {}, "decision": {}, "closure": {},
	}
	validWorklineReportOutcomes = map[string]struct{}{
		"completed": {}, "partial": {}, "blocked": {}, "no_change": {}, "decision": {},
	}
	validReportPhaseGates = map[string]struct{}{
		"2": {}, "3-4": {}, "5-6": {},
	}
	sourceKindPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,39}$`)
	gitCommitPattern  = regexp.MustCompile(`^[a-f0-9]{7,64}$`)

	privateKeyPattern    = regexp.MustCompile(`(?i)-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----`)
	authorizationPattern = regexp.MustCompile(
		`(?i)\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}`,
	)
	knownTokenPattern = regexp.MustCompile(
		`(?i)\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b`,
	)
	jwtPattern              = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`)
	credentialURLPattern    = regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]{4,}@`)
	secretAssignmentPattern = regexp.MustCompile(
		`(?im)\b(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|token)\b\s*[:=]\s*["']?([A-Za-z0-9+/_.=-]{12,})`,
	)
)

type AgentWorkline struct {
	ID                      int64      `json:"id"`
	Title                   string     `json:"title"`
	Status                  string     `json:"status"`
	StatusChangedBy         *int       `json:"status_changed_by,omitempty"`
	StatusChangedByUsername string     `json:"status_changed_by_username,omitempty"`
	StatusChangedAt         time.Time  `json:"status_changed_at"`
	StatusChangeSource      string     `json:"status_change_source"`
	StatusRevision          int64      `json:"status_revision"`
	Tags                    []string   `json:"tags"`
	CreatedBy               *int       `json:"created_by,omitempty"`
	CreatedByUsername       string     `json:"created_by_username,omitempty"`
	CreatedAt               time.Time  `json:"created_at"`
	UpdatedAt               time.Time  `json:"updated_at"`
	ReportCount             int64      `json:"report_count"`
	LatestReportAt          *time.Time `json:"latest_report_at,omitempty"`
	TaskIDs                 []int64    `json:"task_ids"`
}

type AgentWorklineReport struct {
	ID                          int64          `json:"id"`
	WorklineID                  int64          `json:"workline_id"`
	WorklineTitle               string         `json:"workline_title"`
	Title                       string         `json:"title"`
	ReportType                  string         `json:"report_type"`
	Outcome                     string         `json:"outcome"`
	State                       string         `json:"state"`
	Content                     string         `json:"content,omitempty"`
	SourceKind                  string         `json:"source_kind"`
	SourceRef                   string         `json:"source_ref,omitempty"`
	Tags                        []string       `json:"tags"`
	Metadata                    map[string]any `json:"metadata"`
	ContentHash                 string         `json:"content_hash"`
	FormatVersion               int            `json:"format_version"`
	PhaseGate                   string         `json:"phase_gate,omitempty"`
	CurrentPhase                int            `json:"current_phase"`
	WorklineStatusSnapshot      string         `json:"workline_status_snapshot,omitempty"`
	ChangedThisTurn             *bool          `json:"changed_this_turn,omitempty"`
	ContextText                 string         `json:"context,omitempty"`
	PlainLanguageText           string         `json:"plain_language,omitempty"`
	TechnicalText               string         `json:"technical,omitempty"`
	NextStepText                string         `json:"next_step,omitempty"`
	Snapshot                    map[string]any `json:"snapshot"`
	GitHeadCommit               string         `json:"git_head_commit,omitempty"`
	GitWorktreeState            string         `json:"git_worktree_state,omitempty"`
	GitHasOtherChanges          *bool          `json:"git_has_other_changes,omitempty"`
	GitWorklineChangedPaths     []string       `json:"git_workline_changed_paths"`
	GitWorklineChangedPathCount int            `json:"git_workline_changed_path_count"`
	SupersedesReportID          *int64         `json:"supersedes_report_id,omitempty"`
	RedactionReason             string         `json:"redaction_reason,omitempty"`
	CreatedBy                   *int           `json:"created_by,omitempty"`
	CreatedByUsername           string         `json:"created_by_username,omitempty"`
	CreatedAt                   time.Time      `json:"created_at"`
	StateChangedAt              time.Time      `json:"state_changed_at"`
}

type worklineCreateRequest struct {
	Title  string   `json:"title"`
	Status string   `json:"status"`
	Tags   []string `json:"tags"`
}

type worklinePatchRequest struct {
	ID     int64     `json:"id"`
	Title  *string   `json:"title"`
	Status *string   `json:"status"`
	Tags   *[]string `json:"tags"`
}

type worklineReportCreateRequest struct {
	WorklineID              int64           `json:"workline_id"`
	Title                   string          `json:"title"`
	ReportType              string          `json:"report_type"`
	Outcome                 string          `json:"outcome"`
	PhaseGate               string          `json:"phase_gate"`
	CurrentPhase            *int            `json:"current_phase"`
	WorklineStatusSnapshot  string          `json:"workline_status_snapshot"`
	SyncWorklineStatus      bool            `json:"sync_workline_status"`
	ChangedThisTurn         *bool           `json:"changed_this_turn"`
	ContextText             string          `json:"context"`
	PlainLanguageText       string          `json:"plain_language"`
	TechnicalText           string          `json:"technical"`
	NextStepText            string          `json:"next_step"`
	Snapshot                json.RawMessage `json:"snapshot"`
	GitHeadCommit           string          `json:"git_head_commit"`
	GitWorktreeState        string          `json:"git_worktree_state"`
	GitHasOtherChanges      *bool           `json:"git_has_other_changes"`
	GitWorklineChangedPaths []string        `json:"git_workline_changed_paths"`
	SourceKind              string          `json:"source_kind"`
	SourceRef               string          `json:"source_ref"`
	Tags                    []string        `json:"tags"`
	Metadata                json.RawMessage `json:"metadata"`
	SupersedesReportID      *int64          `json:"supersedes_report_id"`
}

type normalizedWorklineReportCreate struct {
	worklineReportCreateRequest
	MetadataObject map[string]any
	MetadataJSON   []byte
	SnapshotObject map[string]any
	SnapshotJSON   []byte
	Content        string
	ContentHash    string
}

type worklineReportPatchRequest struct {
	ID              int64   `json:"id"`
	State           *string `json:"state"`
	RedactionReason *string `json:"redaction_reason"`
}

type worklineTaskLinkRequest struct {
	WorklineID int64 `json:"workline_id"`
	TaskID     int   `json:"task_id"`
}

type AgentWorklineTaskLink struct {
	ID            int64     `json:"id"`
	WorklineID    int64     `json:"workline_id"`
	WorklineTitle string    `json:"workline_title"`
	TaskID        int       `json:"task_id"`
	TaskTitle     string    `json:"task_title"`
	CreatedBy     *int      `json:"created_by,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

func normalizeBoundedText(value, fieldName string, maxRunes int) (string, error) {
	trimmed := strings.TrimSpace(value)
	length := utf8.RuneCountInString(trimmed)
	if length == 0 || length > maxRunes {
		return "", fmt.Errorf("%s must be 1-%d characters", fieldName, maxRunes)
	}
	return trimmed, nil
}

func normalizeWorklineStatus(value string) string {
	status := strings.ToLower(strings.TrimSpace(value))
	if status == "" {
		return "active"
	}
	if _, ok := validWorklineStatuses[status]; !ok {
		return ""
	}
	return status
}

func normalizeReportEnum(value, fallback string, allowed map[string]struct{}) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		normalized = fallback
	}
	if _, ok := allowed[normalized]; !ok {
		return ""
	}
	return normalized
}

func normalizeReportTags(tags []string) ([]string, error) {
	if len(tags) > maxReportTags {
		return nil, fmt.Errorf("tags may contain at most %d values", maxReportTags)
	}

	normalized := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if tag == "" || utf8.RuneCountInString(tag) > maxReportTagRunes {
			return nil, fmt.Errorf("each tag must be 1-%d characters", maxReportTagRunes)
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		normalized = append(normalized, tag)
	}
	return normalized, nil
}

func looksLikeCredentialAssignment(name, value string) bool {
	lowerValue := strings.ToLower(strings.Trim(value, `"'`))
	for _, placeholder := range []string{
		"redacted", "rotated", "omitted", "placeholder", "example", "protected", "secret_store", "environment_variable",
	} {
		if strings.Contains(lowerValue, placeholder) {
			return false
		}
	}

	if len(lowerValue) >= 20 || strings.Contains(strings.ToLower(name), "password") {
		return true
	}
	classes := 0
	for _, pattern := range []string{`[a-z]`, `[A-Z]`, `[0-9]`, `[^A-Za-z0-9]`} {
		if regexp.MustCompile(pattern).MatchString(value) {
			classes++
		}
	}
	return len(value) >= 16 && classes >= 3
}

// detectReportSecret classifies high-confidence credential material without returning the match.
// Between: untrusted report fields and persistent canonical history.
// Why: a rejected request must neither store nor echo the submitted credential.
func detectReportSecret(values ...string) string {
	for _, value := range values {
		switch {
		case privateKeyPattern.MatchString(value):
			return "private_key"
		case authorizationPattern.MatchString(value):
			return "authorization_credential"
		case knownTokenPattern.MatchString(value):
			return "provider_token"
		case jwtPattern.MatchString(value):
			return "signed_token"
		case credentialURLPattern.MatchString(value):
			return "url_credential"
		}
		for _, match := range secretAssignmentPattern.FindAllStringSubmatch(value, -1) {
			if len(match) == 3 && looksLikeCredentialAssignment(match[1], match[2]) {
				return "credential_assignment"
			}
		}
	}
	return ""
}

func reportContentHash(title, reportType, outcome, content string) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{title, reportType, outcome, content}, "\x00")))
	return hex.EncodeToString(digest[:])
}

func normalizeOptionalBoundedText(value, fieldName string, maxRunes int) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if utf8.RuneCountInString(trimmed) > maxRunes {
		return "", fmt.Errorf("%s must be at most %d characters", fieldName, maxRunes)
	}
	return trimmed, nil
}

func normalizeGitChangedPaths(values []string) ([]string, error) {
	if len(values) > maxReportGitPaths {
		return nil, fmt.Errorf("git_workline_changed_paths may contain at most %d values", maxReportGitPaths)
	}
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
		cleaned := path.Clean(value)
		if value == "" || cleaned == "." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
			return nil, fmt.Errorf("git workline paths must be repository-relative")
		}
		if utf8.RuneCountInString(cleaned) > maxReportGitPathRunes || strings.ContainsAny(cleaned, "\r\n\x00") {
			return nil, fmt.Errorf("invalid git workline path")
		}
		if _, exists := seen[cleaned]; exists {
			continue
		}
		seen[cleaned] = struct{}{}
		normalized = append(normalized, cleaned)
	}
	sort.Strings(normalized)
	return normalized, nil
}

func renderStructuredWorklineReport(input worklineReportCreateRequest) string {
	changed := "ei"
	if input.ChangedThisTurn != nil && *input.ChangedThisTurn {
		changed = "kyllä"
	}
	var builder strings.Builder
	builder.WriteString("**Konteksti:** ")
	builder.WriteString(input.ContextText)
	builder.WriteString("\n\n**Selkokielellä:** ")
	builder.WriteString(input.PlainLanguageText)
	builder.WriteString("\n\n**Teknisesti:** ")
	builder.WriteString(input.TechnicalText)
	if input.NextStepText != "" {
		builder.WriteString("\n\n**Seuraava askel:** ")
		builder.WriteString(input.NextStepText)
	}
	builder.WriteString("\n\n**Snapshot:** tarkka vaihe ")
	builder.WriteString(fmt.Sprintf("%d", *input.CurrentPhase))
	builder.WriteString(", raportointipiste ")
	builder.WriteString(input.PhaseGate)
	builder.WriteString(", työlinjan tila ")
	builder.WriteString(input.WorklineStatusSnapshot)
	builder.WriteString(", muutos tällä kierroksella: ")
	builder.WriteString(changed)
	builder.WriteString(".")
	builder.WriteString("\n\n**Git-snapshot:** commit ")
	builder.WriteString(input.GitHeadCommit)
	builder.WriteString(", koko työpuu ")
	builder.WriteString(input.GitWorktreeState)
	builder.WriteString(", tämän työlinjan muuttuneita polkuja ")
	builder.WriteString(fmt.Sprintf("%d", len(input.GitWorklineChangedPaths)))
	if len(input.GitWorklineChangedPaths) > 0 {
		builder.WriteString(": ")
		builder.WriteString(strings.Join(input.GitWorklineChangedPaths, ", "))
	}
	if input.GitWorktreeState == "clean" {
		builder.WriteString("; työpuu on puhdas")
	} else if input.GitHasOtherChanges != nil && *input.GitHasOtherChanges {
		builder.WriteString("; työpuussa on lisäksi muita muutoksia")
	} else {
		builder.WriteString("; tämä työlinja on työpuun ainoa likaaja")
	}
	builder.WriteString(".")
	return builder.String()
}

func normalizeWorklineReportCreate(input worklineReportCreateRequest) (normalizedWorklineReportCreate, error) {
	var normalized normalizedWorklineReportCreate
	if input.WorklineID <= 0 {
		return normalized, fmt.Errorf("workline_id must be a positive integer")
	}

	var err error
	input.Title, err = normalizeBoundedText(input.Title, "title", maxReportTitleRunes)
	if err != nil {
		return normalized, err
	}
	input.ContextText, err = normalizeBoundedText(input.ContextText, "context", 4000)
	if err != nil {
		return normalized, err
	}
	input.PlainLanguageText, err = normalizeBoundedText(input.PlainLanguageText, "plain_language", 6000)
	if err != nil {
		return normalized, err
	}
	input.TechnicalText, err = normalizeBoundedText(input.TechnicalText, "technical", 8000)
	if err != nil {
		return normalized, err
	}
	input.NextStepText, err = normalizeOptionalBoundedText(input.NextStepText, "next_step", 4000)
	if err != nil {
		return normalized, err
	}
	input.PhaseGate = strings.TrimSpace(input.PhaseGate)
	if _, ok := validReportPhaseGates[input.PhaseGate]; !ok {
		return normalized, fmt.Errorf("invalid phase_gate")
	}
	if input.CurrentPhase == nil {
		return normalized, fmt.Errorf("current_phase is required")
	}
	if *input.CurrentPhase < 0 || *input.CurrentPhase > 6 {
		return normalized, fmt.Errorf("current_phase must be between 0 and 6")
	}
	if strings.TrimSpace(input.WorklineStatusSnapshot) == "" {
		return normalized, fmt.Errorf("workline_status_snapshot is required")
	}
	input.WorklineStatusSnapshot = normalizeWorklineStatus(input.WorklineStatusSnapshot)
	if input.WorklineStatusSnapshot == "" {
		return normalized, fmt.Errorf("invalid workline_status_snapshot")
	}
	if input.ChangedThisTurn == nil {
		return normalized, fmt.Errorf("changed_this_turn is required")
	}
	if input.WorklineStatusSnapshot == "active" || input.WorklineStatusSnapshot == "paused" {
		if input.NextStepText == "" {
			return normalized, fmt.Errorf("open workline reports require next_step")
		}
	} else if input.NextStepText != "" {
		return normalized, fmt.Errorf("closed workline reports must omit next_step")
	}
	input.ReportType = normalizeReportEnum(input.ReportType, "completion", validWorklineReportTypes)
	if input.ReportType == "" {
		return normalized, fmt.Errorf("invalid report_type")
	}
	input.Outcome = normalizeReportEnum(input.Outcome, "completed", validWorklineReportOutcomes)
	if input.Outcome == "" {
		return normalized, fmt.Errorf("invalid outcome")
	}
	input.SourceKind = strings.ToLower(strings.TrimSpace(input.SourceKind))
	if input.SourceKind == "" {
		input.SourceKind = "codex"
	}
	if !sourceKindPattern.MatchString(input.SourceKind) {
		return normalized, fmt.Errorf("invalid source_kind")
	}
	input.SourceRef = strings.TrimSpace(input.SourceRef)
	if utf8.RuneCountInString(input.SourceRef) > maxReportSourceRunes {
		return normalized, fmt.Errorf("source_ref must be at most %d characters", maxReportSourceRunes)
	}
	input.Tags, err = normalizeReportTags(input.Tags)
	if err != nil {
		return normalized, err
	}

	metadataJSON := []byte(`{}`)
	metadataObject := map[string]any{}
	if len(input.Metadata) > 0 && string(input.Metadata) != "null" {
		if len(input.Metadata) > maxReportMetadataSize {
			return normalized, fmt.Errorf("metadata is too large")
		}
		if err := json.Unmarshal(input.Metadata, &metadataObject); err != nil {
			return normalized, fmt.Errorf("metadata must be a JSON object")
		}
		metadataJSON, err = json.Marshal(metadataObject)
		if err != nil {
			return normalized, fmt.Errorf("metadata could not be normalized")
		}
	}
	snapshotJSON := []byte(`{}`)
	snapshotObject := map[string]any{}
	if len(input.Snapshot) > 0 && string(input.Snapshot) != "null" {
		if len(input.Snapshot) > maxReportMetadataSize {
			return normalized, fmt.Errorf("snapshot is too large")
		}
		if err := json.Unmarshal(input.Snapshot, &snapshotObject); err != nil {
			return normalized, fmt.Errorf("snapshot must be a JSON object")
		}
		snapshotJSON, err = json.Marshal(snapshotObject)
		if err != nil {
			return normalized, fmt.Errorf("snapshot could not be normalized")
		}
	}
	input.GitHeadCommit = strings.ToLower(strings.TrimSpace(input.GitHeadCommit))
	if !gitCommitPattern.MatchString(input.GitHeadCommit) {
		return normalized, fmt.Errorf("invalid git_head_commit")
	}
	input.GitWorktreeState = strings.ToLower(strings.TrimSpace(input.GitWorktreeState))
	if input.GitWorktreeState != "clean" && input.GitWorktreeState != "dirty" {
		return normalized, fmt.Errorf("git_worktree_state must be clean or dirty")
	}
	input.GitWorklineChangedPaths, err = normalizeGitChangedPaths(input.GitWorklineChangedPaths)
	if err != nil {
		return normalized, err
	}
	if input.GitHasOtherChanges == nil {
		return normalized, fmt.Errorf("git_has_other_changes is required")
	}
	if input.GitWorktreeState == "clean" && (len(input.GitWorklineChangedPaths) != 0 || *input.GitHasOtherChanges) {
		return normalized, fmt.Errorf("clean git snapshot cannot contain changed paths")
	}
	if input.GitWorktreeState == "dirty" && len(input.GitWorklineChangedPaths) == 0 && !*input.GitHasOtherChanges {
		return normalized, fmt.Errorf("dirty git snapshot must contain changed paths")
	}
	content := renderStructuredWorklineReport(input)
	if utf8.RuneCountInString(content) > maxReportContentRunes {
		return normalized, fmt.Errorf("rendered content must be at most %d characters", maxReportContentRunes)
	}

	secretValues := []string{
		input.Title, content, input.SourceRef, string(metadataJSON), string(snapshotJSON), input.GitHeadCommit,
	}
	secretValues = append(secretValues, input.Tags...)
	secretValues = append(secretValues, input.GitWorklineChangedPaths...)
	if category := detectReportSecret(secretValues...); category != "" {
		return normalized, fmt.Errorf("report_rejected_secret_detected:%s", category)
	}

	normalized.worklineReportCreateRequest = input
	normalized.MetadataObject = metadataObject
	normalized.MetadataJSON = metadataJSON
	normalized.SnapshotObject = snapshotObject
	normalized.SnapshotJSON = snapshotJSON
	normalized.Content = content
	normalized.ContentHash = reportContentHash(input.Title, input.ReportType, input.Outcome, content)
	return normalized, nil
}
