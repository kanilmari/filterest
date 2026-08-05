package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveFilterestHomesKeepsPrivateAndPublicDefaultsDistinct(t *testing.T) {
	projectRoot := t.TempDir()

	privateHomes, err := resolveFilterestHomes(projectRoot, true)
	if err != nil {
		t.Fatalf("resolve private homes: %v", err)
	}
	wantPrivate := filepath.Clean(filepath.Join(projectRoot, "..", "filterest-projects"))
	if privateHomes.ProjectsHome != wantPrivate {
		t.Fatalf("private ProjectsHome = %q, want %q", privateHomes.ProjectsHome, wantPrivate)
	}

	publicHomes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolve public homes: %v", err)
	}
	wantPublic := filepath.Join(projectRoot, "filterest_projects")
	if publicHomes.ProjectsHome != wantPublic {
		t.Fatalf("public ProjectsHome = %q, want %q", publicHomes.ProjectsHome, wantPublic)
	}
}

func TestResolveFilterestHomesDoesNotReinterpretExportedDefaultsAsOverrides(t *testing.T) {
	projectRoot := t.TempDir()
	t.Setenv("FILTEREST_PROJECTS_HOME", filepath.Join(projectRoot, "filterest_projects"))
	t.Setenv("FILTEREST_KEYS_HOME", filepath.Join(projectRoot, "filterest_keys"))
	t.Setenv("FILTEREST_PROJECTS_HOME_CONFIGURED", "0")
	t.Setenv("FILTEREST_KEYS_HOME_CONFIGURED", "0")

	homes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolveFilterestHomes() error = %v", err)
	}
	if homes.ProjectsHomeConfigured || homes.KeysHomeConfigured {
		t.Fatalf("configured flags = %#v, want calculated defaults", homes)
	}
}

func TestResolveFilterestHomesKeepsExplicitEnvironmentOverrides(t *testing.T) {
	projectRoot := t.TempDir()
	projectsHome := filepath.Join(t.TempDir(), "projects")
	keysHome := filepath.Join(t.TempDir(), "keys")
	t.Setenv("FILTEREST_PROJECTS_HOME", projectsHome)
	t.Setenv("FILTEREST_KEYS_HOME", keysHome)
	t.Setenv("FILTEREST_PROJECTS_HOME_CONFIGURED", "1")
	t.Setenv("FILTEREST_KEYS_HOME_CONFIGURED", "1")

	homes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolveFilterestHomes() error = %v", err)
	}
	if homes.ProjectsHome != projectsHome || homes.KeysHome != keysHome {
		t.Fatalf("homes = %#v, want explicit environment paths", homes)
	}
	if !homes.ProjectsHomeConfigured || !homes.KeysHomeConfigured {
		t.Fatalf("configured flags = %#v, want explicit overrides", homes)
	}
}

func TestResolveFilterestHomesAcceptsDynamicRelativeAndAbsolutePaths(t *testing.T) {
	projectRoot := t.TempDir()
	absoluteKeys := filepath.Join(t.TempDir(), "operator keys")
	config := strings.Join([]string{
		"schema_version=1",
		"projects_home=../customer projects",
		"keys_home=" + absoluteKeys,
		"",
	}, "\n")
	if err := os.WriteFile(
		filepath.Join(projectRoot, filterestLocalPathsFile),
		[]byte(config),
		0o600,
	); err != nil {
		t.Fatalf("write locator: %v", err)
	}

	homes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolveFilterestHomes() error = %v", err)
	}
	wantProjects := filepath.Clean(filepath.Join(projectRoot, "..", "customer projects"))
	if homes.ProjectsHome != wantProjects {
		t.Fatalf("ProjectsHome = %q, want %q", homes.ProjectsHome, wantProjects)
	}
	if homes.KeysHome != absoluteKeys {
		t.Fatalf("KeysHome = %q, want %q", homes.KeysHome, absoluteKeys)
	}
	if !homes.ProjectsHomeConfigured || !homes.KeysHomeConfigured {
		t.Fatalf("configured flags = %#v, want both true", homes)
	}
}

func TestResolveFilterestHomesRejectsDangerousAndNestedPaths(t *testing.T) {
	projectRoot := t.TempDir()
	tests := []struct {
		name     string
		projects string
		keys     string
	}{
		{name: "checkout root", projects: ".", keys: "../keys"},
		{name: "git", projects: ".git/projects", keys: "../keys"},
		{name: "same", projects: "../shared", keys: "../shared"},
		{name: "nested", projects: "../shared/projects", keys: "../shared"},
		{name: "pattern characters", projects: "projects[prod]", keys: "../keys"},
		{name: "control characters", projects: "projects\nprod", keys: "../keys"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("FILTEREST_PROJECTS_HOME", test.projects)
			t.Setenv("FILTEREST_KEYS_HOME", test.keys)
			if _, err := resolveFilterestHomes(projectRoot, false); err == nil {
				t.Fatal("resolveFilterestHomes() error = nil, want rejection")
			}
		})
	}
}

func TestResolveFilterestHomesFollowsExistingSymlinkBoundary(t *testing.T) {
	projectRoot := t.TempDir()
	externalRoot := t.TempDir()
	link := filepath.Join(projectRoot, "operator-home")
	if err := os.Symlink(externalRoot, link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	t.Setenv("FILTEREST_PROJECTS_HOME", "projects")
	t.Setenv("FILTEREST_KEYS_HOME", "operator-home/keys")

	homes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolveFilterestHomes() error = %v", err)
	}
	want := filepath.Join(externalRoot, "keys")
	if homes.KeysHome != want {
		t.Fatalf("KeysHome = %q, want symlink-resolved %q", homes.KeysHome, want)
	}
}

func TestResolveFilterestHomesRejectsWritableLocalLocator(t *testing.T) {
	projectRoot := t.TempDir()
	locator := filepath.Join(projectRoot, filterestLocalPathsFile)
	if err := os.WriteFile(
		locator,
		[]byte("projects_home=projects\nkeys_home=keys\n"),
		0o666,
	); err != nil {
		t.Fatalf("write locator: %v", err)
	}
	if err := os.Chmod(locator, 0o666); err != nil {
		t.Fatalf("chmod locator: %v", err)
	}

	if _, err := resolveFilterestHomes(projectRoot, false); err == nil {
		t.Fatal("resolveFilterestHomes() error = nil, want writable-locator rejection")
	}
}
