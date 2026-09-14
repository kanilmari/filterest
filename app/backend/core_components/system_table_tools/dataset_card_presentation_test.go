// dataset_card_presentation_test.go
// Exercises dataset appearance validation and the real SQL transaction boundary.
// Connects scoped HTTP requests, raw nullable reads and after-commit cache hooks.
// Protects column metadata from unrelated palette saves and rejects partial writes.
package system_table_tools

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

type datasetPresentationState struct {
	style, columns                       driver.Value
	missingColumn                        string
	absentDataset, failWrite, failCommit bool
	begins, writes, commits, rollbacks   int
	queries                              []string
}
type datasetPresentationDriver struct{ state *datasetPresentationState }
type datasetPresentationConn struct {
	state                        *datasetPresentationState
	pendingStyle, pendingColumns driver.Value
}
type datasetPresentationTx struct{ conn *datasetPresentationConn }
type datasetPresentationRows struct {
	values   []driver.Value
	consumed bool
}

func (d *datasetPresentationDriver) Open(string) (driver.Conn, error) {
	return &datasetPresentationConn{state: d.state}, nil
}
func (*datasetPresentationConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*datasetPresentationConn) Close() error { return nil }
func (c *datasetPresentationConn) Begin() (driver.Tx, error) {
	c.state.begins++
	c.pendingStyle, c.pendingColumns = c.state.style, c.state.columns
	return &datasetPresentationTx{conn: c}, nil
}
func (t *datasetPresentationTx) Commit() error {
	if t.conn.state.failCommit {
		return errors.New("simulated commit failure")
	}
	t.conn.state.style, t.conn.state.columns = t.conn.pendingStyle, t.conn.pendingColumns
	t.conn.state.commits++
	return nil
}
func (t *datasetPresentationTx) Rollback() error { t.conn.state.rollbacks++; return nil }
func (c *datasetPresentationConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.state.queries = append(c.state.queries, query)
	if strings.Contains(query, "SELECT EXISTS") {
		return &datasetPresentationRows{values: []driver.Value{args[0].Value != c.state.missingColumn}}, nil
	}
	if query == updateDatasetCardPresentationQuery {
		if args[0].Value != "fixture" {
			return nil, errors.New("wrong dataset target")
		}
		if c.state.failWrite {
			return nil, errors.New("simulated write failure")
		}
		if c.state.absentDataset {
			return &datasetPresentationRows{}, nil
		}
		c.state.writes++
		if args[1].Value == true {
			c.pendingStyle = args[2].Value
		}
		if args[3].Value == true {
			c.pendingColumns = args[4].Value
		}
		return &datasetPresentationRows{values: []driver.Value{"fixture", c.pendingStyle, c.pendingColumns}}, nil
	}
	if strings.Contains(query, "SELECT COALESCE(card_details_layout") {
		if args[0].Value != "fixture" {
			return nil, errors.New("wrong read target")
		}
		style, columns := c.state.style, c.state.columns
		if c.state.missingColumn == "card_detail_columns" {
			columns = nil
		}
		if c.state.missingColumn == "card_style_variant" {
			style = nil
		}
		return &datasetPresentationRows{values: []driver.Value{"conditional_multiline", style, columns}}, nil
	}
	return nil, fmt.Errorf("unexpected query (column metadata must be untouched): %s", query)
}
func (*datasetPresentationConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return nil, errors.New("unexpected exec; dataset save must use one returning statement")
}
func (r *datasetPresentationRows) Columns() []string {
	result := make([]string, len(r.values))
	for i := range result {
		result[i] = fmt.Sprint(i)
	}
	return result
}
func (*datasetPresentationRows) Close() error { return nil }
func (r *datasetPresentationRows) Next(values []driver.Value) error {
	if r.consumed || r.values == nil {
		return io.EOF
	}
	copy(values, r.values)
	r.consumed = true
	return nil
}
func openDatasetPresentationTestDB(t *testing.T, state *datasetPresentationState) *sql.DB {
	t.Helper()
	name := "dataset-presentation-" + t.Name()
	sql.Register(name, &datasetPresentationDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
func TestDatasetPresentationScopedHandlerAtomicOverrides(t *testing.T) {
	tests := []struct {
		name, payload          string
		wantStyle, wantColumns driver.Value
	}{
		{"both", `"card_style_variant":"standard","card_detail_columns":4`, "standard", int64(4)},
		{"inherit both", `"card_style_variant":null,"card_detail_columns":null`, nil, nil},
		{"style only", `"card_style_variant":"standard"`, "standard", int64(3)},
		{"columns only", `"card_detail_columns":1`, "modern", int64(1)},
		{"inherit style only", `"card_style_variant":null`, nil, int64(3)},
		{"inherit count only", `"card_detail_columns":null`, "modern", nil},
		{"same values", `"card_style_variant":"modern","card_detail_columns":3`, "modern", int64(3)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := &datasetPresentationState{style: "modern", columns: int64(3)}
			db := openDatasetPresentationTestDB(t, state)
			previous := backend.Db
			backend.Db = db
			defer func() { backend.Db = previous }()
			lazy := dbutils.NewLazyTx(db)
			defer lazy.Rollback()
			req := httptest.NewRequest(http.MethodPost, "/api/card-visibility/update",
				strings.NewReader(`{"scope":"dataset_presentation","table_name":"fixture",`+test.payload+"}"))
			req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
			response := httptest.NewRecorder()
			UpdateCardVisibilityHandler(response, req)
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if state.writes != 1 || state.commits != 0 {
				t.Fatalf("must issue exactly one update in uncommitted request: %#v", state)
			}
			if state.style != "modern" || state.columns != int64(3) {
				t.Fatal("settings escaped the request transaction")
			}
			var result DatasetCardPresentation
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.TableName != "fixture" {
				t.Fatalf("wrong response: %#v", result)
			}
			values := map[string]interface{}{}
			if err := json.Unmarshal(response.Body.Bytes(), &values); err != nil {
				t.Fatal(err)
			}
			if len(values) != 3 {
				t.Fatalf("scoped response contains unrelated metadata: %s", response.Body.String())
			}
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(state.style, test.wantStyle) || !reflect.DeepEqual(state.columns, test.wantColumns) {
				t.Fatalf("persisted style=%v columns=%v", state.style, state.columns)
			}
			var returnedStyle, returnedColumns driver.Value
			if result.CardStyleVariant != nil {
				returnedStyle = *result.CardStyleVariant
			}
			if result.CardDetailColumns != nil {
				returnedColumns = int64(*result.CardDetailColumns)
			}
			if returnedStyle != state.style || returnedColumns != state.columns {
				t.Fatal("response differs from actual persisted values")
			}
			for _, q := range state.queries {
				if strings.Contains(q, "system_column_details") {
					t.Fatal("scoped save touched column settings")
				}
			}
		})
	}
}

func TestDatasetPresentationRejectsInvalidPayloadBeforeTransaction(t *testing.T) {
	payloads := []string{
		`{"scope":"unknown","table_name":"fixture","card_detail_columns":2}`,
		`{"scope":null,"table_name":"fixture","card_detail_columns":2}`,
		`{"scope":true,"table_name":"fixture","card_detail_columns":2}`,
		`{"scope":"dataset_presentation","table_name":"fixture"}`,
		`{"scope":"dataset_presentation","table_name":" ","card_detail_columns":2}`,
		`{"scope":"dataset_presentation","table_name":"fixture","card_detail_columns":2,"columns":[]}`,
		`{"scope":"dataset_presentation","table_name":"fixture","card_detail_columns":2,"card_details_layout":"stacked"}`,
		`{"scope":"dataset_presentation","table_name":"fixture","card_detail_columns":2,"unknown":null}`,
	}
	for _, raw := range []string{"0", "5", "-1", "1.5", `"2"`, `""`, "true", "[]", "{}"} {
		payloads = append(payloads, `{"scope":"dataset_presentation","table_name":"fixture","card_detail_columns":`+raw+"}")
	}
	for _, raw := range []string{`""`, `"Modern"`, `"default"`, "2", "false", "[]", "{}"} {
		payloads = append(payloads, `{"scope":"dataset_presentation","table_name":"fixture","card_style_variant":`+raw+"}")
	}
	for i, body := range payloads {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			state := &datasetPresentationState{}
			db := openDatasetPresentationTestDB(t, state)
			lazy := dbutils.NewLazyTx(db)
			req := httptest.NewRequest(http.MethodPost, "/api/card-visibility/update", strings.NewReader(body))
			req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
			response := httptest.NewRecorder()
			UpdateCardVisibilityHandler(response, req)
			if response.Code != http.StatusBadRequest || state.begins != 0 || state.writes != 0 {
				t.Fatalf("body=%s status=%d state=%#v", body, response.Code, state)
			}
		})
	}
}

