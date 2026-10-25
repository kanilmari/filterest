// column_visibility_cache_test.go
// Proves late metadata fills cannot undo committed visibility invalidations.
// Covers schema, all users/views, field-set invalidation and cross-dataset joins.
// Uses no database, timers or permission shortcuts.
package dtt_1_row_read

import (
	"testing"
	"time"
)

func TestSchemaCacheRejectsFillStartedBeforeInvalidation(t *testing.T) {
	const dataset = "visibility_generation_schema"
	defer InvalidateSchemaCache(dataset)
	entry := &schemaCacheEntry{cachedAt: time.Now()}
	generation := schemaCacheGeneration(dataset) // Before the metadata read starts.
	setCachedSchemaMetadataAtGeneration(dataset, entry, generation)
	if getCachedSchemaMetadata(dataset) != entry {
		t.Fatal("current-generation schema fill was not cached")
	}
	InvalidateSchemaCache(dataset)
	setCachedSchemaMetadataAtGeneration(dataset, entry, generation) // Old read completes late.
	if getCachedSchemaMetadata(dataset) != nil {
		t.Fatal("pre-invalidation schema fill restored stale delivery metadata")
	}
	setCachedSchemaMetadataAtGeneration(dataset, entry, schemaCacheGeneration(dataset))
	if getCachedSchemaMetadata(dataset) != entry {
		t.Fatal("fresh schema fill was rejected")
	}
}

func TestColumnSettingsCacheRejectsFillStartedBeforeInvalidation(t *testing.T) {
	const dataset = "visibility_generation_settings"
	for _, invalidate := range []struct {
		name string
		run  func()
	}{
		{"visibility", func() { invalidateColumnVisibilityCaches(dataset) }},
		{"field set", func() { InvalidateUserColumnSettingsCache(dataset, "card") }},
		{"global", func() { InvalidateUserColumnSettingsCache("", "") }},
	} {
		t.Run(invalidate.name, func(t *testing.T) {
			defer invalidateColumnVisibilityCaches(dataset)
			entry := &ucsCacheEntry{settings: []UserColumnSetting{{ColumnName: "private_value"}}, cachedAt: time.Now()}
			generation := columnSettingsCacheGeneration(dataset)
			setCachedUserColumnSettingsAtGeneration(42, dataset, "card", entry, generation)
			if getCachedUserColumnSettings(42, dataset, "card") != entry {
				t.Fatal("current-generation settings fill was not cached")
			}
			invalidate.run()
			setCachedUserColumnSettingsAtGeneration(42, dataset, "card", entry, generation)
			if getCachedUserColumnSettings(42, dataset, "card") != nil {
				t.Fatal("pre-invalidation settings fill restored a hidden field")
			}
			setCachedUserColumnSettingsAtGeneration(42, dataset, "card", entry, columnSettingsCacheGeneration(dataset))
			if getCachedUserColumnSettings(42, dataset, "card") != entry {
				t.Fatal("fresh settings fill was rejected")
			}
		})
	}
}

func TestColumnVisibilityInvalidationScopesAllUsersAndViews(t *testing.T) {
	const changed, other = "visibility_changed", "visibility_unchanged"
	defer invalidateColumnVisibilityCaches(changed)
	defer invalidateColumnVisibilityCaches(other)
	for _, dataset := range []string{changed, other} {
		setCachedSchemaMetadata(dataset, &schemaCacheEntry{cachedAt: time.Now()})
		for _, user := range []int{42, 73} {
			for _, view := range []string{"card", "table", "article_view"} {
				setCachedUserColumnSettings(user, dataset, view, &ucsCacheEntry{cachedAt: time.Now()})
			}
		}
	}
	schemaGeneration := schemaCacheGeneration(changed)
	joinGeneration := joinMetadataGeneration()
	invalidateColumnVisibilityCaches(changed)
	setCachedSchemaMetadataAtGeneration(changed, &schemaCacheEntry{cachedAt: time.Now()}, schemaGeneration)
	setCachedJoinMetadataAtGeneration(other, joinMetadataCacheEntry{tableUID: "1"}, joinGeneration)
	if getCachedSchemaMetadata(changed) != nil || getCachedSchemaMetadata(other) == nil {
		t.Fatal("visibility invalidation restored old schema or evicted another dataset")
	}
	if _, found := getCachedJoinMetadata(other); found {
		t.Fatal("referencing dataset restored old title visibility")
	}
	for _, user := range []int{42, 73} {
		for _, view := range []string{"card", "table", "article_view"} {
			if getCachedUserColumnSettings(user, changed, view) != nil || getCachedUserColumnSettings(user, other, view) == nil {
				t.Fatalf("invalid settings scope for user %d view %s", user, view)
			}
		}
	}
}

func TestSchemaOnlyInvalidationPreservesColumnSettings(t *testing.T) {
	const dataset = "visibility_presentation_only"
	defer invalidateColumnVisibilityCaches(dataset)
	generation := columnSettingsCacheGeneration(dataset)
	entry := &ucsCacheEntry{cachedAt: time.Now()}
	setCachedUserColumnSettingsAtGeneration(42, dataset, "card", entry, generation)
	InvalidateSchemaCache(dataset)
	if getCachedUserColumnSettings(42, dataset, "card") != entry {
		t.Fatal("presentation-only schema invalidation flushed field settings")
	}
	setCachedUserColumnSettingsAtGeneration(73, dataset, "table", entry, generation)
	if getCachedUserColumnSettings(73, dataset, "table") != entry {
		t.Fatal("presentation-only schema invalidation changed the settings generation")
	}
}
