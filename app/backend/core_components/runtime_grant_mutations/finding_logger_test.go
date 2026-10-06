// finding_logger_test.go
// Counts actual emitted INFO lines for a request beside thousands of diagnostics.
// The central logger keeps unrelated findings available only at DEBUG.
package runtime_grant_mutations

import (
	"bytes"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/runtime_grants"
)

func TestRequestOutsideLargeCatalogueLogsBoundedLines(t *testing.T) {
	t.Setenv("LOG_LEVEL", "info")
	var output bytes.Buffer
	logging.SetOutput(&output)
	t.Cleanup(func() { logging.SetOutput(os.Stderr) })
	result := runtime_grants.ReconcileResult{}
	for i := 0; i < 10000; i++ {
		result.Findings = append(result.Findings, runtime_grants.Finding{Object: fmt.Sprintf("outside_%d", i), Finding: "excess_read_reported"})
	}
	logMutationFindings(result)
	if output.Len() != 0 {
		t.Fatal("outside request emitted INFO catalogue lines", output.Len())
	}
	own := runtime_grants.Finding{Object: "own_dataset", Finding: "excess_read_reported"}
	refusing := runtime_grants.Finding{Object: "new_outside_blocker", Finding: "blocker"}
	result.Findings = append(result.Findings, own, refusing)
	result.RequestFindings = []runtime_grants.Finding{own, refusing}
	logMutationFindings(result)
	if lines := strings.Count(output.String(), "\n"); lines != 2 || !strings.Contains(output.String(), "own_dataset") || !strings.Contains(output.String(), "new_outside_blocker") {
		t.Fatal("INFO logs lost request finding or grew with catalogue", lines)
	}
	output.Reset()
	t.Setenv("LOG_LEVEL", "debug")
	logging.SetOutput(&output)
	logMutationFindings(runtime_grants.ReconcileResult{Findings: []runtime_grants.Finding{result.Findings[0]}})
	if !strings.Contains(output.String(), "DEBUG") || !strings.Contains(output.String(), "outside_0") {
		t.Fatal("outside findings unavailable at DEBUG", output.String())
	}
}

func TestMissingRequiredGrantReturnsTranslatedConflict(t *testing.T) {
	refused := &runtime_grants.ScopeBlocker{Findings: []runtime_grants.Finding{{Finding: "blocker", Reason: "required runtime grant absent after reconciliation"}}}
	rec := httptest.NewRecorder()
	RespondError(rec, fmt.Errorf("runtime grant postcheck failed: %w", refused))
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "error_runtime_grant_policy_blocked") {
		t.Fatal("missing grant was not a translated conflict", rec.Code, rec.Body.String())
	}
}
