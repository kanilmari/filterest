// tree_rename_profile_test.go
// Keeps physical tree renames behind the administrator security profile.
// Checks the existing profile registry without changing pipeline assembly.
// Ordinary folder workflows retain their separately declared profiles.
package pipeline

import "testing"

func TestTreeRenameUsesAdministratorProfile(t *testing.T) {
	profile := GetProfile("dtt_system_table_folders.HandleRenameTreeNode")
	if !profile.AdminOnly || profile.SkipStages["transaction"] || profile.SkipStages["access_control"] {
		t.Fatal("tree rename lost administrator transaction boundary", profile)
	}
}
