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
	wantPrivateRuntime := filepath.Clean(filepath.Join(projectRoot, "..", "filterest-runtime-data"))
	if privateHomes.RuntimeDataHome != wantPrivateRuntime {
		t.Fatalf("private RuntimeDataHome = %q, want %q", privateHomes.RuntimeDataHome, wantPrivateRuntime)
	}
	wantPrivateMaintainer := filepath.Clean(filepath.Join(projectRoot, "..", "filterest-maintainer-tools"))
	if privateHomes.MaintainerToolsHome != wantPrivateMaintainer {
		t.Fatalf("private MaintainerToolsHome = %q, want %q", privateHomes.MaintainerToolsHome, wantPrivateMaintainer)
	}
	wantPrivateOperations := filepath.Clean(filepath.Join(projectRoot, "..", "filterest-operations"))
	if privateHomes.OperationsHome != wantPrivateOperations {
		t.Fatalf("private OperationsHome = %q, want %q", privateHomes.OperationsHome, wantPrivateOperations)
	}

	publicHomes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolve public homes: %v", err)
	}
	wantPublic := filepath.Join(projectRoot, "filterest_projects")
	if publicHomes.ProjectsHome != wantPublic {
		t.Fatalf("public ProjectsHome = %q, want %q", publicHomes.ProjectsHome, wantPublic)
	}
	wantPublicRuntime := filepath.Join(projectRoot, "filterest_runtime_data")
	if publicHomes.RuntimeDataHome != wantPublicRuntime {
		t.Fatalf("public RuntimeDataHome = %q, want %q", publicHomes.RuntimeDataHome, wantPublicRuntime)
	}
	wantPublicMaintainer := filepath.Join(projectRoot, "filterest_maintainer_tools")
	if publicHomes.MaintainerToolsHome != wantPublicMaintainer {
		t.Fatalf("public MaintainerToolsHome = %q, want %q", publicHomes.MaintainerToolsHome, wantPublicMaintainer)
	}
	wantPublicOperations := filepath.Join(projectRoot, "filterest_operations")
	if publicHomes.OperationsHome != wantPublicOperations {
		t.Fatalf("public OperationsHome = %q, want %q", publicHomes.OperationsHome, wantPublicOperations)
	}
}

func TestResolveFilterestHomesDoesNotReinterpretExportedDefaultsAsOverrides(t *testing.T) {
	projectRoot := t.TempDir()
	t.Setenv("FILTEREST_PROJECTS_HOME", filepath.Join(projectRoot, "filterest_projects"))
	t.Setenv("FILTEREST_KEYS_HOME", filepath.Join(projectRoot, "filterest_keys"))
	t.Setenv("FILTEREST_RUNTIME_DATA_HOME", filepath.Join(projectRoot, "filterest_runtime_data"))
	t.Setenv("FILTEREST_MAINTAINER_TOOLS_HOME", filepath.Join(projectRoot, "filterest_maintainer_tools"))
	t.Setenv("FILTEREST_OPERATIONS_HOME", filepath.Join(projectRoot, "filterest_operations"))
	t.Setenv("FILTEREST_PROJECTS_HOME_CONFIGURED", "0")
	t.Setenv("FILTEREST_KEYS_HOME_CONFIGURED", "0")
	t.Setenv("FILTEREST_RUNTIME_DATA_HOME_CONFIGURED", "0")
	t.Setenv("FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED", "0")
	t.Setenv("FILTEREST_OPERATIONS_HOME_CONFIGURED", "0")

	homes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolveFilterestHomes() error = %v", err)
	}
	if homes.ProjectsHomeConfigured || homes.KeysHomeConfigured || homes.RuntimeDataHomeConfigured || homes.MaintainerToolsConfigured || homes.OperationsHomeConfigured {
		t.Fatalf("configured flags = %#v, want calculated defaults", homes)
	}
}

func TestResolveFilterestHomesKeepsExplicitEnvironmentOverrides(t *testing.T) {
	projectRoot := t.TempDir()
	projectsHome := filepath.Join(t.TempDir(), "projects")
	keysHome := filepath.Join(t.TempDir(), "keys")
	runtimeDataHome := filepath.Join(t.TempDir(), "runtime-data")
	maintainerToolsHome := filepath.Join(t.TempDir(), "maintainer-tools")
	operationsHome := filepath.Join(t.TempDir(), "operations")
	t.Setenv("FILTEREST_PROJECTS_HOME", projectsHome)
	t.Setenv("FILTEREST_KEYS_HOME", keysHome)
	t.Setenv("FILTEREST_RUNTIME_DATA_HOME", runtimeDataHome)
	t.Setenv("FILTEREST_MAINTAINER_TOOLS_HOME", maintainerToolsHome)
	t.Setenv("FILTEREST_OPERATIONS_HOME", operationsHome)
	t.Setenv("FILTEREST_PROJECTS_HOME_CONFIGURED", "1")
	t.Setenv("FILTEREST_KEYS_HOME_CONFIGURED", "1")
	t.Setenv("FILTEREST_RUNTIME_DATA_HOME_CONFIGURED", "1")
	t.Setenv("FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED", "1")
	t.Setenv("FILTEREST_OPERATIONS_HOME_CONFIGURED", "1")

	homes, err := resolveFilterestHomes(projectRoot, false)
	if err != nil {
		t.Fatalf("resolveFilterestHomes() error = %v", err)
	}
	if homes.ProjectsHome != projectsHome || homes.KeysHome != keysHome || homes.RuntimeDataHome != runtimeDataHome || homes.MaintainerToolsHome != maintainerToolsHome || homes.OperationsHome != operationsHome {
		t.Fatalf("homes = %#v, want explicit environment paths", homes)
	}
	if !homes.ProjectsHomeConfigured || !homes.KeysHomeConfigured || !homes.RuntimeDataHomeConfigured || !homes.MaintainerToolsConfigured || !homes.OperationsHomeConfigured {
		t.Fatalf("configured flags = %#v, want explicit overrides", homes)
	}
}

