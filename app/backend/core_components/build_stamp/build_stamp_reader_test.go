// build_stamp_reader_test.go
// Checks source-pair validation independently from strict UTC build-time validation.
// Connects raw linker strings with the administrator's resolved build stamp.
// Prevents malformed or absent source metadata from claiming a clean commit.
package buildstamp

import (
	"strings"
	"testing"
)

func TestResolve(t *testing.T) {
	sha := strings.Repeat("a1", 20)
	const built = "2026-10-22T11:05:00Z"
	for _, tc := range []struct {
		name, commit, dirty, built, wantCommit, wantStatus, wantBuilt string
		wantDirty                                                     *bool
	}{
		{"clean", sha, "false", built, sha, "stamped", built, boolPointer(false)},
		{"dirty", sha, "true", built, sha, "stamped", built, boolPointer(true)},
		{"short", sha[:12], "false", built, "", "invalid", built, nil},
		{"uppercase", strings.ToUpper(sha), "false", built, "", "invalid", built, nil},
		{"sha256", strings.Repeat("a", 64), "false", built, "", "invalid", built, nil},
		{"source copy", "source-copy", "false", built, "", "invalid", built, nil},
		{"dirty without commit", "", "true", built, "", "invalid", built, nil},
		{"commit without dirty", sha, "", built, "", "invalid", built, nil},
		{"bad dirty", sha, "yes", built, "", "invalid", built, nil},
		{"impossible date", sha, "false", "2026-02-30T00:00:00Z", sha, "stamped", "", boolPointer(false)},
		{"offset", sha, "false", "2026-10-22T11:05:00+03:00", sha, "stamped", "", boolPointer(false)},
		{"space", sha, "true", "2026-10-22 11:05:00Z", sha, "stamped", "", boolPointer(true)},
		{"fraction", sha, "false", "2026-10-22T11:05:00.1Z", sha, "stamped", "", boolPointer(false)},
		{"leap day", sha, "false", "2024-02-29T00:00:00Z", sha, "stamped", "2024-02-29T00:00:00Z", boolPointer(false)},
		{"time only", "", "", built, "", "missing", built, nil},
		{"missing", "", "", "", "", "missing", "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Resolve(tc.commit, tc.dirty, tc.built)
			if got.GitCommitSHA != tc.wantCommit || got.SourceStatus != tc.wantStatus || got.BuiltAt != tc.wantBuilt {
				t.Fatalf("Resolve() = %+v, want commit %q, status %q, time %q", got, tc.wantCommit, tc.wantStatus, tc.wantBuilt)
			}
			if (got.SourceDirty == nil) != (tc.wantDirty == nil) ||
				(got.SourceDirty != nil && *got.SourceDirty != *tc.wantDirty) {
				t.Fatalf("SourceDirty = %v, want %v", got.SourceDirty, tc.wantDirty)
			}
		})
	}
}

func boolPointer(value bool) *bool { return &value }

func TestCurrentIsResolvedOnce(t *testing.T) {
	before := Current()
	oldCommit, oldDirty, oldBuilt := gitCommit, sourceDirty, builtAt
	t.Cleanup(func() { gitCommit, sourceDirty, builtAt = oldCommit, oldDirty, oldBuilt })
	gitCommit, sourceDirty, builtAt = strings.Repeat("f", 40), "true", "2000-01-01T00:00:00Z"
	after := Current()
	if before.GitCommitSHA != after.GitCommitSHA || before.SourceStatus != after.SourceStatus || before.BuiltAt != after.BuiltAt {
		t.Fatal("Current recomputed linker metadata")
	}
	if before.SourceDirty != nil {
		want := *before.SourceDirty
		*before.SourceDirty = !want
		if *Current().SourceDirty != want {
			t.Fatal("caller mutated the cached stamp")
		}
	}
}
