// subfolders.go
// Manages media subfolder structure for file uploads. Provides helpers for resolving and
// creating the correct subfolder path for a given table and column combination.
// Exists to keep generated media variants stored in predictable directories.
package media_utils

// RequiredSubfolders lists directory names expected under each media row.
var RequiredSubfolders = []string{"300", "1000", "2160", "original"}
