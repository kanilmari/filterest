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
	"strings"
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
	return []string{"due_date", "scheduled_at", "published_at", "embedding_vector"}
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
	destination[3] = strings.Repeat("1", 600)
	return nil
}

func (*temporalFormattingRows) ColumnTypeDatabaseTypeName(index int) string {
	return []string{"DATE", "TIMESTAMP", "TIMESTAMPTZ", "VECTOR"}[index]
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
	if len(formatted["embedding_vector"].(string)) != 503 {
		t.Fatal("listing must retain its existing vector abbreviation")
	}
}

func TestSearchSerializationKeepsInstantsAndCompleteVectors(t *testing.T) {
	registerTemporalFormattingDriverOnce.Do(func() {
		sql.Register(temporalFormattingDriverName, temporalFormattingDriver{})
	})
	database, err := sql.Open(temporalFormattingDriverName, "")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	rows, err := database.QueryContext(context.Background(), "search-values")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	_, formatted, err := formatRowsToMaps(rows, false)
	if err != nil {
		t.Fatal(err)
	}
	if formatted[0]["published_at"] != "2026-06-14T01:30:00Z" ||
		formatted[0]["embedding_vector"] != strings.Repeat("1", 600) {
		t.Fatalf("search changed the instant or full vector: %v", formatted[0])
	}
}

func TestManagedHelsinkiTimestampsRemainExplicitInstants(t *testing.T) {
	zone, err := time.LoadLocation("Europe/Helsinki")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"2026-01-15T07:30:00Z", "2026-06-14T06:30:00Z",
		"2026-03-29T01:30:00Z", "2026-10-25T01:30:00Z",
	} {
		instant, err := time.Parse(time.RFC3339, expected)
		if err != nil {
			t.Fatal(err)
		}
		if actual := formatTemporalColumnValue(instant.In(zone), "TIMESTAMPTZ"); actual != expected {
			t.Fatalf("Helsinki instant %s formatted as %s", expected, actual)
		}
	}
}
