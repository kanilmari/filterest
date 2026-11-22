//go:build !linux

// export_table_csv_access_other.go
// Keeps the CSV export portable where Linux ownership and ACL calls do not exist.
// Bridges the atomic CSV publication to platforms without POSIX ACL extended attributes.
// Exists so non-Linux development builds keep only an export's permission bits.
package devtools

import "os"

func csvOwner(os.FileInfo) (uid, gid int, ok bool) { return 0, 0, false }

func copyCSVAccessRules(string, string) error { return nil }
