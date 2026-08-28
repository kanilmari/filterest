package dtt_asset_linking

import (
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetAssetLinkingStatusHandlerReturnsBothProfilesFromOneQuery(t *testing.T) {
	specs := []byte(`{"file_upload":{"enabled":true,"profiles":{"image":{"enabled":true,"asset_kinds":["image"],"cache_targets":[{"table":"articles","column":"cached_image"}],"max_file_size_mb":10,"target_directory":"media","allowed_file_types":["png"]},"attachment":{"enabled":false,"asset_kinds":["pdf"],"cache_targets":[],"max_file_size_mb":20,"target_directory":"docs","allowed_file_types":["pdf"]}}}}`)
	db, _ := openImageLinkingMockDB(t, []imageAssetLinkingQueryResponse{
		{
			match: "FROM system_foreign_key_relations_1_m",
			cols:  []string{"id", "child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{
				{int64(1), "articles_assets", "articles", "articles_id", specs},
			},
		},
	}, nil)
	withImageLinkingDB(t, db)

	req := httptest.NewRequest(http.MethodGet, "/api/asset-linking/status?table=articles", nil)
	rec := httptest.NewRecorder()

	GetAssetLinkingStatusHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	body := decodeJSONBody(t, rec)
	imageRows, ok := body["image_asset_linkings"].([]interface{})
	if !ok || len(imageRows) != 1 {
		t.Fatalf("image_asset_linkings = %#v, want one parsed image result", body["image_asset_linkings"])
	}
	attachmentRows, ok := body["attachment_asset_linkings"].([]interface{})
	if !ok || len(attachmentRows) != 1 {
		t.Fatalf("attachment_asset_linkings = %#v, want one parsed attachment result", body["attachment_asset_linkings"])
	}
}
