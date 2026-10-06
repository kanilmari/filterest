// card_support_enrichment_test.go
// Verifies existing handlers and their transactional permission boundary.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"reflect"
	"testing"
)

func TestCollectHiddenCardSupportColumnsReturnsOnlyHiddenImageRoles(t *testing.T) {
	columnsMap := map[int]dtt_models.ColumnInfo{
		1: {
			ColumnName:  "header",
			CoNumber:    1,
			CardElement: "header",
		},
		2: {
			ColumnName:  "cached_image",
			CoNumber:    8,
			CardElement: "image",
		},
		3: {
			ColumnName:  "thumbnail_image",
			CoNumber:    9,
			CardElement: "image",
		},
		4: {
			ColumnName:  "cached_username",
			CoNumber:    10,
			CardElement: "username",
		},
	}

	got := collectHiddenCardSupportColumns(columnsMap, []string{"header", "cached_username"})
	want := []string{"cached_image", "thumbnail_image"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collectHiddenCardSupportColumns(...) = %#v, want %#v", got, want)
	}
}

func TestCollectCardSupportRowIDsDeduplicatesAndNormalizesIDs(t *testing.T) {
	rows := []map[string]interface{}{
		{"id": int64(161)},
		{"id": "161"},
		{"id": float64(162)},
		{"id": nil},
	}

	got := collectCardSupportRowIDs(rows)
	want := []int64{161, 162}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collectCardSupportRowIDs(...) = %#v, want %#v", got, want)
	}
}

func TestCoerceCardSupportRowIDRejectsUnsupportedValues(t *testing.T) {
	if _, ok := coerceCardSupportRowID(struct{}{}); ok {
		t.Fatal("coerceCardSupportRowID should reject unsupported value types")
	}
	if _, ok := coerceCardSupportRowID("not-a-number"); ok {
		t.Fatal("coerceCardSupportRowID should reject non-numeric strings")
	}
}

func TestCoerceCardSupportRowIDAcceptsByteSliceNumbers(t *testing.T) {
	got, ok := coerceCardSupportRowID([]byte("161"))
	if !ok {
		t.Fatal("coerceCardSupportRowID should accept numeric byte slices")
	}
	if got != 161 {
		t.Fatalf("coerceCardSupportRowID([]byte(\"161\")) = %d, want %d", got, 161)
	}
}

