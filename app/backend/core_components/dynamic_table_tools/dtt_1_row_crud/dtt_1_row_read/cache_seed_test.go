// cache_seed_test.go
// Seeds current-generation entries for metadata reader fixtures.
// Connects existing cache-hit tests to the guarded production setters.
// Production fills must capture their generation before reading the database.
package dtt_1_row_read

func setCachedSchemaMetadata(table string, entry *schemaCacheEntry) {
	setCachedSchemaMetadataAtGeneration(table, entry, schemaCacheGeneration(table))
}

func setCachedUserColumnSettings(user int, table, view string, entry *ucsCacheEntry) {
	setCachedUserColumnSettingsAtGeneration(user, table, view, entry, columnSettingsCacheGeneration(table))
}
