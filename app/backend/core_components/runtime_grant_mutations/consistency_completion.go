// consistency_completion.go
// Reconciles a repair after the invalid metadata itself has been corrected.
// Retains the old target identities while using the repaired catalogue for blockers.
// Ordinary mutations still refuse old unknown side effects through Finish.
package runtime_grant_mutations

import (
	"context"
	"easelect/backend/core_components/runtime_grants"
)

// FinishRepair permits correcting a dangling row instead of refusing its former
// invalid state. Unresolved blockers in the repaired targets still refuse it.
func (m *Mutation) FinishRepair(ctx context.Context) error {
	if err := m.updateGuard.Check(ctx, m.Tx); err != nil {
		_ = m.Tx.Rollback()
		return err
	}
	after, err := runtime_grants.LoadMutationSnapshot(ctx, m.Tx, m.roles)
	if err != nil {
		_ = m.Tx.Rollback()
		return err
	}
	scope := runtime_grants.ChangedDatasetOIDs(m.before, after)
	if scope == nil {
		scope = []int64{}
	}
	_, err = runtime_grants.ReconcileRuntimeGrantsScoped(ctx, m.Tx, m.roles, nil, scope)
	if err != nil {
		_ = m.Tx.Rollback()
	}
	return err
}
