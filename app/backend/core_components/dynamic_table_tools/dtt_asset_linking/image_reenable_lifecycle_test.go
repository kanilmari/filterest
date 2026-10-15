// image_reenable_lifecycle_test.go
// Checks the T10 image toggle lifecycle before and after attachment removal.
// Connects real HTTP handlers, persisted upload specs and status responses.
// Separates an offline handler proof from the opt-in disposable PostgreSQL proof.
package dtt_asset_linking

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/runtime_grants/granttest"
)

// This driver retains the exact JSON written by the handlers; it does not model
// PostgreSQL constraints, triggers, permissions or transaction isolation.
type imageLifecycleDriver struct{ state *assetEnableState }
type imageLifecycleConn struct{ assetEnableConn }

func (d imageLifecycleDriver) Open(string) (driver.Conn, error) {
	return &imageLifecycleConn{assetEnableConn{state: d.state}}, nil
}

func (c *imageLifecycleConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "SELECT table_uid, schema_name") {
		return &legacyAssetEnableRows{columns: 2, values: [][]driver.Value{{int64(20), "public"}}}, nil
	}
	if strings.Contains(query, "ORDER BY tgt.table_name") {
		return &legacyAssetEnableRows{columns: 5, values: [][]driver.Value{
			{int64(30), "parent_assets", "parent", "parent_id", c.state.config},
		}}, nil
	}
	return c.assetEnableConn.QueryContext(ctx, query, args)
}

func (c *imageLifecycleConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "SET target_insert_specs = $1") {
		c.state.config = string(args[0].Value.([]byte))
		c.state.profile = true
	}
	return c.assetEnableConn.ExecContext(ctx, query, args)
}

