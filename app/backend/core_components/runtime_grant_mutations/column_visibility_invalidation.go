// column_visibility_invalidation.go
// Schedules scoped eviction for writes of row visibility and delivery flags.
// Connects generic metadata mutations and dedicated card saves to registered readers.
// Never clears caches before commit or for unrelated metadata saves.
package runtime_grant_mutations

import (
	"context"
	"fmt"
	"sync"

	"easelect/backend/core_components/dbutils"
)

var columnVisibilityInvalidators struct {
	sync.RWMutex
	hooks []func(string)
}

// RegisterColumnVisibilityCacheInvalidator connects dependent readers at startup.
// Callbacks execute synchronously after commit and must not perform database I/O.
func RegisterColumnVisibilityCacheInvalidator(invalidate func(string)) {
	columnVisibilityInvalidators.Lock()
	defer columnVisibilityInvalidators.Unlock()
	columnVisibilityInvalidators.hooks = append(columnVisibilityInvalidators.hooks, invalidate)
}

// ScheduleColumnVisibilityCacheInvalidation shares the request's commit boundary.
// Visibility writes require a commit-hook context; a raw transaction cannot
// report success while leaving readers stale after its caller commits.
func ScheduleColumnVisibilityCacheInvalidation(ctx context.Context, datasets ...string) error {
	if len(datasets) == 0 {
		return nil
	}
	if !dbutils.RegisterAfterCommitHook(ctx, func() {
		columnVisibilityInvalidators.RLock()
		hooks := append([]func(string){}, columnVisibilityInvalidators.hooks...)
		columnVisibilityInvalidators.RUnlock()
		for _, dataset := range datasets {
			for _, invalidate := range hooks {
				invalidate(dataset)
			}
		}
	}) {
		return fmt.Errorf("column visibility writes require a post-commit hook context")
	}
	return nil
}

func (m *Mutation) scheduleColumnVisibilityInvalidation(ctx context.Context, targets []int64) error {
	if !m.columnVisibilityWritten {
		return nil
	}
	seen := make(map[int64]bool)
	var names []string
	for _, uid := range targets {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		var name string
		if err := m.Tx.QueryRowContext(ctx, `SELECT table_name FROM public.system_db_tables WHERE table_uid=$1`, uid).Scan(&name); err != nil {
			return err
		}
		names = append(names, name)
	}
	return ScheduleColumnVisibilityCacheInvalidation(ctx, names...)
}
