// front_page_presentation_canonical_test.go
// Proves canonical bytes and revisions through the real admin save/read paths.
// Connects an in-memory SQL boundary to v2 restores and normalized POST responses.
// Runs without PostgreSQL; existing disposable tests retain the native SQL proofs.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	presentation "easelect/frontend/shared/front_page_presentation"
)

type canonicalHomeMemory struct {
	raw                     []byte
	updated                 string
	writes, begins, commits int
}
type canonicalHomeConnector struct{ state *canonicalHomeMemory }
type canonicalHomeDriver struct{}
type canonicalHomeConn struct{ state *canonicalHomeMemory }
type canonicalHomeTx struct{ state *canonicalHomeMemory }
type canonicalHomeRows struct {
	columns []string
	values  []driver.Value
}

func (c canonicalHomeConnector) Connect(context.Context) (driver.Conn, error) {
	return &canonicalHomeConn{c.state}, nil
}
func (canonicalHomeConnector) Driver() driver.Driver         { return canonicalHomeDriver{} }
func (canonicalHomeDriver) Open(string) (driver.Conn, error) { return nil, errors.New("use connector") }
func (*canonicalHomeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*canonicalHomeConn) Close() error { return nil }
func (c *canonicalHomeConn) Begin() (driver.Tx, error) {
	c.state.begins++
	return canonicalHomeTx{c.state}, nil
}
func (tx canonicalHomeTx) Commit() error { tx.state.commits++; return nil }
func (canonicalHomeTx) Rollback() error  { return nil }
func (*canonicalHomeConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if !strings.Contains(query, "pg_advisory_xact_lock") {
		return nil, errors.New("unexpected exec")
	}
	return driver.RowsAffected(1), nil
}
func (c *canonicalHomeConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if strings.HasPrefix(query, "UPDATE public.system_config") || strings.HasPrefix(query, "INSERT INTO public.system_config") {
		c.state.raw = []byte(args[0].Value.(string))
		c.state.writes++
		c.state.updated = fmt.Sprintf("saved-%d", c.state.writes)
	} else if !strings.HasPrefix(query, "SELECT json_value") {
		return nil, errors.New("unexpected query")
	}
	rows := &canonicalHomeRows{columns: []string{"json_value", "updated"}}
	if c.state.raw != nil {
		rows.values = []driver.Value{c.state.raw, c.state.updated}
	}
	if strings.Contains(query, "value_type FROM") {
		rows.columns = append(rows.columns, "value_type")
		if rows.values != nil {
			rows.values = append(rows.values, int64(5))
		}
	}
	return rows, nil
}
func (r *canonicalHomeRows) Columns() []string { return r.columns }
func (*canonicalHomeRows) Close() error        { return nil }
func (r *canonicalHomeRows) Next(dest []driver.Value) error {
	if r.values == nil {
		return io.EOF
	}
	copy(dest, r.values)
	r.values = nil
	return nil
}

func canonicalHomeSave(t *testing.T, db *sql.DB, raw []byte, revision string) string {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	version, err := saveFrontPagePresentation(tx, raw, revision)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return version
}

