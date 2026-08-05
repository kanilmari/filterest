package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	backend "easelect/backend/core_components"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

type canonicalAssetMockDriver struct{}

type canonicalAssetMockConn struct{}

type mixedCanonicalFallbackMockDriver struct{}

type mixedCanonicalFallbackMockConn struct{}

type relationDiscoveredCanonicalAssetMockDriver struct{}

type relationDiscoveredCanonicalAssetMockConn struct{}

type customNamedCanonicalAssetMockDriver struct{}

type customNamedCanonicalAssetMockConn struct{}

type attachmentOnlySharedAssetMockDriver struct{}

type attachmentOnlySharedAssetMockConn struct{}

type explicitNonImageLegacyRelationMockDriver struct{}

type explicitNonImageLegacyRelationMockConn struct{}

type legacyImageMockRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var legacyImageMockCounter int64

func (canonicalAssetMockDriver) Open(string) (driver.Conn, error) {
	return &canonicalAssetMockConn{}, nil
}

func (mixedCanonicalFallbackMockDriver) Open(string) (driver.Conn, error) {
	return &mixedCanonicalFallbackMockConn{}, nil
}

func (relationDiscoveredCanonicalAssetMockDriver) Open(string) (driver.Conn, error) {
	return &relationDiscoveredCanonicalAssetMockConn{}, nil
}

func (customNamedCanonicalAssetMockDriver) Open(string) (driver.Conn, error) {
	return &customNamedCanonicalAssetMockConn{}, nil
}

func (attachmentOnlySharedAssetMockDriver) Open(string) (driver.Conn, error) {
	return &attachmentOnlySharedAssetMockConn{}, nil
}

func (explicitNonImageLegacyRelationMockDriver) Open(string) (driver.Conn, error) {
	return &explicitNonImageLegacyRelationMockConn{}, nil
}

func (*canonicalAssetMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*canonicalAssetMockConn) Close() error {
	return nil
}

