// results_page_size_test.go
// Checks that trusted internal page sizes remain bounded and request-local.
// Connects Home's delegated context with the canonical reader's SQL limit input.
// Preserves the configured page size for ordinary and invalid internal requests.
package dtt_1_row_read

import (
	"context"
	"testing"
)

func TestResultsPageSizeTrustedBounds(t *testing.T) {
	ctx := context.Background()
	for _, size := range []int{-1, 0, 1, 3, 20, 21} {
		want := size
		if size < 1 || size > 20 {
			want = 0
		}
		if got := ResultsPageSizeFromContext(WithResultsPageSize(ctx, size)); got != want {
			t.Fatal(size, got)
		}
	}
	if ResultsPageSizeFromContext(ctx) != 0 {
		t.Fatal("page size escaped request")
	}
}
