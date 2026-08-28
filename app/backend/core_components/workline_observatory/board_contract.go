// board_contract.go
// Defines the read model for the visual development workline observatory.
// Bridges canonical worklines, immutable reports, ticket links, and release contracts.
// Exists so the browser receives one bounded snapshot without reconstructing workflow truth.
package workline_observatory

import "time"

type BoardSnapshot struct {
	GeneratedAt time.Time         `json:"generated_at"`
	Worklines   []BoardWorkline   `json:"worklines"`
	ReleaseGoal *BoardReleaseGoal `json:"release_goal"`
}

type BoardWorkline struct {
	ID                         int64                     `json:"id"`
	Title                      string                    `json:"title"`
	Status                     string                    `json:"status"`
	Tags                       []string                  `json:"tags"`
	UpdatedAt                  time.Time                 `json:"updated_at"`
	TaskIDs                    []int64                   `json:"task_ids"`
	CurrentPhase               int                       `json:"current_phase"`
	StatusRevision             int64                     `json:"status_revision"`
	StatusReconciliationNeeded bool                      `json:"status_reconciliation_needed"`
	LatestStatusChange         BoardWorklineStatusChange `json:"latest_status_change"`
	LatestReport               *BoardWorklineReport      `json:"latest_report"`
	Contract                   *BoardReleaseContract     `json:"release_contract"`
}

type BoardWorklineStatusChange struct {
	ChangedBy         *int      `json:"changed_by,omitempty"`
	ChangedByUsername string    `json:"changed_by_username,omitempty"`
	ChangedAt         time.Time `json:"changed_at"`
	Source            string    `json:"source"`
}

type BoardWorklineReport struct {
	ID                      int64     `json:"id"`
	Title                   string    `json:"title"`
	PhaseGate               string    `json:"phase_gate"`
	CurrentPhase            int       `json:"current_phase"`
	WorklineStatusSnapshot  string    `json:"workline_status_snapshot"`
	Context                 string    `json:"context"`
	PlainLanguage           string    `json:"plain_language"`
	Technical               string    `json:"technical"`
	NextStep                string    `json:"next_step"`
	GitHeadCommit           string    `json:"git_head_commit"`
	GitWorktreeState        string    `json:"git_worktree_state"`
	GitHasOtherChanges      bool      `json:"git_has_other_changes"`
	GitWorklineChangedPaths []string  `json:"git_workline_changed_paths"`
	CreatedAt               time.Time `json:"created_at"`
}

type BoardReleaseGoal struct {
	ID            int64                  `json:"id"`
	IdentityKey   string                 `json:"identity_key"`
	Version       int                    `json:"version"`
	Title         string                 `json:"title"`
	Outcome       string                 `json:"outcome"`
	DecisionState string                 `json:"decision_state"`
	Contracts     []BoardReleaseContract `json:"contracts"`
}

type BoardReleaseContract struct {
	ID             int64  `json:"id"`
	WorklineID     int64  `json:"workline_id"`
	CompletionRule string `json:"completion_rule"`
	TargetPhase    *int   `json:"target_phase"`
}
