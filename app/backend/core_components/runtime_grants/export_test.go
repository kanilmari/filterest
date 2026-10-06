// export_test.go
// Exposes existing fixture helpers only to external gallery integration tests.
// Keeps production runtime_grants free of handler imports and test hooks.
package runtime_grants

import (
	"easelect/backend/core_components/runtimepaths"
	"path/filepath"
	"testing"
)

var ReviewPostgresFixture = reviewPostgresFixture
var FixtureExec = fixtureExec
var ReadFixtureSnapshot = readFixtureSnapshot
var ApplyFixtureGrants = applyFixtureGrants
var GrantsFor = grantsFor
var GrantDisposableDB = grantDisposableDB
var ACLFingerprint = aclFingerprint

var ConfigureReviewRuntimePaths = configureReviewRuntimePaths

// Normalize the relative legacy defaults to an equivalent validated baseline
// before changing global paths. Cleanup must restore it and report any failure.
func configureReviewRuntimePaths(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	previous := runtimepaths.Current()
	for _, field := range []*string{&previous.InstallationRoot, &previous.ApplicationRoot, &previous.DataRoot, &previous.StorageRoot, &previous.StorageDeletedRoot, &previous.RuntimeRoot} {
		absolute, err := filepath.Abs(*field)
		if err != nil {
			t.Fatal(err)
		}
		*field = absolute
	}
	if err := runtimepaths.Configure(previous); err != nil {
		t.Fatalf("validate runtime-path baseline: %v", err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(previous); err != nil {
			t.Errorf("restore runtime-path baseline: %v", err)
		}
	})
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
}
