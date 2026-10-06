// handover_report_contract.go
// Defines validation and rendering contracts for canonical chat handover manifests.
// Bridges immutable workline reports with ordered next-chat continuation context.
// Exists so handovers stay structured, secret-screened, and free of duplicated report text.
package agent_tools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const maxHandoverItems = 50

var validPhaseGates = map[string]struct{}{
	"2": {}, "3-4": {}, "5-6": {},
}

type AgentHandoverReport struct {
	ID                   int64                     `json:"id"`
	Title                string                    `json:"title"`
	State                string                    `json:"state"`
	SourceKind           string                    `json:"source_kind"`
	SourceRef            string                    `json:"source_ref,omitempty"`
	Tags                 []string                  `json:"tags"`
	Metadata             map[string]any            `json:"metadata"`
	MembershipHash       string                    `json:"membership_hash"`
	SupersedesHandoverID *int64                    `json:"supersedes_handover_id,omitempty"`
	CreatedBy            *int                      `json:"created_by,omitempty"`
	CreatedByUsername    string                    `json:"created_by_username,omitempty"`
	CreatedAt            time.Time                 `json:"created_at"`
	StateChangedAt       time.Time                 `json:"state_changed_at"`
	Items                []AgentHandoverReportItem `json:"items,omitempty"`
	Markdown             string                    `json:"markdown,omitempty"`
}

type AgentHandoverReportItem struct {
	ID               int64               `json:"id"`
	HandoverReportID int64               `json:"handover_report_id"`
	SortOrder        int                 `json:"sort_order"`
	Report           AgentWorklineReport `json:"report"`
}

type handoverReportItemCreateRequest struct {
	WorklineID       int64 `json:"workline_id"`
	WorklineReportID int64 `json:"workline_report_id"`
}

type handoverReportCreateRequest struct {
	Title                string                            `json:"title"`
	SourceKind           string                            `json:"source_kind"`
	SourceRef            string                            `json:"source_ref"`
	Tags                 []string                          `json:"tags"`
	Metadata             json.RawMessage                   `json:"metadata"`
	SupersedesHandoverID *int64                            `json:"supersedes_handover_id"`
	Items                []handoverReportItemCreateRequest `json:"items"`
}

type normalizedHandoverReportCreate struct {
	handoverReportCreateRequest
	MetadataObject map[string]any
	MetadataJSON   []byte
}

type handoverReportPatchRequest struct {
	ID    int64   `json:"id"`
	State *string `json:"state"`
}

type validatedHandoverItem struct {
	handoverReportItemCreateRequest
	Report AgentWorklineReport
}

