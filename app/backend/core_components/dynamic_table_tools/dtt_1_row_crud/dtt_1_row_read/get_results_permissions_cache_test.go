// Verifies that schema edits refresh derived SELECT columns for all affected roles.
package dtt_1_row_read

import (
	"testing"
	"time"
)

func TestInvalidatePermissionsCacheRefreshesOnlyEditedDataset(t *testing.T) {
	edited := "cache_test_edited"
	other := "cache_test_edited_other"
	roles := []string{"admin", "reader"}
	for _, role := range roles {
		setCachedPermissions(role, edited, &permCacheEntry{columns: []string{"title"}, cachedAt: time.Now()})
		setCachedPermissions(role, other, &permCacheEntry{columns: []string{"id"}, cachedAt: time.Now()})
	}
	t.Cleanup(func() {
		InvalidatePermissionsCache(edited)
		InvalidatePermissionsCache(other)
	})
	InvalidatePermissionsCache(edited)
	for _, role := range roles {
		if getCachedPermissions(role, edited) != nil {
			t.Fatalf("%s retained pre-DDL column list", role)
		}
		if getCachedPermissions(role, other) == nil {
			t.Fatalf("%s lost unrelated dataset column list", role)
		}
	}
	setCachedPermissions("admin", edited, &permCacheEntry{columns: []string{"title", "destination"}, cachedAt: time.Now()})
	refreshed := getCachedPermissions("admin", edited)
	if refreshed == nil || len(refreshed.columns) != 2 {
		t.Fatal("fresh column list unavailable after invalidation")
	}
	InvalidatePermissionsCache("")
	if getCachedPermissions("admin", edited) == nil {
		t.Fatal("empty target unexpectedly flushed unrelated permissions")
	}
}
