// gallery_cache_handlers_test.go
// Exercises ordinary and intelligent response handlers with both parameter forms.
// Shares real sessions, permission/policy builders and filename-only classification.
// Denied/hidden pictures disappear; K121 kept classes and their metadata survive.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	esessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"fmt"
	"github.com/gorilla/sessions"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type galleryHandlerState struct {
	t                       *testing.T
	cached                  string
	allowed, visible, empty bool
}
type galleryHandlerDriver struct{ state *galleryHandlerState }
type galleryHandlerConn struct {
	canonicalAssetMockConn
	state *galleryHandlerState
}

func (d galleryHandlerDriver) Open(string) (driver.Conn, error) {
	return &galleryHandlerConn{state: d.state}, nil
}
func (c *galleryHandlerConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	rows := func(columns []string, values ...[]driver.Value) driver.Rows {
		return &legacyImageMockRows{columns: columns, rows: values}
	}
	switch {
	case strings.Contains(q, "a.schema_version,a.tab_values,a.overrides,a.revision::text"):
		return rows([]string{"shared", "stamp", "schema", "tab_values", "overrides", "revision"}, []driver.Value{nil, "", nil, nil, nil, nil}), nil
	case strings.Contains(q, "target_insert_specs"):
		return rows([]string{"child", "parent", "fk", "specs"}, []driver.Value{"app_service_catalog_assets", "gallery_handler_parent", "app_service_catalog_id", []byte(`{"file_upload":{"filename_column":"filename","profiles":{"image":{}}}}`)}), nil
	case strings.Contains(q, "type_column.atttypid"):
		return rows([]string{"empty"}), nil
	case strings.Contains(q, "scd.card_element ILIKE"):
		return rows([]string{"column_name"}), nil
	case strings.Contains(q, "dataset.ui_hidden"):
		return rows([]string{"hidden"}, []driver.Value{false}), nil
	case strings.Contains(q, "system_group_table_func_rights"):
		if !c.state.allowed {
			return rows([]string{"allowed"}), nil
		}
		return rows([]string{"allowed"}, []driver.Value{int64(1)}), nil
	case strings.Contains(q, `FROM "app_service_catalog_assets"`):
		if strings.HasPrefix(q, `SELECT "app_service_catalog_id","filename"`) {
			if len(args) != 1 || args[0].Value != int64(161) {
				c.state.t.Fatal("classification not parent-bound", q, args)
			}
			if c.state.empty {
				return rows([]string{"parent", "filename"}), nil
			}
			return rows([]string{"parent", "filename"}, []driver.Value{int64(161), "own.png"}, []driver.Value{int64(161), "161_161_55.png"}), nil
		}
		if !strings.Contains(q, "resolve_effective_row_access") {
			c.state.t.Fatal("visible gallery reader not authorized", q)
		}
		if !c.state.visible || c.state.empty {
			return rows([]string{"parent", "filename", "type", "metadata", "title", "original"}), nil
		}
		return rows([]string{"parent", "filename", "type", "metadata", "title", "original"}, []driver.Value{int64(161), "own.png", int64(0), "", "gallery title", ""}), nil
	case strings.Contains(q, "ts_rank("), strings.Contains(q, "1 AS rank"):
		return rows([]string{"id", "name", "rank"}, []driver.Value{int64(161), "row", float64(1)}), nil
	case strings.Contains(q, "FROM wanted"), strings.Contains(q, `FROM "gallery_handler_parent"`):
		return rows([]string{"id", "cached_image", "cached_image_title"}, []driver.Value{int64(161), c.state.cached, "kept metadata"}), nil
	case strings.Contains(q, "multi_lang_embeddings"):
		return rows([]string{"flag"}, []driver.Value{false}), nil
	case strings.Contains(q, "SELECT table_uid"), strings.Contains(q, "SELECT\n        table_uid"):
		return rows([]string{"uid"}, []driver.Value{int64(161)}), nil
	case strings.Contains(q, "system_dataset_media"):
		return rows([]string{"cover", "background", "cover_hidden", "background_hidden"}, []driver.Value{"", "", false, false}), nil
	case strings.Contains(q, "results_load_amount"):
		return rows([]string{"amount"}, []driver.Value{"10"}), nil
	case strings.Contains(q, "FROM system_column_details cd"):
		return rows([]string{"uid", "name", "type", "order", "nullable", "identity", "default", "card", "multi"},
			[]driver.Value{int64(1), "id", "integer", int64(1), "NO", "NO", nil, "", false},
			[]driver.Value{int64(2), "cached_image", "text", int64(2), "YES", "NO", nil, "image", false},
			[]driver.Value{int64(3), "cached_image_title", "text", int64(3), "YES", "NO", nil, "", false}), nil
	case strings.Contains(q, "FROM information_schema.columns") && strings.Contains(q, "SELECT EXISTS"):
		return rows([]string{"exists"}, []driver.Value{false}), nil
	case strings.Contains(q, "FROM information_schema.columns") && len(args) > 0 && args[0].Value == "gallery_handler_parent":
		if strings.Contains(q, "SELECT 1") {
			return rows([]string{"exists"}), nil
		}
		return rows([]string{"column_name"}, []driver.Value{"id"}, []driver.Value{"cached_image"}, []driver.Value{"cached_image_title"}), nil
	case strings.Contains(q, "FROM system_column_details") && strings.Contains(q, "scd.") && !strings.Contains(q, "must_be_true_unless_own"):
		return rows([]string{"empty"}), nil
	}
	return c.canonicalAssetMockConn.QueryContext(ctx, q, args)
}

