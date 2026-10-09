// dataset_appearance_saver.go
// Keeps existing Go call sites on the shared persistence implementation.
// Connects administrator compatibility APIs with the result-reader store.
// Contains only aliases so every writer uses the same revision and lock boundary.
package system_table_tools

import store "easelect/backend/core_components/dataset_appearance_store"

type DatasetAppearanceSnapshot = store.DatasetAppearanceSnapshot
type DatasetAppearancePatch = store.DatasetAppearancePatch

var ReadDatasetAppearance = store.ReadDatasetAppearance
var SaveDatasetAppearance = store.SaveDatasetAppearance
var ResolveDatasetAppearance = store.ResolveDatasetAppearance
var decodeDatasetAppearanceSnapshot = store.DecodeDatasetAppearanceSnapshot
var ErrDatasetAppearanceConflict = store.ErrDatasetAppearanceConflict
var ErrDatasetAppearanceNotFound = store.ErrDatasetAppearanceNotFound
