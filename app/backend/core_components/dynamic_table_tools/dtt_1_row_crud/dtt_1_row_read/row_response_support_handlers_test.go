// row_response_support_handlers_test.go
// Proves view-driven support in listing, blocking search and both stream packets.
// Uses the existing offline SQL fixture and an in-memory embedding transport.
// Hidden support must reach rows without changing columns or reading denied geometry.
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
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/sessions"
)

const supportFixtureDataset = "gallery_handler_parent"
const supportFixtureImage = "https://example.org/support.png"

type rowSupportHandlerDriver struct {
	t           *testing.T
	denyPicture bool
}
type rowSupportHandlerConn struct {
	galleryHandlerConn
	t           *testing.T
	denyPicture bool
}

func (d rowSupportHandlerDriver) Open(string) (driver.Conn, error) {
	return &rowSupportHandlerConn{galleryHandlerConn: galleryHandlerConn{state: &galleryHandlerState{t: d.t}}, t: d.t, denyPicture: d.denyPicture}, nil
}

func (c *rowSupportHandlerConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	rows := func(columns []string, values ...[]driver.Value) driver.Rows {
		return &legacyImageMockRows{columns: columns, rows: values}
	}
	switch {
	case strings.Contains(q, "target_insert_specs"), strings.Contains(q, "FROM system_foreign_key_relations_1_m"):
		return rows([]string{"child", "parent", "fk", "specs"}), nil
	case strings.Contains(q, "FROM information_schema.tables"):
		return rows([]string{"exists"}, []driver.Value{false}), nil
	case c.denyPicture && strings.Contains(q, "udt_name <> ALL"):
		return rows([]string{"column"}, []driver.Value{"id"}), nil
	case strings.Contains(q, "column_privileges"):
		if c.denyPicture {
			return rows([]string{"column"}, []driver.Value{"id"}, []driver.Value{"position"}), nil
		}
		return rows([]string{"column"}, []driver.Value{"id"}, []driver.Value{"cached_image"}, []driver.Value{"position"}), nil
	case strings.Contains(q, "udt_name = ANY"):
		return rows([]string{"column"}, []driver.Value{"position"}, []driver.Value{"private_position"}), nil
	case strings.Contains(q, "scd.card_element ILIKE"):
		return rows([]string{"column"}, []driver.Value{"cached_image"}), nil
	case strings.Contains(q, "FROM system_column_details cd"):
		// Search's main projection stays compact; enrichment must supply the image.
		return rows([]string{"uid", "name", "type", "order", "nullable", "identity", "default", "card", "multi"},
			[]driver.Value{int64(1), "id", "integer", int64(1), "NO", "NO", nil, "", false}), nil
	case strings.Contains(q, "SELECT 1") && strings.Contains(q, "FROM information_schema.columns"):
		if strings.Contains(q, "SELECT EXISTS") {
			break
		}
		if strings.Contains(q, "column_name = 'embedding_vector'") {
			return rows([]string{"exists"}, []driver.Value{int64(1)}), nil
		}
		return rows([]string{"exists"}), nil
	case strings.Contains(q, "semantic.distance,"):
		return rows([]string{"id", "name", "distance", "language"}, []driver.Value{int64(162), "AI row", float64(0.1), ""}), nil
	case strings.HasPrefix(q, `SELECT "gallery_handler_parent"."id" FROM`):
		return rows([]string{"id"}), nil // AI row is outside the text listing.
	case strings.Contains(q, `FROM "gallery_handler_parent"`), strings.Contains(q, "FROM wanted"):
		if c.denyPicture && strings.Contains(q, `"cached_image"`) {
			return nil, fmt.Errorf("permission denied for parent picture column")
		}
		if strings.Contains(q, "1 AS rank") {
			break
		}
		ids := []int64{161}
		if strings.Contains(q, "FROM wanted") && len(args) > 0 && strings.Contains(fmt.Sprint(args[0].Value), "162") {
			ids = []int64{162}
			if strings.Contains(fmt.Sprint(args[0].Value), "161") {
				ids = append(ids, 161)
			}
		}
		if strings.Contains(q, `"position"::text`) || strings.Contains(q, `"id" IN (`) {
			if strings.Contains(q, "private_position") {
				c.t.Fatal("support read denied geometry", q)
			}
			ids = nil
			for _, arg := range args {
				ids = append(ids, arg.Value.(int64))
			}
		}
		columns := []string{"id"}
		var values [][]driver.Value
		for _, id := range ids {
			value := []driver.Value{id}
			if strings.Contains(q, `"cached_image"`) {
				columns = []string{"id", "cached_image"}
				value = append(value, supportFixtureImage)
			}
			if strings.Contains(q, `"position"::text`) {
				columns = []string{"id", "position"}
				value = append(value, "POINT(24 60)")
			}
			values = append(values, value)
		}
		return rows(columns, values...), nil
	}
	return c.galleryHandlerConn.QueryContext(ctx, q, args)
}

