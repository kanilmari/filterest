// with_lazy_transaction.go
// Pipeline stage that provides lazy database transactions to handlers.
// Bridges the database pool and handler context so connections are reserved only on first use.
// Exists to defer transaction creation until dbutils.RequireTx is called, committing or rolling back automatically.
// Keeping this as a pipeline stage makes transaction behavior visible to introspection and route profiles.
// Routes that never call dbutils.GetTx or dbutils.RequireTx pay no connection cost.
package lazy_transaction

import (
	"net/http"

	"easelect/backend/core_components/middlewares"
)

// WithLazyTx wraps a handler with a lazy transaction provider.
// This is the pipeline-compatible version (http.HandlerFunc signature)
// of middlewares.WithLazyTransaction.
func WithLazyTx(next http.HandlerFunc) http.HandlerFunc {
	return middlewares.WithLazyTransaction(next).ServeHTTP
}
