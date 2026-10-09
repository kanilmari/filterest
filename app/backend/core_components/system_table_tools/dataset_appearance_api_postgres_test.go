// dataset_appearance_api_postgres_test.go
// Proves authorized snapshots, both revision conflicts and competing lock orders.
// Connects disposable PostgreSQL with results and administrator compatibility APIs.
// Never reads installation credentials, starts Docker or reaches a network host.
package system_table_tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	"github.com/lib/pq"
)

func TestDatasetAppearancePostgresResultsAuthorizedEmptyAndFresh(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	registerAppearanceTestColumns(t)
	frontPageRuntimeDB(t, db)
	frontPageExec(t, db, `REVOKE ALL ON system_dataset_appearance FROM front_page_runtime;`)
	saved, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_style_variant": "standard"}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"basic", "guest"} {
		// A readable empty dataset still carries appearance and sources.
		r := frontPageSessionRequest(t, 42, role, "GET", "/api/get-results?dataset=wl143_content")
		w := httptest.NewRecorder()
		read.GetResults(w, r)
		if w.Code != 200 {
			t.Fatal(role, w.Code, w.Body.String())
		}
		var body struct {
			DatasetAppearance store.AppearanceResponse `json:"dataset_appearance"`
			Data              []any                    `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Data) != 0 || body.DatasetAppearance.DatasetUID != uid || body.DatasetAppearance.Version != saved.Revision || len(body.DatasetAppearance.Sources) != 44 || body.DatasetAppearance.Sources["shared.card_style_variant"] != "override" {
			t.Fatal(body)
		}
	}
	if _, err := store.ReadAppearanceForName(db, uid, "another_dataset", false); !errors.Is(err, store.ErrDatasetAppearanceNotFound) {
		t.Fatal("UID/name mismatch exposed appearance", err)
	}

	// A cached schema must never freeze a later appearance save.
	saved, err = datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_style_variant": "modern"}}, saved.Revision)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	read.GetResults(w, frontPageSessionRequest(t, 42, "basic", "GET", "/api/get-results?dataset=wl143_content"))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"version":"`+saved.Revision+`"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	// Existing dataset visibility denial must not expose any appearance field.
	frontPageExec(t, db, `UPDATE system_db_tables SET ui_hidden=true WHERE table_uid=`+fmtUID(uid))
	w = httptest.NewRecorder()
	read.GetResults(w, frontPageSessionRequest(t, 42, "basic", "GET", "/api/get-results?dataset=wl143_content"))
	if w.Code == 200 || strings.Contains(w.Body.String(), "dataset_appearance") {
		t.Fatal("hidden snapshot exposed", w.Code, w.Body.String())
	}
}

func fmtUID(uid int) string { return fmt.Sprint(uid) }

func TestDatasetAppearancePostgresAdminAndGenericCompatibilityWriters(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	registerAppearanceTestColumns(t)
	// Generic registry writes retain the runtime grant boundary used by all metadata edits.
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		name := "wl160_" + label + "_runtime"
		t.Setenv(key, name)
		frontPageExec(t, db, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	initial, err := store.ReadAppearance(db, uid, false)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"dataset_uid": uid, "set": map[string]any{"shared.card_detail_columns": 2}, "unset": []string{}, "shared_version": initial.SharedVersion, "version": initial.Version})
	lazy := dbutils.NewLazyTx(db)
	r := httptest.NewRequest("POST", "/api/admin/dataset-appearance", strings.NewReader(string(body)))
	r = r.WithContext(dbutils.SetLazyTx(r.Context(), lazy))
	w := httptest.NewRecorder()
	AdminDatasetAppearanceHandler(w, r)
	if w.Code != 200 {
		lazy.Rollback()
		t.Fatal(w.Code, w.Body.String())
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	current, err := store.ReadAppearance(db, uid, false)
	if err != nil {
		t.Fatal(err)
	}
	if current.Sources["shared.card_detail_columns"] != "override" || current.Version == initial.Version {
		t.Fatal(current)
	}
	var registryID int
	if err := db.QueryRow(`SELECT id FROM system_db_tables WHERE table_uid=$1`, uid).Scan(&registryID); err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(map[string]any{"id": registryID, "column": "card_style_variant", "value": "standard", "shared_version": current.SharedVersion, "version": current.Version})
	lazy = dbutils.NewLazyTx(db)
	r = frontPageSessionRequest(t, 42, "admin", "POST", "/api/update-row?dataset=system_db_tables")
	r.Body = ioBody(string(body))
	r = r.WithContext(dbutils.SetLazyTx(r.Context(), lazy))
	w = httptest.NewRecorder()
	update.UpdateRowHandler(&appearanceTestResponseBuffer{w}, r, "system_db_tables")
	if w.Code != 200 {
		lazy.Rollback()
		t.Fatal(w.Code, w.Body.String())
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	current, err = store.ReadAppearance(db, uid, false)
	if err != nil || current.Overrides["shared.card_style_variant"] != "standard" {
		t.Fatal(current, err)
	}
	// Full card editor saves presentation through the same authority.
	columns := []CardVisibilityColumn{}
	rows, err := db.Query(`SELECT column_uid,column_name,co_number FROM system_column_details WHERE table_uid=$1 ORDER BY co_number`, uid)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c CardVisibilityColumn
		if err := rows.Scan(&c.ColumnUID, &c.ColumnName, &c.CoNumber); err != nil {
			t.Fatal(err)
		}
		c.ClientDeliveryMode = "include"
		columns = append(columns, c)
	}
	rows.Close()
	body, _ = json.Marshal(map[string]any{"table_name": "wl143_content", "columns": columns, "card_style_variant": nil, "shared_version": current.SharedVersion, "version": current.Version})
	lazy = dbutils.NewLazyTx(db)
	r = httptest.NewRequest("POST", "/api/card-visibility/update", strings.NewReader(string(body)))
	r = r.WithContext(dbutils.SetLazyTx(r.Context(), lazy))
	w = httptest.NewRecorder()
	UpdateCardVisibilityHandler(w, r)
	if w.Code != 200 {
		lazy.Rollback()
		t.Fatal(w.Code, w.Body.String())
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	current, err = store.ReadAppearance(db, uid, false)
	if err != nil || current.Sources["shared.card_style_variant"] != "shared" {
		t.Fatal(current, err)
	}
}

func TestDatasetAppearancePostgresSharedAndOverrideLockOrders(t *testing.T) {
	for _, sharedFirst := range []bool{true, false} {
		t.Run(fmt.Sprint(sharedFirst), func(t *testing.T) {
			db, uid := datasetAppearanceFixture(t)
			initial, err := store.ReadAppearance(db, uid, false)
			if err != nil {
				t.Fatal(err)
			}
			settings, err := readSitePresentationSettingsFromDB()
			if err != nil {
				t.Fatal(err)
			}
			first, second := dbutils.NewLazyTx(db), dbutils.NewLazyTx(db)
			defer first.Rollback()
			defer second.Rollback()
			tx1, ok := dbutils.RequireTx(dbutils.SetLazyTx(context.Background(), first))
			if !ok {
				t.Fatal("tx")
			}
			tx2, ok := dbutils.RequireTx(dbutils.SetLazyTx(context.Background(), second))
			if !ok {
				t.Fatal("tx")
			}
			var pid int
			if err := tx2.QueryRow(`SELECT pg_backend_pid()`).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/api/admin/site-presentation-settings", nil)
			result := make(chan error, 1)
			if sharedFirst {
				settings.DatasetCoverTheme.Light.ImageBlur = 8
				_, err = persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), first)), settings)
				if err != nil {
					t.Fatal(err)
				}
				go func() {
					_, err := store.SaveAppearance(tx2, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 3}}, initial.SharedVersion, initial.Version, false)
					result <- err
				}()
			} else {
				_, err = store.SaveAppearance(tx1, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 3}}, initial.SharedVersion, initial.Version, false)
				if err != nil {
					t.Fatal(err)
				}
				go func() {
					_, err := persistSitePresentationSettings(request.WithContext(dbutils.SetLazyTx(request.Context(), second)), settings)
					result <- err
				}()
			}
			deadline := time.Now().Add(3 * time.Second)
			for {
				var waiting bool
				if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock')`, pid).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("writer did not wait on shared lock")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if err := first.Commit(); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-result:
				if sharedFirst {
					if !errors.Is(err, store.ErrDatasetAppearanceConflict) {
						t.Fatal("stale shared editor not refused", err)
					}
				} else {
					if err != nil {
						t.Fatal(err)
					}
					if err := second.Commit(); err != nil {
						t.Fatal(err)
					}
				}
			case <-time.After(5 * time.Second):
				t.Fatal("lock order deadlock")
			}
		})
	}
}

