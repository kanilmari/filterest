// card_support_enrichment_driver_test.go
// Provides the shared database driver for this package’s tests.
// Reuses existing package fixtures for offline regression checks.
// Keeps the request and permission contracts covered without a live site.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
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
	if strings.Contains(query, "SELECT table_uid FROM system_db_tables") {
		return &legacyImageMockRows{columns: []string{"uid"}, rows: [][]driver.Value{{int64(104)}}}, nil
	}
	if strings.Contains(query, "system_group_table_func_rights") {
		return &legacyImageMockRows{columns: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}}, nil
	}
	if strings.Contains(query, "must_be_true_unless_own") {
		return &legacyImageMockRows{columns: []string{"column_name"}}, nil
	}
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
	if strings.Contains(query, "SELECT table_uid FROM system_db_tables") {
		return &legacyImageMockRows{columns: []string{"uid"}, rows: [][]driver.Value{{int64(104)}}}, nil
	}
	if strings.Contains(query, "system_group_table_func_rights") {
		return &legacyImageMockRows{columns: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}}, nil
	}
	if strings.Contains(query, "must_be_true_unless_own") {
		return &legacyImageMockRows{columns: []string{"column_name"}}, nil
	}
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
