// admin_update_procedure_reader_test.go
// Verifies main-checkout guidance and neutral fallback without contacting a service.
// Bridges temporary local Git metadata and Docker's host-branch evidence to admin payloads.
// Exists to prevent detached releases or managed installations from receiving the generic updater.
package router

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

func TestCurrentAdminUpdateProcedureDocker(t *testing.T) {
	t.Setenv("EASELECT_RUNTIME_MODE", "docker")
	for _, test := range []struct{ branch, want string }{
		{"main", "main_checkout"}, {"", "site_operator"}, {"HEAD", "site_operator"},
		{"v9.3.21", "site_operator"}, {"wl147-update-box", "site_operator"},
	} {
		t.Run(test.branch, func(t *testing.T) {
			t.Setenv("FILTEREST_UPDATE_CHECKOUT_BRANCH", test.branch)
			if got := currentAdminUpdateProcedure(context.Background()); got != test.want {
				t.Fatalf("branch %q: procedure = %q, want %q", test.branch, got, test.want)
			}
		})
	}
}

func TestCurrentAdminUpdateProcedureNative(t *testing.T) {
	t.Setenv("EASELECT_RUNTIME_MODE", "native")
	t.Setenv("FILTEREST_UPDATE_CHECKOUT_BRANCH", "main") // Native must inspect its own checkout.
	originalPaths := runtimepaths.Current()
	t.Cleanup(func() { _ = runtimepaths.Configure(originalPaths) })
	root := t.TempDir()
	paths, err := runtimepaths.Resolve(filepath.Join(root, "app"), root, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	if got := currentAdminUpdateProcedure(context.Background()); got != "site_operator" {
		t.Fatalf("Gitless procedure = %q", got)
	}
	if output, err := exec.Command("git", "-C", root, "init", "--initial-branch=main").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	if got := currentAdminUpdateProcedure(context.Background()); got != "main_checkout" {
		t.Fatalf("main procedure = %q", got)
	}
	for _, head := range []string{
		"ref: refs/heads/wl147-update-box\n", "0123456789abcdef0123456789abcdef01234567\n",
	} {
		if err := os.WriteFile(filepath.Join(root, ".git", "HEAD"), []byte(head), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := currentAdminUpdateProcedure(context.Background()); got != "site_operator" {
			t.Fatalf("head %q: procedure = %q", head, got)
		}
	}
	// A linked worktree keeps "gitdir: <path>" in a .git file; HEAD is read without running Git.
	gitDir := filepath.Join(t.TempDir(), "worktree-git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git"), []byte("gitdir: "+gitDir+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir()) // No Git binary is needed.
	if got := currentAdminUpdateProcedure(context.Background()); got != "main_checkout" {
		t.Fatalf("worktree main procedure = %q", got)
	}
}
