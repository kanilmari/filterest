// board_handler_test.go
// Verifies report-history identifiers are parsed fail-closed before database access.
// Bridges the shared board endpoint with its bounded per-workline history mode.
// Exists so malformed or cross-shape requests never fall through to the full board response.
package workline_observatory

import "testing"

func TestParseReportHistoryWorklineID(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"", "0", "-1", "1.5", "wl34", " 34"} {
		if _, err := parseReportHistoryWorklineID(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}

	worklineID, err := parseReportHistoryWorklineID("34")
	if err != nil {
		t.Fatalf("expected valid workline id: %v", err)
	}
	if worklineID != 34 {
		t.Fatalf("expected workline 34, got %d", worklineID)
	}
}
