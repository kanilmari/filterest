// home_text_style_test.go
// Verifies complete v2/v3/v4 admin/store validation and an offline stale-revision refusal.
// Connects the shared twin examples to both write entry points and a narrow SQL driver.
// Ensures invalid or stale presentations cannot reach a database write.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	presentation "easelect/frontend/shared/front_page_presentation"
)

func TestHomeTextStyleAdminAndStoreTwinExamples(t *testing.T) {
	raw, err := os.ReadFile("../../../testing/shared_contracts/home_presentation_validation_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		Name     string
		Value    json.RawMessage
		Valid    bool
		Readable bool
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		t.Run(example.Name, func(t *testing.T) {
			_, err := decodeFrontPageAdminRequest(strings.NewReader(`{"presentation":` + string(example.Value) + `,"version":"none"}`))
			var value presentation.Value
			json.Unmarshal(example.Value, &value)
			validRequest := example.Valid || (example.Readable && (value.SchemaVersion == 2 || value.SchemaVersion == 3))
			if (err == nil) != validRequest {
				t.Fatal("admin", err)
			}
			if !validRequest {
				// A nil transaction proves validation happens before any database access.
				if _, err := saveFrontPagePresentation(nil, example.Value, "none"); !errors.Is(err, errFrontPageInput) {
					t.Fatal("store", err)
				}
			}
		})
	}
}

type homeTextRevisionDriver struct{}
type homeTextRevisionConn struct{}
type homeTextRevisionRows struct{ done bool }

func (homeTextRevisionDriver) Open(string) (driver.Conn, error) { return homeTextRevisionConn{}, nil }
func (homeTextRevisionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (homeTextRevisionConn) Close() error              { return nil }
func (homeTextRevisionConn) Begin() (driver.Tx, error) { return frontPageBackgroundTx{}, nil }
func (homeTextRevisionConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "pg_advisory_xact_lock") {
		return nil, errors.New("unexpected write")
	}
	return driver.RowsAffected(1), nil
}
func (homeTextRevisionConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !strings.HasPrefix(query, "SELECT json_value") {
		return nil, errors.New("unexpected write")
	}
	return &homeTextRevisionRows{}, nil
}
func (*homeTextRevisionRows) Columns() []string { return []string{"json_value", "updated"} }
func (*homeTextRevisionRows) Close() error      { return nil }
func (r *homeTextRevisionRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	raw, _ := json.Marshal(presentation.Rules().Default)
	dest[0], dest[1] = raw, "new-stamp"
	return nil
}
func TestHomeTextStyleStaleRevisionRefusedWithoutPostgres(t *testing.T) {
	sql.Register("home_text_revision", homeTextRevisionDriver{})
	db, err := sql.Open("home_text_revision", "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	value := presentation.Rules().Default
	value.TextStyle.Preset = "serif_story_v1"
	raw, _ := json.Marshal(value)
	if _, err := saveFrontPagePresentation(tx, raw, "stale"); !errors.Is(err, errFrontPageConflict) {
		t.Fatal(err)
	}
}
