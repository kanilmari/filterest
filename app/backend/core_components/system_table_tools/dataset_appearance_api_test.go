// dataset_appearance_api_test.go
// Verifies consistent read shape, translated refusals and immutable sparse values.
// Connects SQL queue fixtures with API response sources and optimistic revisions.
// Supplements PostgreSQL concurrency proofs without needing a database socket.
package system_table_tools

import (
	"database/sql/driver"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
)

func TestDatasetAppearanceSnapshotOneStatementAndAllSources(t *testing.T) {
	resetOrphanQueues()
	defer resetOrphanQueues()
	db := newSystemTableToolsTestDB(t)
	defer db.Close()
	shared := defaultSitePresentationSettings().DatasetCoverTheme
	shared.Dark.ImageBlur = 7
	raw, _ := json.Marshal(shared)
	pushOrphanQuery(orphanQueuedQuery{cols: []string{"shared", "stamp", "schema", "overrides", "revision"}, rows: [][]driver.Value{{string(raw), "stamp-1", int64(1), []byte(`{"light.image_blur":0,"light.oval_enabled":false,"shared.card_detail_columns":2}`), "9"}}})
	snapshot, err := store.ReadAppearance(db, 42, false)
	if err != nil || snapshot.DatasetUID != 42 || snapshot.Version != "9" || snapshot.SharedVersion != store.SharedRevision(raw, "stamp-1") || snapshot.Effective.Light.ImageBlur != 0 || snapshot.Effective.Light.OvalEnabled || snapshot.Effective.Dark.ImageBlur != 7 || len(snapshot.Sources) != 44 {
		t.Fatal(snapshot, err)
	}
	if len(snapshotOrphanCalls()) != 1 || snapshot.Sources["light.image_blur"] != "override" || snapshot.Sources["dark.image_blur"] != "shared" || snapshot.Sources["shared.card_detail_columns"] != "override" {
		t.Fatal(snapshot)
	}
}

func TestDatasetAppearanceHandlerRejectsMalformedAndMissingRevisions(t *testing.T) {
	for _, input := range []struct {
		body   string
		status int
		key    string
	}{
		{`null`, 400, "dataset_appearance_invalid"},
		{`{"dataset_uid":42,"unknown":1}`, 400, "dataset_appearance_invalid"},
		{`{"dataset_uid":42} trailing`, 400, "dataset_appearance_invalid"},
		{`{"dataset_uid":42}`, 409, "dataset_appearance_conflict"},
	} {
		w := httptest.NewRecorder()
		AdminDatasetAppearanceHandler(w, httptest.NewRequest("POST", "/api/admin/dataset-appearance", strings.NewReader(input.body)))
		assertAppearanceHTTPRefusal(t, w, input.status, input.key)
	}
}
