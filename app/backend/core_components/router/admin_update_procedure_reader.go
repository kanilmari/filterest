// admin_update_procedure_reader.go
// Classifies the operator guidance supported by this installation's checkout.
// Bridges native Git metadata and Docker's launcher-supplied host branch evidence.
// Exists because runtime/release identity alone cannot distinguish main from a detached tag.
package router

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/runtimepaths"
)

// currentAdminUpdateProcedure is advisory, never an installability or authorization claim.
// Missing Git metadata, detached releases, other branches and direct Docker launches fail neutral.
func currentAdminUpdateProcedure(_ context.Context) string {
	branch := os.Getenv("FILTEREST_UPDATE_CHECKOUT_BRANCH")
	if currentAdminRuntimeMode() != adminRuntimeModeDocker {
		if runtimepaths.Current().LegacyFlat {
			return "site_operator"
		}
		branch = checkoutBranch(runtimepaths.Current().InstallationRoot)
	}
	if strings.TrimSpace(branch) == "main" {
		return "main_checkout"
	}
	return "site_operator"
}

// checkoutBranch reads HEAD without running Git, so an administrator request never starts a process.
// A linked worktree's .git file names its Git directory; a detached HEAD holds a hash and names no branch.
func checkoutBranch(root string) string {
	gitPath := filepath.Join(root, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return ""
	}
	gitDir := gitPath
	if !info.IsDir() {
		content, err := os.ReadFile(gitPath)
		if err != nil {
			return ""
		}
		line := strings.TrimSpace(string(content))
		if !strings.HasPrefix(line, "gitdir:") {
			return ""
		}
		gitDir = strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(root, gitDir)
		}
	}
	head, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return ""
	}
	ref := strings.TrimSpace(string(head))
	if !strings.HasPrefix(ref, "ref: refs/heads/") {
		return ""
	}
	return strings.TrimPrefix(ref, "ref: refs/heads/")
}
