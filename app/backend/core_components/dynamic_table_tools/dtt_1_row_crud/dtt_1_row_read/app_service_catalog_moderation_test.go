package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sync/atomic"
	"testing"

	dbutils "easelect/backend/core_components/dbutils"
)

type serviceCatalogModerationMockDriver struct{}
type serviceCatalogModerationMockConn struct{}
type serviceCatalogModerationMockRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

var serviceCatalogModerationMockCounter int64

func (serviceCatalogModerationMockDriver) Open(string) (driver.Conn, error) {
	return &serviceCatalogModerationMockConn{}, nil
}

func (*serviceCatalogModerationMockConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not implemented")
}

func (*serviceCatalogModerationMockConn) Close() error { return nil }
func (*serviceCatalogModerationMockConn) Begin() (driver.Tx, error) {
	return nil, errors.New("begin not implemented")
}

func (*serviceCatalogModerationMockConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if query == "" {
		return nil, errors.New("query missing")
	}
	return &serviceCatalogModerationMockRows{
		columns: []string{"id", "user_id", "published", "enabled", "admin_reviewed", "admin_approved"},
		rows: [][]driver.Value{
			{int64(11), nil, true, true, nil, nil},
		},
	}, nil
}

func (r *serviceCatalogModerationMockRows) Columns() []string { return r.columns }
func (*serviceCatalogModerationMockRows) Close() error        { return nil }
func (r *serviceCatalogModerationMockRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

func TestEnrichServiceCatalogModerationRowsAdminSeesAllRows(t *testing.T) {
	originalReader := serviceCatalogModerationReader
	t.Cleanup(func() {
		serviceCatalogModerationReader = originalReader
	})

	serviceCatalogModerationReader = func(_ dbutils.Querier, rowIDs []int64) (map[int64]serviceCatalogModerationRecord, error) {
		if !reflect.DeepEqual(rowIDs, []int64{11, 12}) {
			t.Fatalf("rowIDs = %#v, want [11 12]", rowIDs)
		}
		return map[int64]serviceCatalogModerationRecord{
			11: {
				OwnerUserID: 7,
				Values: map[string]interface{}{
					"published":      true,
					"enabled":        true,
					"admin_reviewed": false,
					"admin_approved": true,
				},
			},
			12: {
				OwnerUserID: 8,
				Values: map[string]interface{}{
					"published":      false,
					"enabled":        true,
					"admin_reviewed": true,
					"admin_approved": false,
				},
			},
		}, nil
	}

	rows := []map[string]interface{}{
		{"id": int64(11), "header": "Firefox"},
		{"id": "12", "header": "Brave"},
	}

	if err := enrichServiceCatalogModerationRows(nil, serviceCatalogModerationTableName, rows, "admin", 99); err != nil {
		t.Fatalf("enrichServiceCatalogModerationRows returned error: %v", err)
	}

	if rows[0]["published"] != true || rows[1]["admin_approved"] != false {
		t.Fatalf("admin enrichment = %#v, %#v", rows[0], rows[1])
	}
}

func TestEnrichServiceCatalogModerationRowsOwnerOnlyForNonAdmin(t *testing.T) {
	originalReader := serviceCatalogModerationReader
	t.Cleanup(func() {
		serviceCatalogModerationReader = originalReader
	})

	serviceCatalogModerationReader = func(_ dbutils.Querier, _ []int64) (map[int64]serviceCatalogModerationRecord, error) {
		return map[int64]serviceCatalogModerationRecord{
			11: {
				OwnerUserID: 7,
				Values: map[string]interface{}{
					"published":      true,
					"enabled":        true,
					"admin_reviewed": false,
					"admin_approved": false,
				},
			},
			12: {
				OwnerUserID: 8,
				Values: map[string]interface{}{
					"published":      false,
					"enabled":        false,
					"admin_reviewed": true,
					"admin_approved": true,
				},
			},
		}, nil
	}

	rows := []map[string]interface{}{
		{"id": int64(11), "header": "Owner row"},
		{"id": int64(12), "header": "Someone else"},
	}

	if err := enrichServiceCatalogModerationRows(nil, serviceCatalogModerationTableName, rows, "basic", 7); err != nil {
		t.Fatalf("enrichServiceCatalogModerationRows returned error: %v", err)
	}

	if rows[0]["published"] != true {
		t.Fatalf("owner row missing published flag: %#v", rows[0])
	}
	for _, columnName := range serviceCatalogModerationColumns {
		if _, exists := rows[1][columnName]; exists {
			t.Fatalf("non-owner row leaked %s: %#v", columnName, rows[1])
		}
	}
}

func TestEnrichServiceCatalogModerationRowsPropagatesReaderErrors(t *testing.T) {
	originalReader := serviceCatalogModerationReader
	t.Cleanup(func() {
		serviceCatalogModerationReader = originalReader
	})

	serviceCatalogModerationReader = func(_ dbutils.Querier, _ []int64) (map[int64]serviceCatalogModerationRecord, error) {
		return nil, errors.New("boom")
	}

	err := enrichServiceCatalogModerationRows(
		nil,
		serviceCatalogModerationTableName,
		[]map[string]interface{}{{"id": int64(11)}},
		"admin",
		1,
	)
	if err == nil || err.Error() != "boom" {
		t.Fatalf("err = %v, want boom", err)
	}
}

func TestEnrichServiceCatalogModerationDataTypesAddsBigCardMetadata(t *testing.T) {
	dataTypes := map[string]interface{}{
		"header": map[string]interface{}{
			"card_element": "header",
		},
		"admin_reviewed": map[string]interface{}{
			"data_type":          "boolean",
			"card_element":       "hidden",
			"show_value_on_card": false,
		},
	}

	enrichedDataTypes := enrichServiceCatalogModerationDataTypes(serviceCatalogModerationTableName, dataTypes)

	for _, columnName := range serviceCatalogModerationColumns {
		columnInfo, ok := enrichedDataTypes[columnName].(map[string]interface{})
		if !ok {
			t.Fatalf("%s metadata missing after enrichment", columnName)
		}
		if columnInfo["card_element"] != "details" {
			t.Fatalf("%s card_element = %#v, want details", columnName, columnInfo["card_element"])
		}
		if columnInfo["show_key_on_card"] != true || columnInfo["show_value_on_card"] != true {
			t.Fatalf("%s big-card visibility flags = %#v", columnName, columnInfo)
		}
		if columnInfo["hide_on_small_card"] != true {
			t.Fatalf("%s hide_on_small_card = %#v, want true", columnName, columnInfo["hide_on_small_card"])
		}
	}

	if dataTypes["published"] != nil || dataTypes["enabled"] != nil {
		t.Fatalf("source dataTypes was mutated: %#v", dataTypes)
	}
	originalAdminReviewed, ok := dataTypes["admin_reviewed"].(map[string]interface{})
	if !ok {
		t.Fatalf("source admin_reviewed metadata changed unexpectedly: %#v", dataTypes["admin_reviewed"])
	}
	if originalAdminReviewed["card_element"] != "hidden" {
		t.Fatalf("source admin_reviewed card_element = %#v, want hidden", originalAdminReviewed["card_element"])
	}
}

func TestReadServiceCatalogModerationRecordsCoalescesLegacyNullOwnerAndBooleans(t *testing.T) {
	driverName := fmt.Sprintf("serviceCatalogModerationMockDriver_%d", atomic.AddInt64(&serviceCatalogModerationMockCounter, 1))
	sql.Register(driverName, serviceCatalogModerationMockDriver{})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	records, err := readServiceCatalogModerationRecords(db, []int64{11})
	if err != nil {
		t.Fatalf("readServiceCatalogModerationRecords returned error: %v", err)
	}

	record, ok := records[11]
	if !ok {
		t.Fatalf("records missing row 11: %#v", records)
	}
	if record.Values["published"] != true || record.Values["enabled"] != true {
		t.Fatalf("record.Values basic flags = %#v", record.Values)
	}
	if record.OwnerUserID != 0 {
		t.Fatalf("record.OwnerUserID = %d, want 0 for legacy NULL owner", record.OwnerUserID)
	}
	if record.Values["admin_reviewed"] != false || record.Values["admin_approved"] != false {
		t.Fatalf("record.Values null flags were not normalized to false: %#v", record.Values)
	}
}

func TestAppendServiceCatalogModerationColumnsAdminAlwaysGetsColumns(t *testing.T) {
	baseColumns := []string{"id", "header"}
	rows := []map[string]interface{}{{"id": int64(11), "header": "Firefox"}}

	got := appendServiceCatalogModerationColumns(serviceCatalogModerationTableName, baseColumns, rows, "admin")

	want := []string{"id", "header", "published", "enabled", "admin_reviewed", "admin_approved"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("columns = %#v, want %#v", got, want)
	}
}

func TestAppendServiceCatalogModerationColumnsOwnerGetsColumnsWhenOverlayPresent(t *testing.T) {
	baseColumns := []string{"id", "header"}
	rows := []map[string]interface{}{
		{
			"id":             int64(11),
			"header":         "Firefox",
			"published":      true,
			"enabled":        true,
			"admin_reviewed": false,
			"admin_approved": false,
		},
		{"id": int64(12), "header": "Someone else"},
	}

	got := appendServiceCatalogModerationColumns(serviceCatalogModerationTableName, baseColumns, rows, "basic")

	want := []string{"id", "header", "published", "enabled", "admin_reviewed", "admin_approved"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("columns = %#v, want %#v", got, want)
	}
}

func TestAppendServiceCatalogModerationColumnsSkipsUsersWithoutOverlay(t *testing.T) {
	baseColumns := []string{"id", "header"}
	rows := []map[string]interface{}{{"id": int64(11), "header": "Firefox"}}

	got := appendServiceCatalogModerationColumns(serviceCatalogModerationTableName, baseColumns, rows, "basic")

	if !reflect.DeepEqual(got, baseColumns) {
		t.Fatalf("columns = %#v, want %#v", got, baseColumns)
	}
}
