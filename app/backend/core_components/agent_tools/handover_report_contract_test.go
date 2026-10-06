// handover_report_contract_test.go
// Verifies handover manifests use exact structured workline snapshots and safe aggregate rendering.
// Bridges ordered report references with the next-chat Markdown contract.
// Exists so handovers remain complete without duplicating mutable or unstructured chat prose.
package agent_tools

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeHandoverReportCreateRejectsDuplicateWorklines(t *testing.T) {
	_, err := normalizeHandoverReportCreate(handoverReportCreateRequest{
		Title: "Latest development handover",
		Items: []handoverReportItemCreateRequest{
			{WorklineID: 1, WorklineReportID: 10},
			{WorklineID: 1, WorklineReportID: 11},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "each workline only once") {
		t.Fatalf("error = %v", err)
	}
}

func TestNormalizeHandoverReportCreateScreensMetadataSecrets(t *testing.T) {
	credential := "sk-" + strings.Repeat("B8", 12)
	_, err := normalizeHandoverReportCreate(handoverReportCreateRequest{
		Title:    "Latest development handover",
		Metadata: json.RawMessage(`{"note":"` + credential + `"}`),
		Items:    []handoverReportItemCreateRequest{{WorklineID: 1, WorklineReportID: 10}},
	})
	if err == nil || strings.Contains(err.Error(), credential) {
		t.Fatalf("secret screening error = %v", err)
	}
}

func TestValidateHandoverWorklineReportRequiresCurrentStructuredSnapshot(t *testing.T) {
	report := AgentWorklineReport{
		FormatVersion:          2,
		PhaseGate:              "5-6",
		CurrentPhase:           5,
		WorklineStatusSnapshot: "active",
		NextStepText:           "Continue verification.",
	}
	if err := validateHandoverWorklineReport(report, "active"); err != nil {
		t.Fatalf("valid report rejected: %v", err)
	}
	if err := validateHandoverWorklineReport(report, "closed"); err == nil {
		t.Fatal("stale workline snapshot accepted")
	}
}

func TestRenderHandoverMarkdownRepeatsEachFullWorklineReport(t *testing.T) {
	handover := AgentHandoverReport{
		Title: "Latest development handover",
		Items: []AgentHandoverReportItem{
			{Report: AgentWorklineReport{
				WorklineID:             141,
				WorklineTitle:          "Reporting",
				WorklineStatusSnapshot: "active",
				PhaseGate:              "3-4",
				CurrentPhase:           4,
				State:                  "final",
				Content:                "**Konteksti:** Reports preserve context.\n\n**Selkokielellä:** Ready.",
			}},
			{Report: AgentWorklineReport{
				WorklineID:             70,
				WorklineTitle:          "Site projects",
				WorklineStatusSnapshot: "paused",
				PhaseGate:              "2",
				CurrentPhase:           2,
				State:                  "final",
				Content:                "**Konteksti:** Waiting.",
			}},
		},
	}
	markdown := renderHandoverMarkdown(handover)
	for _, expected := range []string{
		"**Latest development handover**\n\n",
		"\n## Reporting — WL141 — 4\n\n**Konteksti:**",
		"**Selkokielellä:**",
		"\n## Site projects — WL70 — 2\n\n_Työlinjan tila: tauolla._\n\n**Konteksti:** Waiting.",
	} {
		if !strings.Contains(markdown, expected) {
			t.Fatalf("Markdown missing %q: %s", expected, markdown)
		}
	}
	// The workline headings are the largest: no level-one heading, and an active line carries no status note.
	for _, line := range strings.Split(markdown, "\n") {
		if strings.HasPrefix(line, "# ") {
			t.Fatalf("Markdown has a heading larger than the workline headings: %q", line)
		}
	}
	if strings.Count(markdown, "_Työlinjan tila:") != 1 {
		t.Fatalf("status note expected only for the paused line: %s", markdown)
	}
	if strings.Contains(markdown, "Vaiheessa 6") {
		t.Fatalf("no line is at phase 6, yet the open phase-6 note was rendered: %s", markdown)
	}
}

func TestRenderHandoverMarkdownNamesOpenPhaseSixWorklines(t *testing.T) {
	line := func(id int64, title, status string, phase int) AgentHandoverReportItem {
		return AgentHandoverReportItem{Report: AgentWorklineReport{WorklineID: id, WorklineTitle: title,
			WorklineStatusSnapshot: status, PhaseGate: "5-6", CurrentPhase: phase, State: "final",
			Content: "**Konteksti:** " + title + "."}}
	}
	markdown := renderHandoverMarkdown(AgentHandoverReport{Title: "Jatkokonteksti", Items: []AgentHandoverReportItem{
		line(103, "Kategoriat", "active", 4),
		line(143, "Etusivu", "active", 6),
		line(119, "Asetukset", "closed", 6),
		line(121, "About-kuvatekstit", "paused", 6),
	}})
	want := "\n**Vaiheessa 6 mutta yhä avoinna:** WL143 (Etusivu), WL121 (About-kuvatekstit). Vaihe 6 ei sulje linjaa"
	if !strings.Contains(markdown, want) {
		t.Fatalf("open phase-6 lines not named once in order: %s", markdown)
	}
	// The note stands between the introduction and the first workline section, and only once.
	if strings.Count(markdown, "Vaiheessa 6 mutta yhä avoinna") != 1 ||
		strings.Index(markdown, "Vaiheessa 6") > strings.Index(markdown, "\n## Kategoriat — WL103 — 4") {
		t.Fatalf("open phase-6 note misplaced: %s", markdown)
	}
	if strings.Contains(markdown, "WL119 (") || strings.Contains(markdown, "WL103 (") {
		t.Fatalf("closed or unfinished line named among open phase-6 lines: %s", markdown)
	}
}