func registerAppearanceTestColumns(t *testing.T) {
	frontPageExec(t, backend.Db, `INSERT INTO system_column_details(table_uid,column_name,co_number,hide_everywhere,client_delivery_mode)
 SELECT d.table_uid,c.column_name,c.ordinal_position,false,'include' FROM system_db_tables d
 JOIN information_schema.columns c ON c.table_name=d.table_name AND c.table_schema='public'
 WHERE d.table_name='wl143_content'`)
}

// The fixture commits manually; real middleware owns buffering and commit failure reporting.
type appearanceTestResponseBuffer struct{ *httptest.ResponseRecorder }

func (*appearanceTestResponseBuffer) EnableCommitBuffer() error { return nil }

func TestDatasetAppearancePostgresConcurrentSharedFirstWrites(t *testing.T) {
	db, _ := datasetAppearanceFixture(t)
	initial, err := readSitePresentationSettingsFromDB()
	if err != nil || initial.Version != "none" {
		t.Fatal(initial, err)
	}
	gate := make(chan struct{})
	results := make(chan error, 2)
	for _, blur := range []float64{3, 7} {
		go func(blur float64) {
			<-gate
			lazy := dbutils.NewLazyTx(db)
			defer lazy.Rollback()
			r := httptest.NewRequest("POST", "/api/admin/site-presentation-settings", nil)
			input := initial
			input.DatasetCoverTheme.Light.ImageBlur = blur
			_, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), input)
			if err == nil {
				err = lazy.Commit()
			}
			results <- err
		}(blur)
	}
	close(gate)
	wins, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		select {
		case err := <-results:
			if err == nil {
				wins++
			} else if errors.Is(err, store.ErrDatasetAppearanceConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("shared first writes did not settle")
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal(wins, conflicts)
	}
}

