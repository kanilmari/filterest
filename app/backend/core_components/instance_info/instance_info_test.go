// instance_info_test.go
// Proves the instance record reaches the page only in its allowed shapes, and only while the flag is on.
// Bridges sample mirror-tool records with the handler's HTTP answers.
// Protects production (flag off: 404) and the badge from paths, secrets and data values.
package instance_info

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeRecord(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "instance_info.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func serve(t *testing.T) (int, Info, string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	Handler(recorder, httptest.NewRequest(http.MethodGet, "/api/instance-info", nil))
	var info Info
	if recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), &info); err != nil {
			t.Fatalf("answer is not JSON: %v", err)
		}
	}
	return recorder.Code, info, recorder.Body.String()
}

func TestFlagOffMeansNoEndpointAndNoBadge(t *testing.T) {
	for _, value := range []string{"", "   ", "relative/instance_info.json"} {
		t.Setenv(RecordEnv, value)
		if Enabled() {
			t.Fatalf("%q must not enable the badge", value)
		}
		if code, _, _ := serve(t); code != http.StatusNotFound {
			t.Fatalf("flag %q: want 404, got %d", value, code)
		}
	}
}

func TestMainSourceIsShortenedAndTimesKept(t *testing.T) {
	t.Setenv(RecordEnv, writeRecord(t, `{"format":"filterest-instance-info-v1","kind":"mirror",
		"source":{"type":"main","commit":"3B95D8C7E1F2A3B4C5D6E7F8091A2B3C4D5E6F70","committed_at":"2026-10-24T17:36:00+03:00"},
		"data":{"source":"nightly","backup_at":"2026-10-24T04:20:00+03:00"},"refreshed_at":"2026-10-24T18:05:00+03:00"}`))
	code, info, _ := serve(t)
	if code != http.StatusOK || info.Kind != "mirror" || info.Source == nil || info.Source.Commit != "3b95d8c7" ||
		info.Source.CommittedAt != "2026-10-24T17:36:00+03:00" || info.Data == nil || info.Data.Source != "nightly" ||
		info.Data.BackupAt != "2026-10-24T04:20:00+03:00" || info.Data.CopiedAt != "" ||
		info.RefreshedAt != "2026-10-24T18:05:00+03:00" {
		t.Fatalf("unexpected answer %d %+v %+v %+v", code, info, info.Source, info.Data)
	}
}

func TestStackKeepsOnlyWellFormedBatches(t *testing.T) {
	items := `{"batch":"564","commit":"c1f0a2b4","committed_at":"2026-10-23T15:02:00+03:00"},` +
		`{"batch":"565","commit":"7d3e9a10ff"},{"batch":"../x","commit":"aaaaaaaa"},{"batch":"566","commit":"not-a-sha"}`
	for i := 0; i < 12; i++ {
		items += `,{"batch":"9` + string(rune('0'+i%10)) + `","commit":"abcdef12"}`
	}
	t.Setenv(RecordEnv, writeRecord(t, `{"format":"filterest-instance-info-v1","kind":"preview",
		"source":{"type":"stack","items":[`+items+`]},"data":{"source":"copy","backup_at":"2026-10-23T04:20:00+03:00",
		"copied_at":"2026-10-23T16:00:00+03:00"}}`))
	_, info, _ := serve(t)
	if info.Kind != "preview" || info.Source == nil || len(info.Source.Items) != maxStackItems {
		t.Fatalf("unexpected stack %+v", info.Source)
	}
	if first, second := info.Source.Items[0], info.Source.Items[1]; first.Batch != "564" || first.Commit != "c1f0a2b4" ||
		second.Batch != "565" || second.Commit != "7d3e9a10" || second.CommittedAt != "" {
		t.Fatalf("unexpected items %+v %+v", first, second)
	}
	if info.Data == nil || info.Data.CopiedAt != "2026-10-23T16:00:00+03:00" {
		t.Fatalf("a copy keeps its copy time: %+v", info.Data)
	}
}

func TestNoPathSecretOrForeignFieldReachesTheAnswer(t *testing.T) {
	t.Setenv(RecordEnv, writeRecord(t, `{"format":"filterest-instance-info-v1","kind":"preview",
		"source":{"type":"worktree","name":"/home/user/GitHub/secret-tree","commit":"abcdef1234","committed_at":"yesterday"},
		"data":{"source":"nightly","backup_at":"2026-10-23T04:20:00Z","copied_at":"2026-10-23T05:00:00Z"},
		"database_password":"hunter2","path":"/home/user/.ssh/id_ed25519","refreshed_at":"<script>"}`))
	_, info, body := serve(t)
	for _, leaked := range []string{"/home/user", "secret-tree", "hunter2", "id_ed25519", "script", "yesterday"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("answer leaks %q: %s", leaked, body)
		}
	}
	if info.Source == nil || info.Source.Type != "worktree" || info.Source.Name != "" || info.Source.Commit != "abcdef12" {
		t.Fatalf("unexpected worktree source %+v", info.Source)
	}
	if info.Data == nil || info.Data.CopiedAt != "" {
		t.Fatalf("a nightly has no copy time: %+v", info.Data)
	}
}

func TestUnreadableOrForeignRecordsStillMarkTheInstance(t *testing.T) {
	cases := map[string]string{
		"missing": filepath.Join(t.TempDir(), "absent.json"),
		"garbage": writeRecord(t, `not json`),
		"format":  writeRecord(t, `{"format":"other","kind":"mirror"}`),
		"kind":    writeRecord(t, `{"format":"filterest-instance-info-v1","kind":"production"}`),
		"too large": writeRecord(t, `{"format":"filterest-instance-info-v1","kind":"mirror","pad":"`+
			strings.Repeat("x", maxRecordBytes)+`"}`),
	}
	for name, path := range cases {
		t.Setenv(RecordEnv, path)
		code, info, body := serve(t)
		if code != http.StatusOK || info.Kind != "unknown" || strings.Contains(body, "source") {
			t.Fatalf("%s: want 200 kind unknown only, got %d %s", name, code, body)
		}
	}
}