func TestResolveFilterestHomesAcceptsDynamicRelativeAndAbsolutePaths(t *testing.T) {
	projectRoot := t.TempDir()
	absoluteKeys := filepath.Join(t.TempDir(), "operator keys")
	absoluteRuntimeData := filepath.Join(t.TempDir(), "runtime data")
	absoluteMaintainerTools := filepath.Join(t.TempDir(), "maintainer tools")
	absoluteOperations := filepath.Join(t.TempDir(), "operations")
	config := strings.Join([]string{
		"schema_version=1",
		"projects_home=../customer projects",
		"keys_home=" + absoluteKeys,
		"runtime_data_home=" + absoluteRuntimeData,
		"maintainer_tools_home=" + absoluteMaintainerTools,
		"operations_home=" + absoluteOperations,
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
	if homes.RuntimeDataHome != absoluteRuntimeData {
		t.Fatalf("RuntimeDataHome = %q, want %q", homes.RuntimeDataHome, absoluteRuntimeData)
	}
	if homes.MaintainerToolsHome != absoluteMaintainerTools {
		t.Fatalf("MaintainerToolsHome = %q, want %q", homes.MaintainerToolsHome, absoluteMaintainerTools)
	}
	if homes.OperationsHome != absoluteOperations {
		t.Fatalf("OperationsHome = %q, want %q", homes.OperationsHome, absoluteOperations)
	}
	if !homes.ProjectsHomeConfigured || !homes.KeysHomeConfigured || !homes.RuntimeDataHomeConfigured || !homes.MaintainerToolsConfigured || !homes.OperationsHomeConfigured {
		t.Fatalf("configured flags = %#v, want all true", homes)
	}
}

func TestResolveFilterestHomesRejectsDangerousAndNestedPaths(t *testing.T) {
	projectRoot := t.TempDir()
	tests := []struct {
		name       string
		projects   string
		keys       string
		runtime    string
		maintainer string
		operations string
	}{
		{name: "checkout root", projects: ".", keys: "../keys", runtime: "runtime", maintainer: "maintainer", operations: "operations"},
		{name: "git", projects: ".git/projects", keys: "../keys", runtime: "runtime", maintainer: "maintainer"},
		{name: "same", projects: "../shared", keys: "../shared", runtime: "runtime", maintainer: "maintainer"},
		{name: "nested", projects: "../shared/projects", keys: "../shared", runtime: "runtime", maintainer: "maintainer"},
		{name: "runtime checkout root", projects: "projects", keys: "../keys", runtime: ".", maintainer: "maintainer"},
		{name: "runtime git", projects: "projects", keys: "../keys", runtime: ".git/runtime", maintainer: "maintainer"},
		{name: "runtime nested with projects", projects: "projects", keys: "../keys", runtime: "projects/runtime", maintainer: "maintainer"},
		{name: "runtime contains keys", projects: "projects", keys: "../shared/keys", runtime: "../shared", maintainer: "maintainer"},
		{name: "maintainer checkout root", projects: "projects", keys: "../keys", runtime: "runtime", maintainer: "."},
		{name: "maintainer git", projects: "projects", keys: "../keys", runtime: "runtime", maintainer: ".git/tools"},
		{name: "maintainer nested with projects", projects: "projects", keys: "../keys", runtime: "runtime", maintainer: "projects/tools"},
		{name: "operations checkout root", projects: "projects", keys: "../keys", runtime: "runtime", maintainer: "maintainer", operations: "."},
		{name: "operations git", projects: "projects", keys: "../keys", runtime: "runtime", maintainer: "maintainer", operations: ".git/operations"},
		{name: "operations nested with maintainer", projects: "projects", keys: "../keys", runtime: "runtime", maintainer: "maintainer", operations: "maintainer/operations"},
		{name: "pattern characters", projects: "projects[prod]", keys: "../keys", runtime: "runtime", maintainer: "maintainer"},
		{name: "control characters", projects: "projects\nprod", keys: "../keys", runtime: "runtime", maintainer: "maintainer"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			operations := test.operations
			if operations == "" {
				operations = "operations"
			}
			t.Setenv("FILTEREST_PROJECTS_HOME", test.projects)
			t.Setenv("FILTEREST_KEYS_HOME", test.keys)
			t.Setenv("FILTEREST_RUNTIME_DATA_HOME", test.runtime)
			t.Setenv("FILTEREST_MAINTAINER_TOOLS_HOME", test.maintainer)
			t.Setenv("FILTEREST_OPERATIONS_HOME", operations)
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
	t.Setenv("FILTEREST_RUNTIME_DATA_HOME", "runtime")

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
