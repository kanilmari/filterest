// site_presentation_heading_order_storage_test.go
// Exercises real site saves against a recording SQL driver without PostgreSQL.
// Connects complete API values, canonical JSON writes and defaulting reads.
// Prevents an unchanged default save from breaking an older binary's reader.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
)

type headingStorageDriver struct{ raw []byte }
type headingStorageConn struct {
	orphanQueueConn
	state *headingStorageDriver
}

func (d *headingStorageDriver) Open(string) (driver.Conn, error) {
	return &headingStorageConn{state: d}, nil
}
func (c *headingStorageConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil // Shared advisory lock.
}
func (c *headingStorageConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if query == readSitePresentationSettingsSQL {
		// The fourth column is the separate table-cell line limit (NULL: unset, so the default applies).
		return &orphanQueueRows{cols: []string{"raw", "timestamp", "stamp", "lines"},
			data: [][]driver.Value{{string(c.state.raw), "date_time", "stamp", nil}}}, nil
	}
	if query != upsertDatasetCoverThemeSQL || args[0].Value != datasetCoverThemeConfigKey {
		return nil, fmt.Errorf("unexpected site writer query: %s", query)
	}
	c.state.raw = []byte(args[1].Value.(string))
	return &orphanQueueRows{cols: []string{"raw", "stamp"}, data: [][]driver.Value{{string(c.state.raw), "stamp"}}}, nil
}

func TestSitePresentationHeadingOrderCanonicalSaves(t *testing.T) {
	state := &headingStorageDriver{}
	name := t.Name()
	sql.Register(name, state)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, mode := range []string{"manual", "result_count", "manual", "unchanged"} {
		before, err := readSitePresentationSettingsWith(db)
		if err != nil {
			t.Fatal(err)
		}
		patch := sitePresentationPatchFromSettings(before)
		if mode != "unchanged" {
			patch.Set["shared.row_group_heading_order"] = mode
		}
		lazy := dbutils.NewLazyTx(db)
		request := httptest.NewRequest("POST", "/", nil)
		saved, err := persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), lazy)), patch)
		if err != nil {
			lazy.Rollback()
			t.Fatal(err)
		}
		if err := lazy.Commit(); err != nil {
			t.Fatal(err)
		}
		var stored store.SiteAppearanceValues
		if err := json.Unmarshal(state.raw, &stored); err != nil {
			t.Fatal(err)
		}
		value, present := stored.SiteValues["shared.row_group_heading_order"]
		if mode == "result_count" && (!present || value != mode) || mode != "result_count" && present {
			t.Fatalf("%s stored %v (present=%v)", mode, value, present)
		}
		expected := mode
		if mode == "unchanged" {
			expected = "manual"
		}
		after, err := readSitePresentationSettingsWith(db)
		if err != nil || after.SiteValues["shared.row_group_heading_order"] != expected ||
			saved.SiteValues["shared.row_group_heading_order"] != expected || after.Version != saved.Version {
			t.Fatalf("save/read round trip: %+v, %+v, %v", saved, after, err)
		}
	}
}