func TestDatasetAppearancePostgresSnapshotConsistencyDuringWrites(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	finished := make(chan error, 1)
	go func() {
		for blur := 2; blur <= 20; blur++ {
			lazy := dbutils.NewLazyTx(db)
			tx, ok := dbutils.RequireTx(dbutils.SetLazyTx(context.Background(), lazy))
			if !ok {
				finished <- fmt.Errorf("transaction unavailable")
				return
			}
			input, err := readSitePresentationSettingsFromDB()
			if err != nil {
				lazy.Rollback()
				finished <- err
				return
			}
			before, err := ReadDatasetAppearance(tx, uid, false)
			if err != nil {
				lazy.Rollback()
				finished <- err
				return
			}
			input.DatasetCoverTheme.Light.ImageBlur = float64(blur)
			input.DatasetCoverTheme.Shared.CardDetailColumns = 1 + blur%4
			r := httptest.NewRequest("POST", "/api/admin/site-presentation-settings", nil)
			shared, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), input)
			if err == nil {
				_, err = store.SaveAppearance(tx, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": input.DatasetCoverTheme.Shared.CardDetailColumns}}, shared.Version, before.Revision, false)
			}
			if err == nil {
				err = lazy.Commit()
			}
			lazy.Rollback()
			if err != nil {
				finished <- err
				return
			}
		}
		finished <- nil
	}()
	for {
		snapshot, err := store.ReadAppearance(db, uid, false)
		if err != nil || snapshot.Shared.Shared.CardDetailColumns != snapshot.Effective.Shared.CardDetailColumns || snapshot.Shared.Light.ImageBlur != snapshot.Effective.Light.ImageBlur {
			t.Fatal("torn snapshot", snapshot, err)
		}
		select {
		case err := <-finished:
			if err != nil {
				t.Fatal(err)
			}
			return
		default:
		}
	}
}
