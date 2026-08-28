// runtime_paths_test.go
// Verifies installation-layout and legacy runtime filesystem path resolution.
// Bridges the runtime-path API with overlap, symlink, and concurrency safeguards.
// Exists so mutable data cannot silently move into the immutable application tree.
package runtimepaths

import (
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func preserveCurrentPaths(t *testing.T) {
	t.Helper()
	original := Current()
	t.Cleanup(func() {
		configuredPaths.Store(original)
	})
}

func TestCurrentDefaultsToRelativeLegacyPaths(t *testing.T) {
	preserveCurrentPaths(t)
	configuredPaths.Store(Paths{
		InstallationRoot:   ".",
		ApplicationRoot:    ".",
		DataRoot:           ".",
		StorageRoot:        "storage",
		StorageDeletedRoot: "storage_deleted",
		RuntimeRoot:        "runtime",
		LegacyFlat:         true,
	})

	want := Paths{
		InstallationRoot:   ".",
		ApplicationRoot:    ".",
		DataRoot:           ".",
		StorageRoot:        "storage",
		StorageDeletedRoot: "storage_deleted",
		RuntimeRoot:        "runtime",
		LegacyFlat:         true,
	}
	if got := Current(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Current() = %#v, want %#v", got, want)
	}
}

func TestResolvePreservesLegacyFlatLayout(t *testing.T) {
	applicationRoot := filepath.Join(t.TempDir(), "app")
	installationRoot := filepath.Join(t.TempDir(), "installation")

	got, err := Resolve(applicationRoot, installationRoot, false)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	want := Paths{
		InstallationRoot:   installationRoot,
		ApplicationRoot:    applicationRoot,
		DataRoot:           installationRoot,
		StorageRoot:        filepath.Join(installationRoot, "storage"),
		StorageDeletedRoot: filepath.Join(installationRoot, "storage_deleted"),
		RuntimeRoot:        filepath.Join(installationRoot, "runtime"),
		LegacyFlat:         true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Resolve() = %#v, want %#v", got, want)
	}
}

func TestResolveBuildsExplicitInstallationLayout(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")

	got, err := Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	want := Paths{
		InstallationRoot:   installationRoot,
		ApplicationRoot:    applicationRoot,
		DataRoot:           filepath.Join(installationRoot, "data"),
		StorageRoot:        filepath.Join(installationRoot, "data", "storage"),
		StorageDeletedRoot: filepath.Join(installationRoot, "data", "storage_deleted"),
		RuntimeRoot:        filepath.Join(installationRoot, "data", "runtime"),
		LegacyFlat:         false,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Resolve() = %#v, want %#v", got, want)
	}
}

func TestResolveRequiresAbsoluteInputs(t *testing.T) {
	tests := []struct {
		name             string
		applicationRoot  string
		installationRoot string
	}{
		{name: "missing application", applicationRoot: "", installationRoot: "/srv/filterest"},
		{name: "relative application", applicationRoot: "app", installationRoot: "/srv/filterest"},
		{name: "missing installation", applicationRoot: "/srv/filterest/app", installationRoot: ""},
		{name: "relative installation", applicationRoot: "/srv/filterest/app", installationRoot: "filterest"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Resolve(test.applicationRoot, test.installationRoot, false); err == nil {
				t.Fatal("Resolve() error = nil, want absolute-path rejection")
			}
		})
	}
}

func TestResolveRejectsMutableRootsOverlappingApplication(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name             string
		applicationRoot  string
		installationRoot string
	}{
		{
			name:             "data inside application",
			applicationRoot:  root,
			installationRoot: filepath.Join(root, "installation"),
		},
		{
			name:             "application inside data",
			applicationRoot:  filepath.Join(root, "data", "app"),
			installationRoot: root,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Resolve(test.applicationRoot, test.installationRoot, true); err == nil {
				t.Fatal("Resolve() error = nil, want overlap rejection")
			}
		})
	}
}

func TestResolveRejectsMutableSymlinkIntoApplication(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := t.TempDir()
	if err := os.Symlink(applicationRoot, filepath.Join(installationRoot, "data")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	if _, err := Resolve(applicationRoot, installationRoot, true); err == nil {
		t.Fatal("Resolve() error = nil, want symlink overlap rejection")
	}
}

func TestConfigurePublishesValidatedSnapshotAndAllowsReconfiguration(t *testing.T) {
	preserveCurrentPaths(t)
	first, err := Resolve(
		filepath.Join(t.TempDir(), "app"),
		t.TempDir(),
		true,
	)
	if err != nil {
		t.Fatalf("Resolve(first) error = %v", err)
	}
	second, err := Resolve(
		filepath.Join(t.TempDir(), "app"),
		t.TempDir(),
		true,
	)
	if err != nil {
		t.Fatalf("Resolve(second) error = %v", err)
	}

	if err := Configure(first); err != nil {
		t.Fatalf("Configure(first) error = %v", err)
	}
	if got := Current(); !reflect.DeepEqual(got, first) {
		t.Fatalf("Current() after first configure = %#v, want %#v", got, first)
	}
	if err := Configure(second); err != nil {
		t.Fatalf("Configure(second) error = %v", err)
	}
	if got := Current(); !reflect.DeepEqual(got, second) {
		t.Fatalf("Current() after second configure = %#v, want %#v", got, second)
	}
}

func TestConfigureRejectsRelativeSnapshot(t *testing.T) {
	preserveCurrentPaths(t)
	paths := Paths{
		InstallationRoot:   "/srv/filterest",
		ApplicationRoot:    "/srv/filterest/app",
		DataRoot:           "/srv/filterest/data",
		StorageRoot:        "storage",
		StorageDeletedRoot: "/srv/filterest/data/storage_deleted",
		RuntimeRoot:        "/srv/filterest/data/runtime",
	}
	if err := Configure(paths); err == nil {
		t.Fatal("Configure() error = nil, want relative-path rejection")
	}
}

func TestConfigureRejectsOverlappingMutableLeafRoots(t *testing.T) {
	preserveCurrentPaths(t)
	installationRoot := t.TempDir()
	paths, err := Resolve(
		filepath.Join(installationRoot, "app"),
		installationRoot,
		true,
	)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	paths.StorageDeletedRoot = paths.StorageRoot

	if err := Configure(paths); err == nil {
		t.Fatal("Configure() error = nil, want mutable-root overlap rejection")
	}
}

func TestCurrentSupportsConcurrentReadersDuringReconfiguration(t *testing.T) {
	preserveCurrentPaths(t)
	first, err := Resolve(filepath.Join(t.TempDir(), "app"), t.TempDir(), true)
	if err != nil {
		t.Fatalf("Resolve(first) error = %v", err)
	}
	second, err := Resolve(filepath.Join(t.TempDir(), "app"), t.TempDir(), true)
	if err != nil {
		t.Fatalf("Resolve(second) error = %v", err)
	}
	if err := Configure(first); err != nil {
		t.Fatalf("Configure(first) error = %v", err)
	}

	var waitGroup sync.WaitGroup
	for reader := 0; reader < 8; reader++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for iteration := 0; iteration < 100; iteration++ {
				got := Current()
				if !reflect.DeepEqual(got, first) && !reflect.DeepEqual(got, second) {
					t.Errorf("Current() returned partial snapshot: %#v", got)
					return
				}
			}
		}()
	}
	if err := Configure(second); err != nil {
		t.Fatalf("Configure(second) error = %v", err)
	}
	waitGroup.Wait()
}