func normalizeHandoverReportCreate(input handoverReportCreateRequest) (normalizedHandoverReportCreate, error) {
	var normalized normalizedHandoverReportCreate
	var err error
	input.Title, err = normalizeBoundedText(input.Title, "title", maxReportTitleRunes)
	if err != nil {
		return normalized, err
	}
	input.SourceKind = strings.ToLower(strings.TrimSpace(input.SourceKind))
	if input.SourceKind == "" {
		input.SourceKind = "codex"
	}
	if !sourceKindPattern.MatchString(input.SourceKind) {
		return normalized, fmt.Errorf("invalid source_kind")
	}
	input.SourceRef = strings.TrimSpace(input.SourceRef)
	if utf8RuneCount(input.SourceRef) > maxReportSourceRunes {
		return normalized, fmt.Errorf("source_ref must be at most %d characters", maxReportSourceRunes)
	}
	input.Tags, err = normalizeReportTags(input.Tags)
	if err != nil {
		return normalized, err
	}
	if len(input.Items) == 0 || len(input.Items) > maxHandoverItems {
		return normalized, fmt.Errorf("items must contain 1-%d workline reports", maxHandoverItems)
	}

	seenWorklines := map[int64]struct{}{}
	seenReports := map[int64]struct{}{}
	for _, item := range input.Items {
		if item.WorklineID <= 0 || item.WorklineReportID <= 0 {
			return normalized, fmt.Errorf("item identifiers must be positive integers")
		}
		if _, exists := seenWorklines[item.WorklineID]; exists {
			return normalized, fmt.Errorf("handover may reference each workline only once")
		}
		if _, exists := seenReports[item.WorklineReportID]; exists {
			return normalized, fmt.Errorf("handover may reference each report only once")
		}
		seenWorklines[item.WorklineID] = struct{}{}
		seenReports[item.WorklineReportID] = struct{}{}
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

	secretValues := []string{input.Title, input.SourceRef, string(metadataJSON)}
	secretValues = append(secretValues, input.Tags...)
	if category := detectReportSecret(secretValues...); category != "" {
		return normalized, fmt.Errorf("handover_rejected_secret_detected:%s", category)
	}

	normalized.handoverReportCreateRequest = input
	normalized.MetadataObject = metadataObject
	normalized.MetadataJSON = metadataJSON
	return normalized, nil
}

func validateHandoverWorklineReport(report AgentWorklineReport, currentWorklineStatus string) error {
	if report.FormatVersion != 2 {
		return fmt.Errorf("handover_requires_structured_workline_checkpoint")
	}
	if _, ok := validPhaseGates[report.PhaseGate]; !ok {
		return fmt.Errorf("handover_requires_valid_phase_gate")
	}
	if report.CurrentPhase < 0 || report.CurrentPhase > 6 {
		return fmt.Errorf("handover_requires_valid_current_phase")
	}
	if report.WorklineStatusSnapshot != currentWorklineStatus {
		return fmt.Errorf("checkpoint_workline_status_is_stale")
	}
	if currentWorklineStatus == "active" || currentWorklineStatus == "paused" {
		if strings.TrimSpace(report.NextStepText) == "" {
			return fmt.Errorf("open_workline_checkpoint_requires_next_step")
		}
		return nil
	}
	if strings.TrimSpace(report.NextStepText) != "" {
		return fmt.Errorf("closed_workline_checkpoint_must_omit_next_step")
	}
	return nil
}

func handoverMembershipHash(items []validatedHandoverItem) string {
	parts := make([]string, 0, len(items))
	for _, item := range items {
		parts = append(parts, fmt.Sprintf(
			"%d:%d:%s:%s:%d",
			item.WorklineID,
			item.WorklineReportID,
			item.Report.ContentHash,
			item.Report.WorklineStatusSnapshot,
			item.Report.CurrentPhase,
		))
	}
	digest := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(digest[:])
}

var handoverWorklineStatusLabels = map[string]string{
	"paused": "tauolla", "closed": "suljettu", "archived": "arkistoitu",
}

// openPhaseSixWorklines names the open (active or paused) lines whose selected report is at phase 6.
// Phase 6 never closes a line: only the owner's acceptance does, or the line still has a remaining step.
func openPhaseSixWorklines(items []AgentHandoverReportItem) []string {
	var names []string
	for _, item := range items {
		status := item.Report.WorklineStatusSnapshot
		if item.Report.CurrentPhase == 6 && (status == "active" || status == "paused") {
			names = append(names, fmt.Sprintf("WL%d (%s)", item.Report.WorklineID, item.Report.WorklineTitle))
		}
	}
	return names
}

// renderHandoverMarkdown follows the chat status format: each workline is a level-two
// heading "<title> — WL<id> — <exact phase>", and nothing else uses a heading that large.
// Open phase-6 lines are named once above the sections, so a finished-looking line is not taken as closed.
func renderHandoverMarkdown(handover AgentHandoverReport) string {
	var builder strings.Builder
	builder.WriteString("**")
	builder.WriteString(handover.Title)
	builder.WriteString("**\n\n")
	builder.WriteString("Tämä on viimeisimmän chatin kanoninen jatkokonteksti. Jatka alla kuvatuista tiloista.\n")
	if open := openPhaseSixWorklines(handover.Items); len(open) > 0 {
		builder.WriteString("\n**Vaiheessa 6 mutta yhä avoinna:** ")
		builder.WriteString(strings.Join(open, ", "))
		builder.WriteString(". Vaihe 6 ei sulje linjaa: kukin odottaa omistajan hyväksyntää (`WL<n>: ok`) " +
			"tai raporttinsa seuraavaa askelta.\n")
	}
	for _, item := range handover.Items {
		builder.WriteString(fmt.Sprintf("\n## %s — WL%d — %d\n\n",
			item.Report.WorklineTitle, item.Report.WorklineID, item.Report.CurrentPhase))
		if status := item.Report.WorklineStatusSnapshot; status != "active" {
			label, known := handoverWorklineStatusLabels[status]
			if !known {
				label = status
			}
			builder.WriteString("_Työlinjan tila: ")
			builder.WriteString(label)
			builder.WriteString("._\n\n")
		}
		if item.Report.State != "final" {
			builder.WriteString("_Raportin nykytila: ")
			builder.WriteString(item.Report.State)
			builder.WriteString("._\n\n")
		}
		builder.WriteString(strings.TrimSpace(item.Report.Content))
		builder.WriteString("\n")
	}
	return strings.TrimSpace(builder.String()) + "\n"
}
