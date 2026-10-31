// read_budget_connection.go
// Returns an explicitly acquired optional-read connection after its transaction ends.
// Connects bounded pool acquisition with the request-owned LazyTx lifecycle.
// Failed acquisition/begin and successful commit/rollback all release the same slot.
package dbutils

func (lt *LazyTx) closeBudgetConnection() {
	if lt.budgetConnection != nil {
		_ = lt.budgetConnection.Close()
		lt.budgetConnection = nil
	}
}