func (*canonicalAssetMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (*mixedCanonicalFallbackMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*mixedCanonicalFallbackMockConn) Close() error {
	return nil
}

func (*mixedCanonicalFallbackMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (*relationDiscoveredCanonicalAssetMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*relationDiscoveredCanonicalAssetMockConn) Close() error {
	return nil
}

func (*relationDiscoveredCanonicalAssetMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (*customNamedCanonicalAssetMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*customNamedCanonicalAssetMockConn) Close() error {
	return nil
}

func (*customNamedCanonicalAssetMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (*attachmentOnlySharedAssetMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*attachmentOnlySharedAssetMockConn) Close() error {
	return nil
}

func (*attachmentOnlySharedAssetMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (*explicitNonImageLegacyRelationMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("prepare not implemented")
}

func (*explicitNonImageLegacyRelationMockConn) Close() error {
	return nil
}

func (*explicitNonImageLegacyRelationMockConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("begin not implemented")
}

func (*canonicalAssetMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &legacyImageMockRows{
			columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows:    [][]driver.Value{},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &legacyImageMockRows{
			columns: []string{"table_name", "source_column_name"},
			rows:    [][]driver.Value{},
		}, nil
	case strings.Contains(query, "FROM information_schema.tables"):
		tableName, _ := args[0].Value.(string)
		exists := tableName == "app_service_catalog_assets"
		return &legacyImageMockRows{
			columns: []string{"exists"},
			rows:    [][]driver.Value{{exists}},
		}, nil
	case strings.Contains(query, "FROM information_schema.columns"):
		return &legacyImageMockRows{
			columns: []string{"column_name", "data_type"},
			rows: [][]driver.Value{
				{"id", "integer"},
				{"created", "timestamp with time zone"},
				{"app_service_catalog_id", "integer"},
				{"asset_kind", "text"},
				{"filename", "character varying"},
				{"type_id", "integer"},
				{"metadata_json", "jsonb"},
				{"title", "text"},
				{"original_name", "text"},
				{"sort_order", "integer"},
				{"is_primary", "boolean"},
			},
		}, nil
	case strings.Contains(query, `FROM "app_service_catalog_assets"`):
		return &legacyImageMockRows{
			columns: []string{"app_service_catalog_id", "filename", "type_id", "metadata_json", "title", "original_name"},
			rows: [][]driver.Value{
				{[]byte("161"), "canonical_161.png", int64(1), `{"logo_variant":"firefox"}`, "Firefox logo", "firefox.svg"},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (*mixedCanonicalFallbackMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &legacyImageMockRows{
			columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{
				{"app_service_gallery", "app_service_catalog", "service_id", []byte(`{"file_upload":{"profile_key":"image","asset_kinds":["image"],"target_directory":"media"}}`)},
			},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &legacyImageMockRows{
			columns: []string{"table_name", "source_column_name"},
			rows: [][]driver.Value{
				{"app_service_catalog_assets", "app_service_catalog_id"},
				{"app_service_gallery", "service_id"},
			},
		}, nil
	case strings.Contains(query, "FROM information_schema.tables"):
		tableName, _ := args[0].Value.(string)
		exists := tableName == "app_service_catalog_assets" || tableName == "app_service_gallery"
		return &legacyImageMockRows{
			columns: []string{"exists"},
			rows:    [][]driver.Value{{exists}},
		}, nil
	case strings.Contains(query, "FROM information_schema.columns"):
		tableName, _ := args[0].Value.(string)
		if tableName == "app_service_catalog_assets" {
			return &legacyImageMockRows{
				columns: []string{"column_name", "data_type"},
				rows: [][]driver.Value{
					{"id", "integer"},
					{"created", "timestamp with time zone"},
					{"app_service_catalog_id", "integer"},
					{"asset_kind", "text"},
					{"filename", "character varying"},
					{"sort_order", "integer"},
					{"is_primary", "boolean"},
				},
			}, nil
		}
		if tableName == "app_service_gallery" {
			return &legacyImageMockRows{
				columns: []string{"column_name", "data_type"},
				rows: [][]driver.Value{
					{"updated", "timestamp with time zone"},
					{"filename", "character varying"},
					{"id", "integer"},
					{"created", "timestamp with time zone"},
					{"service_id", "integer"},
				},
			}, nil
		}
		return nil, fmt.Errorf("unexpected information_schema.columns query for table %s", tableName)
	case strings.Contains(query, `FROM "app_service_catalog_assets"`):
		return &legacyImageMockRows{
			columns: []string{"app_service_catalog_id", "filename", "type_id", "metadata_json", "title", "original_name"},
			rows:    [][]driver.Value{},
		}, nil
	case strings.Contains(query, `FROM "app_service_gallery"`):
		return &legacyImageMockRows{
			columns: []string{"service_id", "filename", "type_id", "metadata_json", "title", "original_name"},
			rows: [][]driver.Value{
				{[]byte("161"), "104_161_55.png", int64(0), "", "", ""},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (*relationDiscoveredCanonicalAssetMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &legacyImageMockRows{
			columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows:    [][]driver.Value{},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &legacyImageMockRows{
			columns: []string{"table_name", "source_column_name"},
			rows: [][]driver.Value{
				{"custom_gallery_assets", "gallery_item_id"},
			},
		}, nil
	case strings.Contains(query, "FROM information_schema.tables"):
		tableName, _ := args[0].Value.(string)
		exists := tableName == "custom_gallery_assets"
		return &legacyImageMockRows{
			columns: []string{"exists"},
			rows:    [][]driver.Value{{exists}},
		}, nil
	case strings.Contains(query, "FROM information_schema.columns"):
		return &legacyImageMockRows{
			columns: []string{"column_name", "data_type"},
			rows: [][]driver.Value{
				{"id", "integer"},
				{"created", "timestamp with time zone"},
				{"gallery_item_id", "integer"},
				{"asset_kind", "text"},
				{"filename", "character varying"},
				{"sort_order", "integer"},
				{"is_primary", "boolean"},
			},
		}, nil
	case strings.Contains(query, `FROM "custom_gallery_assets"`):
		return &legacyImageMockRows{
			columns: []string{"gallery_item_id", "filename", "type_id", "metadata_json", "title", "original_name"},
			rows: [][]driver.Value{
				{[]byte("161"), "canonical_161.png", int64(0), "", "", ""},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (*customNamedCanonicalAssetMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &legacyImageMockRows{
			columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows:    [][]driver.Value{},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &legacyImageMockRows{
			columns: []string{"table_name", "source_column_name"},
			rows: [][]driver.Value{
				{"custom_gallery_media", "gallery_item_id"},
			},
		}, nil
	case strings.Contains(query, "FROM information_schema.tables"):
		tableName, _ := args[0].Value.(string)
		exists := tableName == "custom_gallery_media"
		return &legacyImageMockRows{
			columns: []string{"exists"},
			rows:    [][]driver.Value{{exists}},
		}, nil
	case strings.Contains(query, "FROM information_schema.columns"):
		return &legacyImageMockRows{
			columns: []string{"column_name", "data_type"},
			rows: [][]driver.Value{
				{"id", "integer"},
				{"created", "timestamp with time zone"},
				{"gallery_item_id", "integer"},
				{"asset_kind", "text"},
				{"filename", "character varying"},
				{"sort_order", "integer"},
				{"is_primary", "boolean"},
			},
		}, nil
	case strings.Contains(query, `FROM "custom_gallery_media"`):
		return &legacyImageMockRows{
			columns: []string{"gallery_item_id", "filename", "type_id", "metadata_json", "title", "original_name"},
			rows: [][]driver.Value{
				{[]byte("161"), "media_161.png", int64(0), "", "", ""},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (*attachmentOnlySharedAssetMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &legacyImageMockRows{
			columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{
				{"contracts_assets", "contracts", "contracts_id", []byte(`{"file_upload":{"profile_key":"asset_linking","profiles":{"attachment":{"asset_kinds":["pdf"],"target_directory":"attachments"}}}}`)},
			},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &legacyImageMockRows{
			columns: []string{"table_name", "source_column_name"},
			rows:    [][]driver.Value{},
		}, nil
	case strings.Contains(query, "FROM information_schema.tables"):
		tableName, _ := args[0].Value.(string)
		exists := tableName == "contracts_assets"
		return &legacyImageMockRows{
			columns: []string{"exists"},
			rows:    [][]driver.Value{{exists}},
		}, nil
	case strings.Contains(query, "FROM information_schema.columns"):
		return &legacyImageMockRows{
			columns: []string{"column_name", "data_type"},
			rows: [][]driver.Value{
				{"id", "integer"},
				{"created", "timestamp with time zone"},
				{"contracts_id", "integer"},
				{"asset_kind", "text"},
				{"filename", "character varying"},
				{"sort_order", "integer"},
				{"is_primary", "boolean"},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (*explicitNonImageLegacyRelationMockConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "target_insert_specs"):
		return &legacyImageMockRows{
			columns: []string{"child_table", "parent_table", "source_column_name", "target_insert_specs"},
			rows: [][]driver.Value{
				{"manual_files", "manuals", "manual_id", []byte(`{"file_upload":{"profile_key":"attachment","asset_kinds":["pdf"],"target_directory":"attachments"}}`)},
			},
		}, nil
	case strings.Contains(query, "FROM system_foreign_key_relations_1_m"):
		return &legacyImageMockRows{
			columns: []string{"table_name", "source_column_name"},
			rows: [][]driver.Value{
				{"manual_files", "manual_id"},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func (r *legacyImageMockRows) Columns() []string {
	return append([]string(nil), r.columns...)
}

func (*legacyImageMockRows) Close() error {
	return nil
}

func (r *legacyImageMockRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func openCanonicalAssetMockDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("canonical_asset_mock_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(driverName, canonicalAssetMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func openMixedCanonicalFallbackMockDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("mixed_canonical_fallback_mock_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(driverName, mixedCanonicalFallbackMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func openRelationDiscoveredCanonicalAssetMockDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("relation_discovered_canonical_asset_mock_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(driverName, relationDiscoveredCanonicalAssetMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func openCustomNamedCanonicalAssetMockDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("custom_named_canonical_asset_mock_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(driverName, customNamedCanonicalAssetMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func openAttachmentOnlySharedAssetMockDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("attachment_only_shared_asset_mock_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(driverName, attachmentOnlySharedAssetMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func openExplicitNonImageLegacyRelationMockDB(t *testing.T) *sql.DB {
	t.Helper()
	driverName := fmt.Sprintf("explicit_non_image_legacy_relation_mock_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
	sql.Register(driverName, explicitNonImageLegacyRelationMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open mock: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

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
	got, err := discoverCanonicalAssetImageConfig(openAttachmentOnlySharedAssetMockDB(t), "contracts")
	if err != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) = %#v, want nil when shared asset metadata is attachment-only", got)
	}
}

func TestDiscoverCanonicalAssetImageConfigFallsBackToFKCandidatesWhenOnlyLegacyMetadataExists(t *testing.T) {
	got, err := discoverCanonicalAssetImageConfig(openMixedCanonicalFallbackMockDB(t), "app_service_catalog")
	if err != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("discoverCanonicalAssetImageConfig(...) = nil, want FK-discovered canonical asset config")
	}
	if got.childTable != "app_service_catalog_assets" {
		t.Fatalf("childTable = %q, want app_service_catalog_assets", got.childTable)
	}
	if got.foreignKeyName != "app_service_catalog_id" {
		t.Fatalf("foreignKeyName = %q, want app_service_catalog_id", got.foreignKeyName)
	}
}

func TestDiscoverCanonicalAssetImageConfigPrefersFKMetadataBeforeParentAssetsGuess(t *testing.T) {
	got, err := discoverCanonicalAssetImageConfig(openRelationDiscoveredCanonicalAssetMockDB(t), "gallery_items")
	if err != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("discoverCanonicalAssetImageConfig(...) = nil, want discovered custom asset config")
	}
	if got.childTable != "custom_gallery_assets" {
		t.Fatalf("childTable = %q, want custom_gallery_assets", got.childTable)
	}
	if got.foreignKeyName != "gallery_item_id" {
		t.Fatalf("foreignKeyName = %q, want gallery_item_id", got.foreignKeyName)
	}
}

func TestDiscoverCanonicalAssetImageConfigFindsCustomNamedAssetTableWithoutSuffix(t *testing.T) {
	got, err := discoverCanonicalAssetImageConfig(openCustomNamedCanonicalAssetMockDB(t), "gallery_items")
	if err != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("discoverCanonicalAssetImageConfig(...) = nil, want discovered custom asset config")
	}
	if got.childTable != "custom_gallery_media" {
		t.Fatalf("childTable = %q, want custom_gallery_media", got.childTable)
	}
	if got.foreignKeyName != "gallery_item_id" {
		t.Fatalf("foreignKeyName = %q, want gallery_item_id", got.foreignKeyName)
	}
}

func TestDiscoverCanonicalAssetImageConfigSkipsParentAssetsGuessWhenNonSharedMetadataExists(t *testing.T) {
	got, err := discoverCanonicalAssetImageConfig(openExplicitNonImageLegacyRelationMockDB(t), "manuals")
	if err != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("discoverCanonicalAssetImageConfig(...) = %#v, want nil when explicit non-shared metadata exists", got)
	}
}

func TestSingularizeLegacyTableTokenHandlesPluralTrailingSegment(t *testing.T) {
	if got := singularizeLegacyTableToken("tasks"); got != "task" {
		t.Fatalf("singularizeLegacyTableToken(tasks) = %q, want %q", got, "task")
	}
	if got := singularizeLegacyTableToken("categories"); got != "category" {
		t.Fatalf("singularizeLegacyTableToken(categories) = %q, want %q", got, "category")
	}
}

func TestCollectRowsMissingCardImageValuesKeepsExistingImagesWhenCompanionMetadataExists(t *testing.T) {
	rows := []map[string]interface{}{
		{"id": int64(161), "cached_image": "104_161_55.png", "cached_image_type_id": int64(1)},
		{"id": "162", "cached_image": ""},
		{"id": float64(163), "image_url": "/storage/foo.png"},
		{"id": 164},
	}

	got := collectRowsMissingCardImageValues(rows, []string{"cached_image"})
	want := []int64{162, 163, 164}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collectRowsMissingCardImageValues(...) = %#v, want %#v", got, want)
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
	})

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
	})

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
