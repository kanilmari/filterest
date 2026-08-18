// task_runs_test.go
// Tests DB-native task run normalization and validation helpers.
// Bridges API input aliases and the stored task run status vocabulary.
// Exists to keep the new run handler behavior stable without requiring live DB access.

package agent_tools

import "testing"

func TestNormalizeTaskRunStatusForDB(t *testing.T) {
	if got := normalizeTaskRunStatusForDB("awaiting_human_decision"); got != "awaiting_review" {
		t.Fatalf("expected awaiting_review, got %q", got)
	}
	if got := normalizeTaskRunStatusForDB("running"); got != "running" {
		t.Fatalf("expected running, got %q", got)
	}
}

func TestNormalizeTaskRunStatusForClient(t *testing.T) {
	if got := normalizeTaskRunStatusForClient("awaiting_review"); got != "awaiting_human_decision" {
		t.Fatalf("expected awaiting_human_decision, got %q", got)
	}
	if got := normalizeTaskRunStatusForClient("failed"); got != "failed" {
		t.Fatalf("expected failed, got %q", got)
	}
}

func TestNormalizeTaskRunTriggeredBy(t *testing.T) {
	if got := normalizeTaskRunTriggeredBy("queen"); got != "queen" {
		t.Fatalf("expected queen, got %q", got)
	}
	if got := normalizeTaskRunTriggeredBy("bogus"); got != "" {
		t.Fatalf("expected empty string for invalid trigger, got %q", got)
	}
}
