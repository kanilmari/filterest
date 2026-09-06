// agent_tools_adapter_test.go
// Protects the board ordering contract from lifecycle-state reordering.
// Bridges owner status actions with stable row geometry in the Observatory.
// Exists so marking a workline done cannot make that row jump elsewhere on screen.
package workline_observatory

import (
	"strings"
	"testing"
)

func TestBoardOrderingDoesNotGroupByLifecycleStatus(t *testing.T) {
	if strings.Contains(boardWorklinesQuery, "CASE WHEN w.status") {
		t.Fatal("board ordering must not move a row merely because its lifecycle status changed")
	}
	if !strings.Contains(boardWorklinesQuery, "ORDER BY w.updated DESC, w.id DESC") {
		t.Fatal("board ordering must remain deterministic without lifecycle grouping")
	}
	if strings.Contains(boardWorklinesQuery, "WHERE w.status IN") {
		t.Fatal("terminal worklines must remain visible as Observatory history")
	}
}

func TestReportHistoryIsBoundedAndIncludesEarlierStates(t *testing.T) {
	if !strings.Contains(boardWorklineReportHistoryQuery, "WHERE r.workline_id = $1") {
		t.Fatal("report history must be scoped to exactly one workline")
	}
	if strings.Contains(boardWorklineReportHistoryQuery, "r.state = 'final'") {
		t.Fatal("report history must preserve superseded and archived phase evidence")
	}
	if !strings.Contains(boardWorklineReportHistoryQuery, "ORDER BY r.created DESC, r.id DESC") {
		t.Fatal("report history must show the latest immutable report first")
	}
	if !strings.Contains(boardWorklineReportHistoryQuery, "LIMIT 100") {
		t.Fatal("report history must remain bounded")
	}
}
