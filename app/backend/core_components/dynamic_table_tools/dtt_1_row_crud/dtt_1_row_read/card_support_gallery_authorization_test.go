// card_support_gallery_authorization_test.go
// Proves caller rights and row predicates guard fresh and cached card pictures.
// Reuses the canonical gallery driver and production permission/policy builders.
// Counts content queries to prevent restoring an administrator retry.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

type galleryGuardDriver struct{ state *galleryGuardState }
type galleryGuardState struct {
	allowed, visible, failContent bool
	contentQueries                int
	relationQueries               int
	t                             *testing.T
}
type galleryGuardConn struct {
	canonicalAssetMockConn
	state *galleryGuardState
}

func (d galleryGuardDriver) Open(string) (driver.Conn, error) {
	return &galleryGuardConn{state: d.state}, nil
}
func (c *galleryGuardConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "target_insert_specs") {
		c.state.relationQueries++
	}
	if strings.Contains(query, "system_group_table_func_rights") {
		if len(args) != 3 || args[1].Value != int64(4) || args[2].Value != "app_service_catalog_assets" {
			c.state.t.Fatalf("gallery actor/scope missing: %v", args)
		}
		rows := [][]driver.Value{}
		if c.state.allowed {
			rows = append(rows, []driver.Value{int64(1)})
		}
		return &legacyImageMockRows{columns: []string{"allowed"}, rows: rows}, nil
	}
	if strings.Contains(query, `FROM "app_service_catalog_assets"`) {
		if strings.HasPrefix(query, `SELECT "app_service_catalog_id","filename"`) {
			return &legacyImageMockRows{columns: []string{"parent_id", "filename"}, rows: [][]driver.Value{{int64(161), "hidden.png"}, {int64(161), "visible.png"}}}, nil
		}
		c.state.contentQueries++
		if !strings.Contains(query, "resolve_effective_row_access") || len(args) != 3 || args[1].Value != "app_service_catalog_assets" || args[2].Value != int64(4) {
			c.state.t.Fatalf("gallery visibility/actor missing: %s %v", query, args)
		}
		if c.state.failContent {
			return nil, errors.New("gallery SQL denied")
		}
		rows := [][]driver.Value{}
		if c.state.visible {
			rows = append(rows, []driver.Value{int64(161), "visible.png", int64(0), "", "visible title", ""})
		}
		return &legacyImageMockRows{columns: []string{"parent_id", "filename", "type_id", "metadata_json", "title", "original_name"}, rows: rows}, nil
	}
	return c.canonicalAssetMockConn.QueryContext(ctx, query, args)
}
func openGalleryGuardDB(t *testing.T, state *galleryGuardState) *sql.DB {
	t.Helper()
	state.t = t
	name := fmt.Sprintf("gallery_guard_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(name, galleryGuardDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestCardGalleryAuthorizationGuardsFreshAndCachedImages(t *testing.T) {
	for _, test := range []struct {
		name                           string
		allowed, visible, fail, cached bool
	}{
		{"no right, fresh", false, true, false, false}, {"no right, cached", false, true, false, true},
		{"right, visible", true, true, false, false}, {"right, hidden cache", true, false, false, true},
		{"right, visible does not replace hidden cache", true, true, false, true}, {"content failure has no admin retry", true, true, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := &galleryGuardState{allowed: test.allowed, visible: test.visible, failContent: test.fail}
			db := openGalleryGuardDB(t, state)
			adminState := &galleryGuardState{allowed: true, visible: true}
			admin := openGalleryGuardDB(t, adminState)
			old := backend.Db
			backend.Db = admin
			t.Cleanup(func() { backend.Db = old })
			rows := []map[string]interface{}{{"id": int64(161)}}
			if test.cached {
				rows[0]["cached_image"] = "hidden.png"
				rows[0]["cached_image_title"] = "hidden title"
				rows[0]["cached_image_type_id"] = int64(99)
			}
			gallery := &cardGalleryRead{}
			err := enrichRowsWithCanonicalAssetImages(db, "app_service_catalog", rows, []int64{161}, dbutils.NewRequestActorContext(4, "user"), gallery)
			if (err != nil) != test.fail {
				t.Fatal(err)
			}
			if guardErr := guardGalleryCachedImages(db, "app_service_catalog", rows, dbutils.NewRequestActorContext(4, "user"), gallery); guardErr != nil {
				t.Fatal(guardErr)
			}
			wantImage := test.allowed && test.visible && !test.fail && !test.cached
			if wantImage {
				if rows[0]["cached_image"] != "visible.png" {
					t.Fatal(rows)
				}
			} else {
				if _, ok := rows[0]["cached_image"]; ok {
					t.Fatal("unauthorized image", rows)
				}
				if _, ok := rows[0]["cached_image_title"]; ok {
					t.Fatal("unauthorized image metadata", rows)
				}
			}
			wantQueries := 0
			if test.allowed {
				wantQueries = 1
			}
			if state.contentQueries != wantQueries || adminState.contentQueries != 0 || state.relationQueries != 1 {
				t.Fatal("gallery content retry or unauthorized content read", state.contentQueries, adminState.contentQueries)
			}
		})
	}
}