type supportEmbeddingTransport struct{ calls int }

func (transport *supportEmbeddingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	transport.calls++
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(`{"data":[{"embedding":[1,0],"index":0}],"model":"text-embedding-3-small","usage":{}}`)), Request: r}, nil
}

func rowSupportHandlerRequest(t *testing.T, mode, params string) *httptest.ResponseRecorder {
	return rowSupportHandlerRequestWithPermissions(t, mode, params, false)
}

func rowSupportHandlerRequestWithPermissions(t *testing.T, mode, params string, denyPicture bool) *httptest.ResponseRecorder {
	t.Helper()
	name := fmt.Sprintf("row_support_handler_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(name, rowSupportHandlerDriver{t: t, denyPicture: denyPicture})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	old, oldBasic := backend.Db, backend.DbBasic
	backend.Db, backend.DbBasic = db, db
	if denyPicture {
		ownerName := name + "_owner"
		sql.Register(ownerName, rowSupportHandlerDriver{t: t})
		owner, err := sql.Open(ownerName, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { owner.Close() })
		backend.Db = owner
	}
	oldStore, oldName := esessions.Store, esessions.SessionName
	esessions.Store, esessions.SessionName = sessions.NewCookieStore([]byte("row-support-cookie-key-32")), "session"
	independentMediaRead.RLock()
	oldAuthorizer := independentMediaRead.authorize
	independentMediaRead.RUnlock()
	RegisterIndependentMediaAuthorizer(func(dbutils.Querier, dbutils.RequestActorContext, string) bool { return true })
	oldTransport := http.DefaultTransport
	transport := &supportEmbeddingTransport{}
	http.DefaultTransport = transport
	t.Setenv("OPENAI_API_KEY", "offline-fixture")
	t.Setenv("EMBEDDING_PROVIDER", "openai")
	t.Cleanup(func() {
		db.Close()
		backend.Db, backend.DbBasic = old, oldBasic
		esessions.Store, esessions.SessionName = oldStore, oldName
		http.DefaultTransport = oldTransport
		RegisterIndependentMediaAuthorizer(oldAuthorizer)
		InvalidateSchemaCache(supportFixtureDataset)
		resetJoinMetadataCacheForTests()
	})
	now := time.Now()
	setCachedDatasetExists(supportFixtureDataset, &existsCacheEntry{exists: true, cachedAt: now})
	setCachedConfig("results_load_amount", &configCacheEntry{resultsPerLoad: 10, cachedAt: now})
	allowed := []string{"id", "cached_image", "position"}
	if denyPicture {
		allowed = []string{"id", "position"}
	}
	setCachedPermissions("basic", supportFixtureDataset, &permCacheEntry{columns: allowed, cachedAt: now})
	setCachedSchemaMetadata(supportFixtureDataset, &schemaCacheEntry{columnsMap: map[int]dtt_models.ColumnInfo{
		1: {ColumnName: "id", DataType: "integer"},
		2: {ColumnName: "cached_image", DataType: "text", CardElement: "image"},
	}, geomCols: []string{"position", "private_position"}, cachedAt: now})
	for _, view := range []string{"table", "card", "article_view", "product_card", "map", "normal"} {
		setCachedUserColumnSettings(4, supportFixtureDataset, view, &ucsCacheEntry{settings: []UserColumnSetting{{ColumnName: "id"}}, cachedAt: now})
	}
	setCachedJoinMetadata(supportFixtureDataset, joinMetadataCacheEntry{tableUID: "161"})
	url := "/api/get-results?dataset=" + supportFixtureDataset + "&offset=1&row_count=1&query=word&" + params
	if mode == "stream" {
		url += "&stream=1"
	}
	req := httptest.NewRequest("GET", url, nil)
	session, err := esessions.Store.Get(req, esessions.SessionName)
	if err != nil {
		t.Fatal(err)
	}
	session.Values["user_id"], session.Values["user_role"] = 4, "basic"
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
		if transport.calls != 1 {
			t.Fatalf("expected offline AI stage, embedding calls=%d", transport.calls)
		}
	}
	return rec
}