func TestDatasetPresentationFailuresDoNotWritePartialSettings(t *testing.T) {
	for _, test := range []struct {
		name, missing string
		absent, fail  bool
		status        int
	}{
		{"missing count", "card_detail_columns", false, false, http.StatusConflict},
		{"missing style", "card_style_variant", false, false, http.StatusConflict},
		{"missing dataset", "", true, false, http.StatusNotFound},
		{"update failure", "", false, true, http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := &datasetPresentationState{style: "modern", columns: int64(3), missingColumn: test.missing, absentDataset: test.absent, failWrite: test.fail}
			db := openDatasetPresentationTestDB(t, state)
			lazy := dbutils.NewLazyTx(db)
			req := httptest.NewRequest(http.MethodPost, "/api/card-visibility/update",
				strings.NewReader(`{"scope":"dataset_presentation","table_name":"fixture","card_style_variant":null,"card_detail_columns":1}`))
			req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
			response := httptest.NewRecorder()
			UpdateCardVisibilityHandler(response, req)
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if err := lazy.Rollback(); err != nil {
				t.Fatal(err)
			}
			if state.writes != 0 || state.commits != 0 || state.style != "modern" || state.columns != int64(3) {
				t.Fatalf("partial settings persisted: %#v", state)
			}
		})
	}
}

