// get_results_formatting_test.go
// Verifies SQL result serialization preserves PostgreSQL temporal type semantics.
// Bridges database/sql ColumnTypes metadata with the JSON-compatible result map formatter.
// Exists to prevent DATE, TIMESTAMP, and TIMESTAMPTZ from collapsing into one ambiguous string format.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"sync"
	"testing"
	"time"
)

const temporalFormattingDriverName = "easelect-temporal-formatting-test"

var registerTemporalFormattingDriverOnce sync.Once

type temporalFormattingDriver struct{}

type temporalFormattingConnection struct{}

type temporalFormattingRows struct {
	read bool
}

func (temporalFormattingDriver) Open(string) (driver.Conn, error) {
	return &temporalFormattingConnection{}, nil
}

func (*temporalFormattingConnection) Prepare(string) (driver.Stmt, error) {
	return nil, driver.ErrSkip
}

func (*temporalFormattingConnection) Close() error {
	return nil
}

func (*temporalFormattingConnection) Begin() (driver.Tx, error) {
	return nil, driver.ErrSkip
}

func (*temporalFormattingConnection) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &temporalFormattingRows{}, nil
}

func (*temporalFormattingRows) Columns() []string {
	return []string{"due_date", "scheduled_at", "published_at"}
}

func (*temporalFormattingRows) Close() error {
	return nil
}

func (rows *temporalFormattingRows) Next(destination []driver.Value) error {
	if rows.read {
		return io.EOF
	}
	rows.read = true
	hongKong := time.FixedZone("HKT", 8*60*60)
	destination[0] = time.Date(2026, time.January, 15, 0, 0, 0, 0, hongKong)
	destination[1] = time.Date(2026, time.June, 14, 9, 30, 45, 123000000, hongKong)
	destination[2] = time.Date(2026, time.June, 14, 9, 30, 0, 0, hongKong)
	return nil
}

func (*temporalFormattingRows) ColumnTypeDatabaseTypeName(index int) string {
	return []string{"DATE", "TIMESTAMP", "TIMESTAMPTZ"}[index]
}

func TestFormatRowsToMapsPreservesTemporalTypeSemantics(t *testing.T) {
	registerTemporalFormattingDriverOnce.Do(func() {
		sql.Register(temporalFormattingDriverName, temporalFormattingDriver{})
	})
	database, err := sql.Open(temporalFormattingDriverName, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	rows, err := database.QueryContext(context.Background(), "temporal-values")
	if err != nil {
		t.Fatalf("QueryContext: %v", err)
	}
	defer rows.Close()

	_, formattedRows, err := FormatRowsToMaps(rows)
	if err != nil {
		t.Fatalf("FormatRowsToMaps: %v", err)
	}
	if len(formattedRows) != 1 {
		t.Fatalf("len(formattedRows) = %d, want 1", len(formattedRows))
	}

	formatted := formattedRows[0]
	if formatted["due_date"] != "2026-01-15" {
		t.Fatalf("due_date = %v, want 2026-01-15", formatted["due_date"])
	}
	if formatted["scheduled_at"] != "2026-06-14 09:30:45.123" {
		t.Fatalf("scheduled_at = %v, want wall-clock timestamp", formatted["scheduled_at"])
	}
	if formatted["published_at"] != "2026-06-14T01:30:00Z" {
		t.Fatalf("published_at = %v, want explicit UTC instant", formatted["published_at"])
	}
}