func TestDiscoverCanonicalAssetImageConfigDoesNotGuessParentAssetsWhenSharedAssetMetadataIsAttachmentOnly(t *testing.T) {
	got, err := dtt_card_picture.PictureRelationOf(openAttachmentOnlySharedAssetMockDB(t), "contracts")
	if err != nil {
		t.Fatalf("PictureRelationOf(...) returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("PictureRelationOf(...) = %#v, want nil when shared asset metadata is attachment-only", got)
	}
}

func TestDiscoverCanonicalAssetImageConfigFallsBackToFKCandidatesWhenOnlyLegacyMetadataExists(t *testing.T) {
	got, err := dtt_card_picture.PictureRelationOf(openMixedCanonicalFallbackMockDB(t), "app_service_catalog")
	if err != nil {
		t.Fatalf("PictureRelationOf(...) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("PictureRelationOf(...) = nil, want FK-discovered canonical asset config")
	}
	if got.ChildTable != "app_service_catalog_assets" {
		t.Fatalf("childTable = %q, want app_service_catalog_assets", got.ChildTable)
	}
	if got.ForeignKey != "app_service_catalog_id" {
		t.Fatalf("foreignKeyName = %q, want app_service_catalog_id", got.ForeignKey)
	}
}

func TestDiscoverCanonicalAssetImageConfigPrefersFKMetadataBeforeParentAssetsGuess(t *testing.T) {
	got, err := dtt_card_picture.PictureRelationOf(openRelationDiscoveredCanonicalAssetMockDB(t), "gallery_items")
	if err != nil {
		t.Fatalf("PictureRelationOf(...) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("PictureRelationOf(...) = nil, want discovered custom asset config")
	}
	if got.ChildTable != "custom_gallery_assets" {
		t.Fatalf("childTable = %q, want custom_gallery_assets", got.ChildTable)
	}
	if got.ForeignKey != "gallery_item_id" {
		t.Fatalf("foreignKeyName = %q, want gallery_item_id", got.ForeignKey)
	}
}

func TestDiscoverCanonicalAssetImageConfigFindsCustomNamedAssetTableWithoutSuffix(t *testing.T) {
	got, err := dtt_card_picture.PictureRelationOf(openCustomNamedCanonicalAssetMockDB(t), "gallery_items")
	if err != nil {
		t.Fatalf("PictureRelationOf(...) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("PictureRelationOf(...) = nil, want discovered custom asset config")
	}
	if got.ChildTable != "custom_gallery_media" {
		t.Fatalf("childTable = %q, want custom_gallery_media", got.ChildTable)
	}
	if got.ForeignKey != "gallery_item_id" {
		t.Fatalf("foreignKeyName = %q, want gallery_item_id", got.ForeignKey)
	}
}

func TestDiscoverCanonicalAssetImageConfigSkipsParentAssetsGuessWhenNonSharedMetadataExists(t *testing.T) {
	got, err := dtt_card_picture.PictureRelationOf(openExplicitNonImageLegacyRelationMockDB(t), "manuals")
	if err != nil {
		t.Fatalf("PictureRelationOf(...) returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("PictureRelationOf(...) = %#v, want nil when explicit non-shared metadata exists", got)
	}
}

func TestApplyLegacyChildImageValuesFillsOnlyRowsStillMissingImage(t *testing.T) {
	rows := []map[string]interface{}{
		{"id": int64(161)},
		{"id": "162", "cached_image": "already.png"},
		{"id": float64(163), "image_url": "/storage/163.png"},
	}

	applyLegacyChildImageValues(rows, map[string]canonicalAssetImageValue{
		"161": {filename: "104_161_55.png"},
		"162": {filename: "should-not-overwrite.png"},
		"163": {filename: "should-not-overwrite.png"},
	}, "104")

	if got := rows[0]["cached_image"]; got != "104_161_55.png" {
		t.Fatalf("rows[0].cached_image = %#v, want %#v", got, "104_161_55.png")
	}
	if got := rows[1]["cached_image"]; got != "already.png" {
		t.Fatalf("rows[1].cached_image = %#v, want %#v", got, "already.png")
	}
	if _, exists := rows[2]["cached_image"]; exists {
		t.Fatalf("rows[2] should not receive cached_image when image_url already exists: %#v", rows[2]["cached_image"])
	}
}

func TestApplyLegacyChildImageValuesAddsCompanionMetadataForMatchingCachedImage(t *testing.T) {
	rows := []map[string]interface{}{
		{"id": int64(161), "cached_image": "/storage/104/161/300/104_161_55.svg"},
	}

	applyLegacyChildImageValues(rows, map[string]canonicalAssetImageValue{
		"161": {
			filename:     "104_161_55.svg",
			typeID:       int64(1),
			metadataJSON: `{"logo_variant":"firefox"}`,
			title:        "Firefox",
		},
	}, "104")

	if got := rows[0]["cached_image"]; got != "/storage/104/161/300/104_161_55.svg" {
		t.Fatalf("rows[0].cached_image = %#v, want existing storage path", got)
	}
	if got := rows[0]["cached_image_type_id"]; got != int64(1) {
		t.Fatalf("rows[0].cached_image_type_id = %#v, want %#v", got, int64(1))
	}
	if got := rows[0]["cached_image_metadata_json"]; got != `{"logo_variant":"firefox"}` {
		t.Fatalf("rows[0].cached_image_metadata_json = %#v, want logo metadata", got)
	}
}

func TestEnrichRowsWithCardSupportColumnsPrefersCanonicalAssetImages(t *testing.T) {
	origBackendDB := backend.Db
	backend.Db = nil
	t.Cleanup(func() { backend.Db = origBackendDB })

	rows := []map[string]interface{}{
		{"id": int64(161), "header": "Binance"},
	}
	columnsMap := map[int]dtt_models.ColumnInfo{
		1: {
			ColumnName:  "header",
			CoNumber:    1,
			CardElement: "header",
		},
	}

	err := enrichRowsWithCardSupportColumns(
		openCanonicalAssetMockDB(t),
		"app_service_catalog",
		rows,
		columnsMap,
		[]string{"header"},
		dbutils.NewRequestActorContext(2, "admin"),
		nil,
	)
	if err != nil {
		t.Fatalf("enrichRowsWithCardSupportColumns returned error: %v", err)
	}

	if got := rows[0]["cached_image"]; got != "canonical_161.png" {
		t.Fatalf("rows[0].cached_image = %#v, want %#v", got, "canonical_161.png")
	}
	if got := rows[0]["cached_image_type_id"]; got != int64(1) {
		t.Fatalf("rows[0].cached_image_type_id = %#v, want %#v", got, int64(1))
	}
	if got := rows[0]["cached_image_metadata_json"]; got != `{"logo_variant":"firefox"}` {
		t.Fatalf("rows[0].cached_image_metadata_json = %#v, want logo metadata", got)
	}
}

func TestEnrichRowsWithCardSupportColumnsDoesNotFallBackToLegacyWhenCanonicalAssetTableHasNoImages(t *testing.T) {
	origBackendDB := backend.Db
	backend.Db = nil
	t.Cleanup(func() { backend.Db = origBackendDB })

	rows := []map[string]interface{}{
		{"id": int64(161), "header": "Binance"},
	}
	columnsMap := map[int]dtt_models.ColumnInfo{
		1: {
			ColumnName:  "header",
			CoNumber:    1,
			CardElement: "header",
		},
	}

	err := enrichRowsWithCardSupportColumns(
		openMixedCanonicalFallbackMockDB(t),
		"app_service_catalog",
		rows,
		columnsMap,
		[]string{"header"},
		dbutils.NewRequestActorContext(2, "admin"),
		nil,
	)
	if err != nil {
		t.Fatalf("enrichRowsWithCardSupportColumns returned error: %v", err)
	}

	if _, exists := rows[0]["cached_image"]; exists {
		t.Fatalf("rows[0] should stay without cached_image when canonical assets have no images: %#v", rows[0]["cached_image"])
	}
}

func TestAppendHiddenCardSupportColumnUIDsAddsOnlyHiddenImageColumns(t *testing.T) {
	columnsMap := map[int]dtt_models.ColumnInfo{
		1: {
			ColumnName:  "header",
			CoNumber:    1,
			CardElement: "header",
		},
		2: {
			ColumnName:  "cached_image",
			CoNumber:    2,
			CardElement: "image",
		},
		3: {
			ColumnName:  "description",
			CoNumber:    3,
			CardElement: "description",
		},
	}

	augmentedUIDs, hiddenSupportColumns := appendHiddenCardSupportColumnUIDs(
		columnsMap,
		[]string{"header", "description"},
		[]int{1, 3},
	)

	if !reflect.DeepEqual(hiddenSupportColumns, []string{"cached_image"}) {
		t.Fatalf("hiddenSupportColumns = %#v, want %#v", hiddenSupportColumns, []string{"cached_image"})
	}
	if !reflect.DeepEqual(augmentedUIDs, []int{1, 3, 2}) {
		t.Fatalf("augmentedUIDs = %#v, want %#v", augmentedUIDs, []int{1, 3, 2})
	}
}

func TestRowsAlreadyContainCardSupportColumnsChecksAllRows(t *testing.T) {
	rowsWithSupport := []map[string]interface{}{
		{"id": int64(1), "cached_image": "a.png"},
		{"id": int64(2), "cached_image": nil},
	}
	if !rowsAlreadyContainCardSupportColumns(rowsWithSupport, []string{"cached_image"}) {
		t.Fatalf("rowsAlreadyContainCardSupportColumns should report true when every row already has the support key")
	}

	rowsMissingSupport := []map[string]interface{}{
		{"id": int64(1), "cached_image": "a.png"},
		{"id": int64(2)},
	}
	if rowsAlreadyContainCardSupportColumns(rowsMissingSupport, []string{"cached_image"}) {
		t.Fatalf("rowsAlreadyContainCardSupportColumns should report false when any row is missing the support key")
	}
}