func TestHomePresentationStoresCanonicalBytesAndReturnsTheirRevision(t *testing.T) {
	for _, tc := range []struct {
		name, preset, mode             string
		start, interval, storedVersion int
		phone                          string
		size                           int
	}{
		{"absent style", "", "", 0, 0, 2, "inherit", 15},
		{"default", "default", "none", 3000, 800, 2, "inherit", 15},
		{"inactive timings", "default", "none", 1234, 567, 2, "inherit", 15},
		{"serif", "serif_story_v1", "none", 1234, 567, 3, "inherit", 15},
		{"reveal", "default", "lines", 1234, 567, 3, "inherit", 15},
		{"phone start", "default", "none", 3000, 800, 4, "start", 15},
		{"phone centre", "serif_story_v1", "lines", 1234, 567, 4, "center", 15},
		{"small story", "serif_story_v1", "none", 3000, 800, 5, "inherit", 12},
		{"large story", "default", "none", 3000, 800, 5, "center", 18},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := presentation.Rules().Default
			value.PhoneAlignment, value.PhoneStorySize = tc.phone, tc.size
			value.TextStyle = presentation.TextStyle{Preset: tc.preset, Reveal: presentation.LineReveal{Mode: tc.mode, StartMS: tc.start, IntervalMS: tc.interval}}
			raw, _ := json.Marshal(value)
			if tc.preset == "" {
				var fields map[string]any
				json.Unmarshal(raw, &fields)
				fields["schema_version"] = 2
				fields["alignment"] = "left"
				delete(fields, "phone_alignment")
				delete(fields, "phone_story_size")
				delete(fields, "text_style")
				raw, _ = json.Marshal(fields)
			}
			state := &canonicalHomeMemory{}
			db := sql.OpenDB(canonicalHomeConnector{state})
			defer db.Close()
			for _, expected := range []string{"none", "current"} {
				if expected == "current" {
					expected = backend.FrontPagePresentationRevision(state.raw, state.updated)
				}
				revision := canonicalHomeSave(t, db, raw, expected)
				if revision != backend.FrontPagePresentationRevision(state.raw, state.updated) {
					t.Fatal("revision does not hash stored bytes")
				}
				var fields map[string]any
				json.Unmarshal(state.raw, &fields)
				_, hasStyle := fields["text_style"]
				wantFields := 10
				if tc.storedVersion >= 3 {
					wantFields = tc.storedVersion + 8
				}
				_, hasPhone := fields["phone_alignment"]
				if fields["schema_version"] != float64(tc.storedVersion) || hasStyle != (tc.storedVersion >= 3) || len(fields) != wantFields || hasPhone != (tc.storedVersion >= 4) || (fields["phone_story_size"] != nil) != (tc.storedVersion == 5) {
					t.Fatal(string(state.raw))
				}
				read, readRevision, err := backend.ReadFrontPagePresentation(context.Background(), db)
				if tc.storedVersion == 2 {
					value.TextStyle = presentation.Rules().Default.TextStyle
				}
				if err != nil || *read != value || readRevision != revision {
					t.Fatal(read, readRevision, err)
				}
			}
			if state.begins != 2 || state.commits != 2 || state.writes != 2 {
				t.Fatal("expected one transaction and write per save", state)
			}
		})
	}
}

func TestHomePresentationV2ReadAndRestorePreservesAllOriginalFields(t *testing.T) {
	original := []byte(`{"schema_version":2,"anchor":"bottom-left","horizontal_margin_px":73,"vertical_margin_px":91,"alignment":"right","max_width_px":700,"light_wash":27,"light_opacity":61,"dark_wash":19,"dark_opacity":43}`)
	state := &canonicalHomeMemory{raw: original, updated: "original"}
	db := sql.OpenDB(canonicalHomeConnector{state})
	defer db.Close()
	read, revision, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || read.SchemaVersion != 5 || read.TextStyle != presentation.Rules().Default.TextStyle || revision != backend.FrontPagePresentationRevision(original, "original") {
		t.Fatal(read, revision, err)
	}
	raw, _ := json.Marshal(read)
	canonicalHomeSave(t, db, raw, revision)
	var before, after map[string]any
	json.Unmarshal(original, &before)
	json.Unmarshal(state.raw, &after)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("T16 restore changed original fields", before, after)
	}
}

func TestHomePresentationPostReportsNormalizedStoredState(t *testing.T) {
	old := frontPageAdminSaver
	t.Cleanup(func() { frontPageAdminSaver = old })
	state := &canonicalHomeMemory{}
	db := sql.OpenDB(canonicalHomeConnector{state})
	defer db.Close()
	frontPageAdminSaver = func(_ context.Context, request frontPageAdminRequest) (string, error) {
		return canonicalHomeSave(t, db, request.Presentation, request.Version), nil
	}
	value := presentation.Rules().Default
	value.TextStyle.Reveal.StartMS, value.TextStyle.Reveal.IntervalMS = 1234, 567
	raw, _ := json.Marshal(value)
	response := httptest.NewRecorder()
	AdminFrontPageHandler(response, httptest.NewRequest("POST", "/api/admin/front-page", strings.NewReader(`{"presentation":`+string(raw)+`,"version":"none"}`)))
	var result struct {
		Version      string
		Presentation presentation.Value
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result.Presentation != presentation.Rules().Default || result.Version != backend.FrontPagePresentationRevision(state.raw, state.updated) {
		t.Fatal(response.Code, response.Body.String(), err)
	}
}