func TestParentSupportFailureStillGuardsCachedGalleryImage(t *testing.T) {
	state := &galleryGuardState{}
	db := openGalleryGuardDB(t, state)
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	rows := []map[string]interface{}{{"id": int64(161), "cached_image": "hidden.png"}}
	gallery := &cardGalleryRead{}
	err := enrichRowsWithCardSupportColumns(db, "app_service_catalog", rows, map[int]dtt_models.ColumnInfo{}, nil, dbutils.NewRequestActorContext(4, "user"), gallery)
	if err == nil {
		t.Fatal("fixture should fail parent support metadata")
	}
	if err := guardGalleryCachedImages(db, "app_service_catalog", rows, dbutils.NewRequestActorContext(4, "user"), gallery); err != nil {
		t.Fatal(err)
	}
	if _, ok := rows[0]["cached_image"]; ok {
		t.Fatal("failed enrichment bypassed cache guard", rows)
	}
}

func TestGalleryCacheMayUseAnyVisibleGalleryRow(t *testing.T) {
	rows := []map[string]interface{}{{"id": int64(1), "cached_image": "second.png"}, {"id": int64(2), "cached_image": "hidden.png"}}
	filterGalleryCachedImages(rows, map[string][]string{"1": {"first.png", "second.png"}, "2": {"hidden.png"}}, map[string]canonicalAssetImageValue{"1": {filename: "first.png", visibleFilenames: []string{"first.png", "second.png"}}}, "104")
	if rows[0]["cached_image"] != "second.png" {
		t.Fatal(rows)
	}
	if _, ok := rows[1]["cached_image"]; ok {
		t.Fatal(rows)
	}
}

func TestGalleryCacheClassificationNormalizesParentIdentity(t *testing.T) {
	for _, id := range []interface{}{int(161), int32(161), int64(161), float64(161), " 0161 ", []byte("161")} {
		row := map[string]interface{}{"id": id, "cached_image": "hidden.png", "cached_image_title": "private title"}
		filterGalleryCachedImages([]map[string]interface{}{row}, map[string][]string{"161": {"hidden.png"}}, nil, "104")
		if _, ok := row["cached_image"]; ok {
			t.Fatal("non-numeric representation bypassed gallery guard", id, row)
		}
		if _, ok := row["cached_image_title"]; ok {
			t.Fatal("non-numeric representation preserved private metadata", id, row)
		}
	}
}

func TestCardGalleryReadResultsStayWithinOneResponsePage(t *testing.T) {
	state := &galleryGuardState{visible: true}
	db := openGalleryGuardDB(t, state)
	old := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = old })
	columns := map[int]dtt_models.ColumnInfo{1: {ColumnName: "cached_image", CardElement: "image"}}
	actor := dbutils.NewRequestActorContext(4, "user")
	for _, allowed := range []bool{false, true, false, true} {
		state.allowed = allowed
		rows := []map[string]interface{}{{"id": int64(161), "cached_image": "visible.png#preview"}}
		if err := prepareRowsForCardResponse(db, "app_service_catalog", rows, columns, nil, actor, true); err != nil {
			t.Fatal(err)
		}
		_, present := rows[0]["cached_image"]
		if present != allowed {
			t.Fatal("another page's gallery authorization was reused", allowed, rows)
		}
	}
	if state.relationQueries != 4 || state.contentQueries != 2 {
		t.Fatal("gallery work was duplicated or shared across pages", state.relationQueries, state.contentQueries)
	}
}
