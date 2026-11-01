// instance_info.go
// Describes a mirror or preview instance for its bottom-left instance badge (plan §2.2, K523).
// Bridges the mirror tool's record file with a read-only public endpoint and the page templates.
// Exists only where the runtime flag names a record: production never sets it, so there is no route there.
package instance_info

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"easelect/backend/core_components/httpresponse"
)

// RecordEnv is the runtime flag: an absolute path to the mirror tool's record. Unset or empty means OFF, so the
// route is not registered (404) and no page includes the badge.
const RecordEnv = "FILTEREST_INSTANCE_INFO_FILE"

// RecordFormat is the only record format this release reads. The mirror tool writes:
//
//	{"format": "filterest-instance-info-v1", "kind": "mirror" | "preview",
//	 "source": {"type": "main", "commit": "<sha>", "committed_at": "<RFC 3339>"}
//	         | {"type": "stack", "items": [{"batch": "564", "commit": "<sha>", "committed_at": "<RFC 3339>"}, …]}
//	         | {"type": "worktree" | "branch", "name": "<folder or branch name>", "commit": "<sha>", "committed_at": …},
//	 "data": {"source": "nightly" | "copy", "backup_at": "<RFC 3339>", "copied_at": "<RFC 3339, copies only>"},
//	 "refreshed_at": "<RFC 3339>"}
//
// Only those fields pass, each only in its own shape (commits shortened to 8 hex, names and batch numbers by
// pattern, times as RFC 3339), so no path, secret or data value can reach a page.
const RecordFormat = "filterest-instance-info-v1"

const (
	maxRecordBytes = 16 << 10
	maxStackItems  = 8
)

var (
	commitPattern = regexp.MustCompile(`^[0-9a-f]{7,40}$`)
	batchPattern  = regexp.MustCompile(`^[0-9]{1,5}$`)
	namePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
)

// Item is one batch of a stacked preview.
type Item struct {
	Batch       string `json:"batch"`
	Commit      string `json:"commit"`
	CommittedAt string `json:"committed_at,omitempty"`
}

// Source is the code the instance runs.
type Source struct {
	Type        string `json:"type"`
	Name        string `json:"name,omitempty"`
	Commit      string `json:"commit,omitempty"`
	CommittedAt string `json:"committed_at,omitempty"`
	Items       []Item `json:"items,omitempty"`
}

// Data is where the instance's data came from.
type Data struct {
	Source   string `json:"source"`
	BackupAt string `json:"backup_at,omitempty"`
	CopiedAt string `json:"copied_at,omitempty"`
}

// Info is the sanitized description the endpoint returns. Kind "unknown" means the record is missing or unreadable:
// the badge still marks the instance as not production.
type Info struct {
	Kind        string  `json:"kind"`
	Source      *Source `json:"source,omitempty"`
	Data        *Data   `json:"data,omitempty"`
	RefreshedAt string  `json:"refreshed_at,omitempty"`
}

type rawRecord struct {
	Format string `json:"format"`
	Kind   string `json:"kind"`
	Source *struct {
		Type        string `json:"type"`
		Name        string `json:"name"`
		Commit      string `json:"commit"`
		CommittedAt string `json:"committed_at"`
		Items       []struct {
			Batch       string `json:"batch"`
			Commit      string `json:"commit"`
			CommittedAt string `json:"committed_at"`
		} `json:"items"`
	} `json:"source"`
	Data *struct {
		Source   string `json:"source"`
		BackupAt string `json:"backup_at"`
		CopiedAt string `json:"copied_at"`
	} `json:"data"`
	RefreshedAt string `json:"refreshed_at"`
}

// RecordPath is the flag's record path, or "" when the flag is off (unset, empty or not absolute).
func RecordPath() string {
	path := strings.TrimSpace(os.Getenv(RecordEnv))
	if path == "" || !filepath.IsAbs(path) {
		return ""
	}
	return filepath.Clean(path)
}

// Enabled reports whether this process runs as a mirror or preview instance with a badge.
func Enabled() bool {
	return RecordPath() != ""
}

// Load reads and sanitizes the record. It never fails: an unreadable or foreign record gives Kind "unknown".
func Load(path string) Info {
	file, err := os.Open(path)
	if err != nil {
		return Info{Kind: "unknown"}
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, maxRecordBytes+1))
	if err != nil || len(body) > maxRecordBytes {
		return Info{Kind: "unknown"}
	}
	var raw rawRecord
	if err := json.Unmarshal(body, &raw); err != nil {
		return Info{Kind: "unknown"}
	}
	return sanitize(raw)
}

func sanitize(raw rawRecord) Info {
	if raw.Format != RecordFormat || (raw.Kind != "mirror" && raw.Kind != "preview") {
		return Info{Kind: "unknown"}
	}
	info := Info{Kind: raw.Kind, RefreshedAt: timestamp(raw.RefreshedAt)}
	if s := raw.Source; s != nil {
		source := &Source{Type: s.Type}
		switch s.Type {
		case "main":
			source.Commit, source.CommittedAt = commit(s.Commit), timestamp(s.CommittedAt)
		case "worktree", "branch":
			if namePattern.MatchString(s.Name) {
				source.Name = s.Name
			}
			source.Commit, source.CommittedAt = commit(s.Commit), timestamp(s.CommittedAt)
		case "stack":
			for _, item := range s.Items {
				if len(source.Items) == maxStackItems {
					break
				}
				if batchPattern.MatchString(item.Batch) && commit(item.Commit) != "" {
					source.Items = append(source.Items, Item{Batch: item.Batch, Commit: commit(item.Commit),
						CommittedAt: timestamp(item.CommittedAt)})
				}
			}
		default:
			source = nil
		}
		info.Source = source
	}
	if d := raw.Data; d != nil && (d.Source == "nightly" || d.Source == "copy") {
		data := &Data{Source: d.Source, BackupAt: timestamp(d.BackupAt)}
		if d.Source == "copy" {
			data.CopiedAt = timestamp(d.CopiedAt)
		}
		info.Data = data
	}
	return info
}

func commit(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if !commitPattern.MatchString(value) {
		return ""
	}
	if len(value) > 8 {
		return value[:8]
	}
	return value
}

func timestamp(value string) string {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return ""
	}
	return parsed.Format(time.RFC3339)
}

// Handler answers GET /api/instance-info with the sanitized record. The route exists only while the flag is on;
// the check here keeps a stale registration from answering after the flag is gone.
func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	path := RecordPath()
	if path == "" {
		httpresponse.RespondWithError(w, http.StatusNotFound, "not found")
		return
	}
	info := Load(path)
	if info.Kind == "unknown" {
		log.Printf("instance info: the record named by %s is missing or not %s", RecordEnv, RecordFormat)
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, info)
}