func TestDatasetPresentationCacheInvalidatesOnlyAfterSuccessfulCommit(t *testing.T) {
	for _, outcome := range []string{"commit", "rollback", "commit failure"} {
		t.Run(outcome, func(t *testing.T) {
			state := &datasetPresentationState{style: "modern", columns: int64(3), failCommit: outcome == "commit failure"}
			db := openDatasetPresentationTestDB(t, state)
			lazy := dbutils.NewLazyTx(db)
			ctx := dbutils.SetLazyTx(context.Background(), lazy)
			tx, ok := dbutils.RequireTx(ctx)
			if !ok {
				t.Fatal("missing transaction")
			}
			called := 0
			_, err := persistDatasetCardPresentation(ctx, tx, datasetCardPresentationUpdate{
				DatasetCardPresentation: DatasetCardPresentation{TableName: "fixture"},
				styleProvided:           true, columnsProvided: true,
			}, func(tableName string) {
				if tableName != "fixture" {
					t.Error("wrong invalidation target")
				}
				called++
			})
			if err != nil {
				t.Fatal(err)
			}
			if called != 0 {
				t.Fatal("metadata invalidated before commit")
			}
			if outcome == "rollback" {
				if err := lazy.Rollback(); err != nil {
					t.Fatal(err)
				}
			} else {
				err := lazy.Commit()
				if (err != nil) != (outcome == "commit failure") {
					t.Fatalf("commit: %v", err)
				}
			}
			want := 0
			if outcome == "commit" {
				want = 1
			}
			if called != want {
				t.Fatalf("invalidation count=%d want=%d", called, want)
			}
			if outcome != "commit" && (state.style != "modern" || state.columns != int64(3)) {
				t.Fatal("failed request persisted settings")
			}
		})
	}
}

