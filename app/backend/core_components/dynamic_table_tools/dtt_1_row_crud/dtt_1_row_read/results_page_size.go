// results_page_size.go
// Carries a bounded internal page size into the canonical dataset reader.
// Connects Home's trusted row cap with the query builder's SQL LIMIT.
// Keeps this override out of user-controlled URL filters and shared configuration.
package dtt_1_row_read

import "context"

type resultsPageSizeKey struct{}

// WithResultsPageSize returns a request context with a trusted 1–20 row page size.
// Invalid values leave the existing context unchanged.
func WithResultsPageSize(ctx context.Context, size int) context.Context {
	if size < 1 || size > 20 {
		return ctx
	}
	return context.WithValue(ctx, resultsPageSizeKey{}, size)
}

// ResultsPageSizeFromContext returns zero for ordinary collection reads.
func ResultsPageSizeFromContext(ctx context.Context) int {
	size, _ := ctx.Value(resultsPageSizeKey{}).(int)
	return size
}
