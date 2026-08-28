// table_csv_runtime_paths.go
// Resolves the mutable filesystem location for development CSV transfers.
// Bridges legacy Easelect roots and nested Filterest installations with one import/export path.
// Exists so CSV tools never create an extra tables_data tree beside or inside immutable app source.
package devtools

import (
	"path/filepath"

	"easelect/backend/core_components/runtimepaths"
)

func tableCSVDataDir() string {
	paths := runtimepaths.Current()
	if paths.LegacyFlat {
		return filepath.Join(paths.InstallationRoot, "tables_data")
	}
	return filepath.Join(paths.RuntimeRoot, "tables_data")
}

func tableCSVFilePath(tableName string) string {
	return filepath.Join(tableCSVDataDir(), tableName+".csv")
}
