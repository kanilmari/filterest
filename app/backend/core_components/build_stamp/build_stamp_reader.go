// build_stamp_reader.go
// Resolves explicit linker metadata into a validated source pair and UTC build time.
// Connects native, release and image builds with the administrator version API.
// Keeps missing or malformed metadata honest without borrowing Go's main-module VCS data.
package buildstamp

import (
	"regexp"
	"time"
)

var gitCommit, sourceDirty, builtAt string

var (
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	utcPattern    = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`)
	currentStamp  = Resolve(gitCommit, sourceDirty, builtAt)
)

// Stamp holds independently validated source attribution and build time.
// SourceDirty is nil whenever the commit/dirty pair is unknown.
type Stamp struct {
	GitCommitSHA string `json:"git_commit_sha"`
	SourceDirty  *bool  `json:"source_dirty"`
	BuiltAt      string `json:"built_at"`
	SourceStatus string `json:"source_status"`
}

// Resolve validates a source pair and, independently, a strict real UTC time.
// SourceStatus describes the source pair; an invalid time blanks only BuiltAt.
func Resolve(commit, dirty, built string) Stamp {
	stamp := Stamp{SourceStatus: "missing"}
	if commitPattern.MatchString(commit) && (dirty == "true" || dirty == "false") {
		modified := dirty == "true"
		stamp.GitCommitSHA, stamp.SourceDirty, stamp.SourceStatus = commit, &modified, "stamped"
	} else if commit != "" || dirty != "" {
		stamp.SourceStatus = "invalid"
	}
	const layout = "2006-01-02T15:04:05Z"
	if utcPattern.MatchString(built) {
		if parsed, err := time.Parse(layout, built); err == nil && parsed.Format(layout) == built {
			stamp.BuiltAt = built
		}
	}
	return stamp
}

// Current returns the stamp resolved once at package initialization.
// Copy the optional boolean so callers cannot mutate the cached result.
func Current() Stamp {
	stamp := currentStamp
	if stamp.SourceDirty != nil {
		modified := *stamp.SourceDirty
		stamp.SourceDirty = &modified
	}
	return stamp
}