func TestImageReenableAfterAttachmentRemoval(t *testing.T) {
	granttest.ConfigureRoles(t)
	state := &assetEnableState{t: t, table: true, relation: true}
	name := fmt.Sprintf("image_lifecycle_%d", atomic.AddInt64(&imageAssetLinkingDriverCounter, 1))
	sql.Register(name, imageLifecycleDriver{state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	withImageLinkingDB(t, db)
	checkImageReenableLifecycle(t, "parent", func(handler http.HandlerFunc, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := withImageLinkingTx(httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), db)
		handler(granttest.Recorder{ResponseRecorder: rec}, req)
		return rec
	}, func() FileUploadConfig {
		config, err := ParseFileUploadConfig([]byte(state.config))
		if err != nil {
			t.Fatal(err)
		}
		return config
	})
}

func TestImageReenableAfterAttachmentRemovalPostgres(t *testing.T) {
	db := previewTestDB(t)
	loadAssetTestBootstrap(t, db)
	withImageLinkingDB(t, db)
	const parent = "t10_image_reenable"
	if rec := postInLazyTransaction(t, db, dtt_crud_workflows.CreateTableHandler,
		`{"dataset_name":"`+parent+`","folder_id":4,"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`); rec.Code != http.StatusCreated {
		t.Fatalf("create dataset: %d %s", rec.Code, rec.Body)
	}
	checkImageReenableLifecycle(t, parent, func(handler http.HandlerFunc, body string) *httptest.ResponseRecorder {
		return postInLazyTransaction(t, db, handler, body)
	}, func() FileUploadConfig {
		var specs []byte
		if err := db.QueryRow(`SELECT r.target_insert_specs FROM system_foreign_key_relations_1_m r
			JOIN system_db_tables p ON p.table_uid = r.target_table_uid WHERE p.table_name = $1`, parent).Scan(&specs); err != nil {
			t.Fatal(err)
		}
		config, err := ParseFileUploadConfig(specs)
		if err != nil {
			t.Fatal(err)
		}
		return config
	})
}

// The same requests run with a recording driver and with a real disposable
// database. Every step compares persisted config with the admin status endpoint.
func checkImageReenableLifecycle(t *testing.T, parent string,
	post func(http.HandlerFunc, string) *httptest.ResponseRecorder, readConfig func() FileUploadConfig,
) {
	t.Helper()
	attachmentPresent, attachmentEnabled := false, false
	for _, step := range []struct {
		name    string
		handler http.HandlerFunc
		extra   string
		code    int
		image   bool
	}{
		{"enable images", EnableImageAssetLinkingHandler, "", 201, true},
		{"enable attachments", EnableAttachmentLinkingHandler, "", 201, true},
		{"disable images", DisableImageAssetLinkingHandler, "", 200, false},
		{"reenable images", UpdateImageAssetLinkingHandler, `,"enabled":true`, 200, true},
		{"disable attachments", DisableAttachmentLinkingHandler, "", 200, true},
		{"reenable attachments", EnableAttachmentLinkingHandler, "", 200, true},
		{"remove attachments", RemoveAttachmentLinkingHandler, `,"confirm":true`, 200, true},
		{"disable images alone", DisableImageAssetLinkingHandler, "", 200, false},
		{"reenable images alone", UpdateImageAssetLinkingHandler, `,"enabled":true`, 200, true},
	} {
		t.Run(step.name, func(t *testing.T) {
			rec := post(step.handler, `{"parent_table":"`+parent+`"`+step.extra+`}`)
			if rec.Code != step.code {
				t.Fatalf("POST: %d %s, want %d", rec.Code, rec.Body, step.code)
			}
			switch step.name {
			case "enable attachments", "reenable attachments":
				attachmentPresent, attachmentEnabled = true, true
			case "disable attachments":
				attachmentEnabled = false
			case "remove attachments":
				attachmentPresent, attachmentEnabled = false, false
				if decodeJSONBody(t, rec)["table_dropped"] != false {
					t.Fatal("attachment removal dropped the image table")
				}
			}
			config := readConfig()
			if profile, ok := config.Profiles[AssetProfileImage]; !ok || profile.Enabled != step.image {
				t.Fatalf("stored image profile = %+v, present=%v; want enabled=%v", profile, ok, step.image)
			}
			if profile, ok := config.Profiles[AssetProfileAttachment]; ok != attachmentPresent || (ok && profile.Enabled != attachmentEnabled) {
				t.Fatalf("stored attachment profile = %+v, present=%v", profile, ok)
			}
			if config.Enabled != (step.image || attachmentEnabled) {
				t.Fatalf("stored aggregate enabled = %v", config.Enabled)
			}
			if strings.HasPrefix(step.name, "reenable images") {
				answer := decodeJSONBody(t, rec)["updated_specs"].(map[string]interface{})["file_upload"].(map[string]interface{})
				if answer["enabled"] != true {
					t.Fatalf("update response stayed disabled: %s", rec.Body)
				}
			}
			status := httptest.NewRecorder()
			GetAssetLinkingStatusHandler(status, httptest.NewRequest(http.MethodGet, "/?table="+parent, nil))
			if status.Code != http.StatusOK {
				t.Fatalf("GET status: %d %s", status.Code, status.Body)
			}
			answer := decodeJSONBody(t, status)
			images := answer["image_asset_linkings"].([]interface{})
			if len(images) != 1 || images[0].(map[string]interface{})["enabled"] != step.image {
				t.Fatalf("image status disagrees with storage: %s", status.Body)
			}
			attachments := answer["attachment_asset_linkings"].([]interface{})
			wantAttachments := 0
			if attachmentPresent {
				wantAttachments = 1
			}
			if len(attachments) != wantAttachments || (attachmentPresent && attachments[0].(map[string]interface{})["enabled"] != attachmentEnabled) {
				t.Fatalf("attachment status disagrees with storage: %s", status.Body)
			}
			// The admin view reads this dedicated endpoint after each action.
			status = httptest.NewRecorder()
			GetImageAssetLinkingStatusHandler(status, httptest.NewRequest(http.MethodGet, "/?table="+parent, nil))
			if status.Code != http.StatusOK {
				t.Fatalf("GET image status: %d %s", status.Code, status.Body)
			}
			images = decodeJSONBody(t, status)["asset_linkings"].([]interface{})
			if len(images) != 1 || images[0].(map[string]interface{})["enabled"] != step.image {
				t.Fatalf("admin image status disagrees with storage: %s", status.Body)
			}
		})
	}
}