func TestGalleryCacheAuthorizationAtResponseHandlers(t *testing.T) {
	for _, mode := range []string{"ordinary", "intelligent", "stream"} {
		for _, include := range []bool{false, true} {
			for _, tc := range []struct {
				name, cached                  string
				allowed, visible, empty, kept bool
			}{
				{"denied", "own.png", false, true, false, false},
				{"hidden", "own.png", true, false, false, false},
				{"fragment denied", "own.png#preview", false, true, false, false},
				{"fragment hidden", "own.png#preview", true, false, false, false},
				{"flat coordinates fragment denied", "161_161_55.png#preview", false, true, false, false},
				{"flat coordinates fragment hidden", "161_161_55.png#preview", true, false, false, false},
				{"path fragment hidden", "/storage/161/161/300/own.png#preview", true, false, false, false},
				{"query and fragment denied", "/storage/161/161/original/own.png?size=300#preview", false, true, false, false},
				{"fragment visible", "own.png#preview", true, true, false, true},
				{"external basename denied", "https://example.org/own.png", false, true, false, true},
				{"external basename hidden", "https://example.org/own.png#preview", true, false, false, true},
				{"external basename visible", "https://example.org/own.png", true, true, false, true},
				{"library basename denied", "/storage/media/9/300/own.png", false, true, false, true},
				{"library basename hidden", "/storage/media/9/300/own.png#preview", true, false, false, true},
				{"library basename visible", "/storage/media/9/300/own.png", true, true, false, true},
				{"other row basename denied", "/storage/161/888/300/own.png", false, true, false, true},
				{"other row basename hidden", "/storage/161/888/original/own.png#preview", true, false, false, true},
				{"other row basename visible", "/storage/161/888/300/own.png", true, true, false, true},
				{"other dataset basename denied", "/storage/162/161/300/own.png", false, true, false, true},
				{"visible", "/storage/161/161/300/own.png?size=300", true, true, false, true},
				{"empty", "own.png", true, false, true, true},
				{"external", "https://example.org/external.jpg", false, true, false, true},
				{"library", "/storage/media/9/300/library.png", false, true, false, true},
				{"other row", "/storage/161/888/300/other.png", false, true, false, true},
				{"unadopted own file", "/storage/161/161/300/unchecked.png", true, true, false, true},
				{"unchecked", "unchecked-value", false, false, true, true},
				{"external visible gallery", "https://example.org/external.jpg", true, true, false, true},
				{"external empty gallery", "https://example.org/external.jpg", true, false, true, true},
				{"library visible gallery", "/storage/media/9/300/library.png", true, true, false, true},
				{"library empty gallery", "/storage/media/9/300/library.png", true, false, true, true},
				{"other row visible gallery", "/storage/161/888/300/other.png", true, true, false, true},
				{"other row empty gallery", "/storage/161/888/300/other.png", true, false, true, true},
				{"unadopted own denied gallery", "/storage/161/161/300/unchecked.png", false, true, false, true},
				{"unadopted own empty gallery", "/storage/161/161/300/unchecked.png", true, false, true, true},
				{"unchecked visible gallery", "unchecked-value", true, true, false, true},
				{"unchecked denied gallery", "unchecked-value", false, true, false, true},
			} {
				t.Run(fmt.Sprintf("%s/include=%t/%s", mode, include, tc.name), func(t *testing.T) {
					state := &galleryHandlerState{t, tc.cached, tc.allowed, tc.visible, tc.empty}
					name := fmt.Sprintf("gallery_handler_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
					sql.Register(name, galleryHandlerDriver{state})
					db, err := sql.Open(name, "")
					if err != nil {
						t.Fatal(err)
					}
					old, oldBasic := backend.Db, backend.DbBasic
					backend.Db, backend.DbBasic = db, db
					oldStore, oldName := esessions.Store, esessions.SessionName
					esessions.Store = sessions.NewCookieStore([]byte("gallery-handler-cookie-key-32"))
					esessions.SessionName = "session"
					independentMediaRead.RLock()
					oldAuthorizer := independentMediaRead.authorize
					independentMediaRead.RUnlock()
					RegisterIndependentMediaAuthorizer(func(dbutils.Querier, dbutils.RequestActorContext, string) bool { return true })
					t.Cleanup(func() {
						db.Close()
						backend.Db, backend.DbBasic = old, oldBasic
						esessions.Store, esessions.SessionName = oldStore, oldName
						RegisterIndependentMediaAuthorizer(oldAuthorizer)
						InvalidateSchemaCache("gallery_handler_parent")
						resetJoinMetadataCacheForTests()
					})
					now := time.Now()
					columns := map[int]dtt_models.ColumnInfo{1: {ColumnName: "id", DataType: "integer"}, 2: {ColumnName: "cached_image", DataType: "text", CardElement: "image"}, 3: {ColumnName: "cached_image_title", DataType: "text"}}
					setCachedDatasetExists("gallery_handler_parent", &existsCacheEntry{exists: true, cachedAt: now})
					setCachedConfig("results_load_amount", &configCacheEntry{resultsPerLoad: 10, cachedAt: now})
					setCachedPermissions("basic", "gallery_handler_parent", &permCacheEntry{columns: []string{"id", "cached_image", "cached_image_title"}, cachedAt: now})
					setCachedSchemaMetadata("gallery_handler_parent", &schemaCacheEntry{columnsMap: columns, cachedAt: now})
					setCachedUserColumnSettings(4, "gallery_handler_parent", "table", &ucsCacheEntry{settings: []UserColumnSetting{{ColumnName: "id"}, {ColumnName: "cached_image"}, {ColumnName: "cached_image_title"}}, cachedAt: now})
					setCachedJoinMetadata("gallery_handler_parent", joinMetadataCacheEntry{tableUID: "161"})
					url := "/api/get-results?dataset=gallery_handler_parent&offset=1&row_count=1&query=word"
					if include {
						url += "&include_card_support=1"
					}
					if mode == "stream" {
						url += "&stream=1"
					}
					req := httptest.NewRequest("GET", url, nil)
					session, err := esessions.Store.Get(req, esessions.SessionName)
					if err != nil {
						t.Fatal(err)
					}
					session.Values["user_id"] = 4
					session.Values["user_role"] = "basic"
					cookies := httptest.NewRecorder()
					if err := session.Save(req, cookies); err != nil {
						t.Fatal(err)
					}
					for _, cookie := range cookies.Result().Cookies() {
						req.AddCookie(cookie)
					}
					rec := httptest.NewRecorder()
					if mode == "ordinary" {
						GetResults(rec, req)
					} else {
						GetIntelligentResultsHandlerWrapper(rec, req)
					}
					if rec.Code != http.StatusOK {
						t.Fatal(rec.Code, rec.Body)
					}
					var packet struct {
						Stage      string
						Data       []map[string]interface{}
						Appearance struct {
							SchemaVersion int            `json:"schema_version"`
							TabValues     map[string]any `json:"tab_values"`
							SiteValues    map[string]any `json:"site_values"`
							Defaults      map[string]any `json:"defaults"`
						} `json:"dataset_appearance"`
					}
					if err := json.NewDecoder(rec.Body).Decode(&packet); err != nil {
						t.Fatal(err)
					}
					if len(packet.Data) != 1 || mode == "stream" && (!rec.Flushed || packet.Stage != "text") {
						t.Fatal(packet, rec.Flushed)
					}
					// Ordinary results own the appearance contract; semantic packets
					// retain the dataset state established by the ordinary response.
					if mode == "ordinary" && (packet.Appearance.SchemaVersion != 2 || len(packet.Appearance.TabValues) != 28 || len(packet.Appearance.SiteValues) != 7 || len(packet.Appearance.Defaults) != 9) {
						t.Fatal("results lost their owned appearance snapshot", packet.Appearance)
					}
					row := packet.Data[0]
					if tc.kept {
						wantTitle := "kept metadata"
						if include && (tc.name == "visible" || tc.name == "fragment visible") {
							wantTitle = "gallery title"
						}
						if row["cached_image"] != tc.cached || row["cached_image_title"] != wantTitle {
							t.Fatal("kept picture changed", row)
						}
					} else {
						for key := range row {
							if key == "cached_image" || strings.HasPrefix(key, "cached_image_") {
								t.Fatal("gallery cache escaped", row)
							}
						}
					}
				})
			}
		}
	}
}

func TestGalleryCacheGuardSkipsPagesWithoutCachedValues(t *testing.T) {
	old := backend.Db
	backend.Db = nil
	t.Cleanup(func() { backend.Db = old })
	if err := guardGalleryCachedImages(nil, "no_gallery", []map[string]interface{}{{"id": int64(1)}}, dbutils.NewRequestActorContext(4, "basic"), nil); err != nil {
		t.Fatal(err)
	}
}

func TestGalleryCacheGuardKeepsCacheWhenDatasetHasNoGallery(t *testing.T) {
	old := backend.Db
	backend.Db = nil
	t.Cleanup(func() { backend.Db = old })
	// This fixture has an attachment-only relation and cannot answer a gallery
	// content query. A cached value must not cause classification or authorization.
	db := openAttachmentOnlySharedAssetMockDB(t)
	rows := []map[string]interface{}{{"id": int64(1), "cached_image": "kept.png", "cached_image_title": "kept title"}}
	if err := guardGalleryCachedImages(db, "contracts", rows, dbutils.NewRequestActorContext(4, "basic"), nil); err != nil {
		t.Fatal(err)
	}
	if rows[0]["cached_image"] != "kept.png" || rows[0]["cached_image_title"] != "kept title" {
		t.Fatal(rows)
	}
}