func TestDatasetPresentationReadPreservesNullableOverrides(t *testing.T) {
	for _, test := range []struct {
		name, missing string
		style, count  driver.Value
	}{
		{"inherited", "", nil, nil}, {"explicit", "", "standard", int64(4)},
		{"old schema", "card_detail_columns", "modern", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := &datasetPresentationState{style: test.style, columns: test.count, missingColumn: test.missing}
			db := openDatasetPresentationTestDB(t, state)
			layout, result, err := loadCardVisibilityTableSettings(db, "fixture")
			if err != nil {
				t.Fatal(err)
			}
			if layout != defaultCardDetailsLayout {
				t.Fatal("layout changed")
			}
			var style, count driver.Value
			if result.CardStyleVariant != nil {
				style = *result.CardStyleVariant
			}
			if result.CardDetailColumns != nil {
				count = int64(*result.CardDetailColumns)
			}
			if !reflect.DeepEqual(style, test.style) || !reflect.DeepEqual(count, test.count) {
				t.Fatalf("raw values changed: %#v", result)
			}
			if state.writes != 0 {
				t.Fatal("read persisted defaults")
			}
		})
	}
}

// Reuse the established opt-in socket-only test cluster; never the host database.
func TestDatasetPresentationAtomicPersistencePostgres(t *testing.T) {
	db := sitePresentationDisposableDB(t)
	if _, err := db.Exec(`
  CREATE TABLE system_db_tables (
   table_name text PRIMARY KEY,
   card_details_layout text DEFAULT 'conditional_multiline',
   card_style_variant varchar,
   card_detail_columns integer CHECK (card_detail_columns BETWEEN 1 AND 4)
  );
  CREATE TABLE system_column_details (column_uid integer PRIMARY KEY, metadata jsonb);
  INSERT INTO system_db_tables (table_name,card_style_variant,card_detail_columns) VALUES ('fixture','modern',3),('other','standard',2);
  INSERT INTO system_column_details VALUES (1,'{"show_key_on_card":false,"card_element":"details","order":7}');
 `); err != nil {
		t.Fatal(err)
	}
	read := func(wantStyle *string, wantColumns *int) {
		t.Helper()
		_, got, err := loadCardVisibilityTableSettings(db, "fixture")
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got.CardStyleVariant, wantStyle) || !reflect.DeepEqual(got.CardDetailColumns, wantColumns) {
			t.Fatalf("stored settings=%#v", got)
		}
		var untouched bool
		if err := db.QueryRow(`SELECT metadata='{"show_key_on_card":false,"card_element":"details","order":7}'::jsonb FROM system_column_details WHERE column_uid=1`).Scan(&untouched); err != nil || !untouched {
			t.Fatalf("column metadata changed: %v", err)
		}
		var otherColumns int
		if err := db.QueryRow("SELECT card_detail_columns FROM system_db_tables WHERE table_name='other'").Scan(&otherColumns); err != nil || otherColumns != 2 {
			t.Fatalf("other dataset changed: %v", err)
		}
	}
	str := func(value string) *string { return &value }
	num := func(value int) *int { return &value }
	save := func(payload string, commit bool) {
		t.Helper()
		lazy := dbutils.NewLazyTx(db)
		defer lazy.Rollback()
		req := httptest.NewRequest(http.MethodPost, "/api/card-visibility/update",
			strings.NewReader(`{"scope":"dataset_presentation","table_name":"fixture",`+payload+"}"))
		req = req.WithContext(dbutils.SetLazyTx(req.Context(), lazy))
		response := httptest.NewRecorder()
		UpdateCardVisibilityHandler(response, req)
		if response.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		if commit {
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
		}
	}
	save(`"card_style_variant":null,"card_detail_columns":null`, true)
	read(nil, nil)
	save(`"card_style_variant":"standard","card_detail_columns":4`, true)
	read(str("standard"), num(4))
	save(`"card_style_variant":"modern"`, true)
	read(str("modern"), num(4))
	save(`"card_detail_columns":1`, true)
	read(str("modern"), num(1))
	save(`"card_style_variant":null,"card_detail_columns":null`, false)
	read(str("modern"), num(1))

	// The actual SQL statement must roll back both assignments on a count constraint failure.
	lazy := dbutils.NewLazyTx(db)
	ctx := dbutils.SetLazyTx(context.Background(), lazy)
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		t.Fatal("missing transaction")
	}
	_, err := persistDatasetCardPresentation(ctx, tx, datasetCardPresentationUpdate{
		DatasetCardPresentation: DatasetCardPresentation{TableName: "fixture", CardStyleVariant: str("standard"), CardDetailColumns: num(5)},
		styleProvided:           true, columnsProvided: true,
	}, func(string) { t.Error("failed write invalidated cache") })
	if err == nil {
		t.Fatal("invalid count bypassed database constraint")
	}
	if err := lazy.Rollback(); err != nil {
		t.Fatal(err)
	}
	read(str("modern"), num(1))

	// A column-count writer waiting on a style writer must preserve the latter's committed value.
	first := dbutils.NewLazyTx(db)
	defer first.Rollback()
	firstCtx := dbutils.SetLazyTx(context.Background(), first)
	firstTx, ok := dbutils.RequireTx(firstCtx)
	if !ok {
		t.Fatal("missing first transaction")
	}
	_, err = persistDatasetCardPresentation(firstCtx, firstTx, datasetCardPresentationUpdate{
		DatasetCardPresentation: DatasetCardPresentation{TableName: "fixture", CardStyleVariant: str("standard")}, styleProvided: true,
	}, func(string) {})
	if err != nil {
		t.Fatal(err)
	}
	second := dbutils.NewLazyTx(db)
	defer second.Rollback()
	secondCtx, cancel := context.WithTimeout(dbutils.SetLazyTx(context.Background(), second), 5*time.Second)
	defer cancel()
	secondTx, ok := dbutils.RequireTx(secondCtx)
	if !ok {
		t.Fatal("missing second transaction")
	}
	if _, err := secondTx.Exec("SET LOCAL application_name = 'dataset-presentation-concurrent-test'"); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		_, err := persistDatasetCardPresentation(secondCtx, secondTx, datasetCardPresentationUpdate{
			DatasetCardPresentation: DatasetCardPresentation{TableName: "fixture", CardDetailColumns: num(4)}, columnsProvided: true,
		}, func(string) {})
		finished <- err
	}()
	// Observe PostgreSQL's lock wait, rather than treating a fixed delay as evidence.
	deadline := time.Now().Add(3 * time.Second)
	waiting := false
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='dataset-presentation-concurrent-test' AND wait_event_type='Lock')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case err := <-finished:
			t.Fatalf("second writer did not wait for row lock: %v", err)
		default:
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("did not observe concurrent row lock")
	}
	if err := first.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if err := second.Commit(); err != nil {
		t.Fatal(err)
	}
	read(str("standard"), num(4))

	// The old complete-column editor's optional count helper shares raw-null behavior.
	legacy := dbutils.NewLazyTx(db)
	defer legacy.Rollback()
	legacyTx, ok := dbutils.RequireTx(dbutils.SetLazyTx(context.Background(), legacy))
	if !ok {
		t.Fatal("missing legacy transaction")
	}
	response := httptest.NewRecorder()
	if !writeLegacyCardDetailColumns(response, legacyTx, "fixture", nil) {
		t.Fatal(response.Body.String())
	}
	if err := legacy.Commit(); err != nil {
		t.Fatal(err)
	}
	read(str("standard"), nil)
}