func TestRowSupportAtResponseHandlers(t *testing.T) {
	for _, mode := range []string{"ordinary", "intelligent", "stream"} {
		for _, test := range []struct {
			params    string
			card, geo bool
		}{
			{"", false, false}, {"view_key=table", false, false},
			{"view_key=normal", false, false}, {"view_key=card", true, false},
			{"view_key=article_view", true, false}, {"view_key=big_card", true, false},
			{"view_key=product_card&include_card_support=0", true, false},
			{"view_key=map&include_map_support=0", false, true},
			{"include_card_support=1", true, false}, {"include_map_support=1", false, true},
			{"view_key=map&include_card_support=1", true, true},
			{"view_key=card&include_map_support=1", true, true},
		} {
			t.Run(mode+"/"+test.params, func(t *testing.T) {
				rec := rowSupportHandlerRequest(t, mode, test.params)
				if rec.Code != http.StatusOK {
					t.Fatal(rec.Code, rec.Body)
				}
				decoder := json.NewDecoder(rec.Body)
				stages := []string{""}
				if mode == "stream" {
					stages = []string{"text", "ai"}
				}
				for _, stage := range stages {
					var packet struct {
						Stage   string
						Columns []string
						Data    []map[string]interface{}
					}
					if err := decoder.Decode(&packet); err != nil {
						t.Fatal(err, rec.Body)
					}
					wantIDs := []interface{}{float64(161)}
					if stage == "ai" {
						wantIDs = []interface{}{float64(162)}
					} else if mode == "intelligent" {
						wantIDs = []interface{}{float64(162), float64(161)}
					}
					if packet.Stage != stage || !reflect.DeepEqual(packet.Columns, []string{"id"}) || len(packet.Data) != len(wantIDs) {
						t.Fatal("support changed presentation or lost stage/rows", packet)
					}
					for index, row := range packet.Data {
						_, hasCard := row["cached_image"]
						_, hasGeo := row["position"]
						if row["id"] != wantIDs[index] || hasCard != test.card || hasGeo != test.geo || row["private_position"] != nil ||
							hasCard && row["cached_image"] != supportFixtureImage || hasGeo && row["position"] != "POINT(24 60)" {
							t.Fatalf("stage %q: card=%t geo=%t, got %v", stage, test.card, test.geo, row)
						}
					}
				}
				var extra interface{}
				if err := decoder.Decode(&extra); err != io.EOF {
					t.Fatal("unexpected extra response packet", extra, err)
				}
			})
		}
	}
}

// Owner metadata still advertises the denied picture, which has no gallery and
// is external, so neither gallery nor media-library authorization can hide it.
func TestRowSupportDeniedParentPictureAtHandlers(t *testing.T) {
	for _, mode := range []string{"ordinary", "intelligent", "stream"} {
		for _, view := range []string{"card", "article_view", "product_card"} {
			t.Run(mode+"/"+view, func(t *testing.T) {
				rec := rowSupportHandlerRequestWithPermissions(t, mode, "view_key="+view, true)
				if rec.Code != http.StatusOK {
					t.Fatalf("authorized rows failed: status=%d body=%s", rec.Code, rec.Body)
				}
				decoder := json.NewDecoder(rec.Body)
				stages := []string{""}
				if mode == "stream" {
					stages = []string{"text", "ai"}
				}
				for _, stage := range stages {
					var packet struct {
						Stage   string
						Columns []string
						Data    []map[string]interface{}
					}
					if err := decoder.Decode(&packet); err != nil {
						t.Fatal(err, rec.Body)
					}
					want := []interface{}{float64(161)}
					if stage == "ai" {
						want = []interface{}{float64(162)}
					} else if mode == "intelligent" {
						want = []interface{}{float64(162), float64(161)}
					}
					if packet.Stage != stage || !reflect.DeepEqual(packet.Columns, []string{"id"}) || len(packet.Data) != len(want) {
						t.Fatal("authorized rows or columns changed", packet)
					}
					for i, row := range packet.Data {
						if row["id"] != want[i] {
							t.Fatal("authorized row lost", row)
						}
						if _, exists := row["cached_image"]; exists {
							t.Errorf("stage %q disclosed denied parent picture: %v", stage, row)
						}
					}
				}
				var extra interface{}
				if err := decoder.Decode(&extra); err != io.EOF {
					t.Fatal("unexpected response packet", extra, err)
				}
			})
		}
	}
}
