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
				WorklineTitle:          "Reporting",
				WorklineStatusSnapshot: "active",
				PhaseGate:              "3-4",
				State:                  "final",
				Content:                "**Konteksti:** Reports preserve context.\n\n**Selkokielellä:** Ready.",
			}},
		},
	}
	markdown := renderHandoverMarkdown(handover)
	for _, expected := range []string{"# Latest development handover", "## Reporting", "**Konteksti:**", "**Selkokielellä:**"} {
		if !strings.Contains(markdown, expected) {
			t.Fatalf("Markdown missing %q: %s", expected, markdown)
		}
	}
}
