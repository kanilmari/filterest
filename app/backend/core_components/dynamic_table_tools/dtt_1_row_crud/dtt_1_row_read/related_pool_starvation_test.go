// related_pool_starvation_test.go
// Forces two related HTTP reads to occupy every slot in a two-connection pool.
// Shares the deterministic transaction barrier with the PostgreSQL regression.
// Proves progress, unchanged replies and transaction reuse without socket access.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds"
	"easelect/backend/core_components/dbutils"
)

type relatedPoolBarrier struct {
	mu      sync.Mutex
	ready   chan struct{}
	entered int
}

func (b *relatedPoolBarrier) arm() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.ready, b.entered = make(chan struct{}), 0
}

func (b *relatedPoolBarrier) wait(ctx context.Context) error {
	b.mu.Lock()
	ready := b.ready
	if ready != nil {
		b.entered++
		if b.entered == 2 {
			close(ready)
		}
	}
	b.mu.Unlock()
	if ready == nil {
		return nil
	}
	select {
	case <-ready:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type relatedPoolConnector struct {
	driver.Connector
	barrier *relatedPoolBarrier
}

func (c relatedPoolConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &relatedPoolConn{Conn: conn, barrier: c.barrier}, nil
}

type relatedPoolConn struct {
	driver.Conn
	barrier *relatedPoolBarrier
}

func (c *relatedPoolConn) BeginTx(ctx context.Context, options driver.TxOptions) (driver.Tx, error) {
	tx, err := c.Conn.(driver.ConnBeginTx).BeginTx(ctx, options)
	if err == nil && options.ReadOnly && options.Isolation == driver.IsolationLevel(sql.LevelRepeatableRead) {
		if err = c.barrier.wait(ctx); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
	}
	return tx, err
}

func (c *relatedPoolConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.Conn.(driver.QueryerContext).QueryContext(ctx, query, args)
}

func (c *relatedPoolConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return c.Conn.(driver.ExecerContext).ExecContext(ctx, query, args)
}

type relatedPoolScriptConnector struct{ reads *scriptedReads }

func (c relatedPoolScriptConnector) Driver() driver.Driver { return scriptedDriver{reads: c.reads} }
func (c relatedPoolScriptConnector) Connect(context.Context) (driver.Conn, error) {
	return relatedPoolScriptConn{scriptedConn{reads: c.reads, connection: "shared"}}, nil
}

type relatedPoolScriptConn struct{ scriptedConn }

func (relatedPoolScriptConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return &storageAuthorizationTestTx{}, nil
}

func installRelatedPool(t *testing.T, connector driver.Connector) (*sql.DB, *relatedPoolBarrier) {
	t.Helper()
	barrier := &relatedPoolBarrier{}
	db := sql.OpenDB(relatedPoolConnector{connector, barrier})
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(2)
	old, admin, basic := backend.Db, backend.DbAdmin, backend.DbBasic
	backend.Db, backend.DbAdmin, backend.DbBasic = db, db, db
	t.Cleanup(func() {
		_ = db.Close()
		backend.Db, backend.DbAdmin, backend.DbBasic = old, admin, basic
		dataset_kinds.InvalidateAll()
	})
	return db, barrier
}

// runRelatedPoolProof first captures an unsaturated reply, then forces both
// snapshot connections to be held before either handler can continue. With
// the old handler the next pooled query waits until the three-second deadline.
func runRelatedPoolProof(t *testing.T, connector driver.Connector) {
	t.Helper()
	db, barrier := installRelatedPool(t, connector)
	read := func(ctx context.Context) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/fetch-dynamic-children?dataset=parent_rows",
			strings.NewReader(`{"parent_dataset":"parent_rows","parent_pk_value":"7"}`))
		r = r.WithContext(dbutils.SetRequestActorContext(ctx, dbutils.NewRequestActorContext(42, "admin")))
		w := httptest.NewRecorder()
		GetDynamicRelatedItemsHandler(w, r)
		return w
	}
	decode := func(w *httptest.ResponseRecorder) map[string]interface{} {
		t.Helper()
		if w.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", w.Code, w.Body)
		}
		var body map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	baseline := decode(read(context.Background()))
	children := baseline["child_tables"].([]interface{})
	if len(children) != 2 || baseline["card_picture"] != "own.png" {
		t.Fatalf("incomplete fixture reply: %v", baseline)
	}
	for _, child := range children {
		if child.(map[string]interface{})["kind_capabilities"] == nil {
			t.Fatal("fixture lost capability evidence", child)
		}
	}
	dataset_kinds.InvalidateAll() // Neither warm evidence nor single-flight may hide the cycle.
	barrier.arm()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	answers := make(chan *httptest.ResponseRecorder, 2)
	var workers sync.WaitGroup
	workers.Add(2)
	defer func() { cancel(); workers.Wait() }()
	start := time.Now()
	for range 2 {
		go func() { defer workers.Done(); answers <- read(ctx) }()
	}
	for range 2 {
		select {
		case answer := <-answers:
			if got := decode(answer); !reflect.DeepEqual(got, baseline) {
				t.Fatalf("reply changed under saturation: got=%v want=%v", got, baseline)
			}
		case <-ctx.Done():
			t.Fatalf("related reads stalled with every pool slot held: %v; stats=%+v", ctx.Err(), db.Stats())
		}
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("related reads took %v, want <1s", elapsed)
	}
	barrier.mu.Lock()
	entered := barrier.entered
	barrier.mu.Unlock()
	if entered != 2 || db.Stats().InUse != 0 {
		t.Fatalf("proof did not occupy and release both connections: entered=%d stats=%+v", entered, db.Stats())
	}
	t.Logf("two saturated related requests completed in %v with identical replies", time.Since(start))
}

func relatedPoolRules() []scriptedRule {
	permission := scriptedRule{fragment: "system_group_table_func_rights", columns: []string{"allowed"}, rows: [][]driver.Value{{int64(1)}}}
	rules := parentWithAGallery(permission)
	for i := range rules {
		if rules[i].fragment == "c.data_type IN" {
			rules[i].rows = [][]driver.Value{{"cached_image", false, false}}
		}
	}
	return append(rules,
		scriptedRule{fragment: "AND column_name = $2", columns: []string{"exists"}, rows: [][]driver.Value{{false}}},
		scriptedRule{fragment: "SELECT c.column_name", columns: []string{"column_name"}},
		scriptedRule{fragment: "public.app_row_actor_column", columns: []string{"column_name", "role"}},
		scriptedRule{fragment: `FROM "parent_rows_assets"`, columns: []string{"id", "filename"}, rows: [][]driver.Value{{int64(1), "own.png"}, {int64(2), "file.pdf"}}},
		scriptedRule{fragment: `FROM "parent_rows_notes"`, columns: []string{"id", "title"}, rows: [][]driver.Value{{int64(9), "note"}}},
		scriptedRule{fragment: `SELECT "cached_image"::text`, columns: []string{"picture"}, rows: [][]driver.Value{{"own.png"}}},
		scriptedRule{fragment: "SELECT table_uid FROM public.system_db_tables", columns: []string{"uid"}, rows: [][]driver.Value{{int64(22)}}},
		scriptedRule{fragment: "dataset.ui_hidden", columns: []string{"hidden"}, rows: [][]driver.Value{{false}}},
		scriptedRule{fragment: "a.schema_version,a.tab_values", columns: []string{"shared", "stamp", "schema", "tab", "overrides", "revision"}, rows: [][]driver.Value{{nil, "", nil, nil, nil, nil}}},
		scriptedRule{fragment: "WITH registrations AS (", columns: []string{"snapshot"}, rows: [][]driver.Value{{[]byte(`{"registrations":[{"table_uid":22,"name":"public.parent_rows_assets","table_kind":"ordinary","kind_version":0}],"shapes":[{"name":"public.parent_rows_assets"}]}`)}}},
	)
}

func TestRelatedReadsCompleteWithSaturatedPool(t *testing.T) {
	reads := &scriptedReads{rules: relatedPoolRules()}
	runRelatedPoolProof(t, relatedPoolScriptConnector{reads})
	if _, unexpected := reads.recorded(); len(unexpected) > 0 {
		t.Fatalf("unscripted reads: %v", unexpected)
	}
}

func runRequestKindPoolProof(t *testing.T, connector driver.Connector) {
	t.Helper()
	for _, mode := range []string{"named", "related"} {
		t.Run(mode, func(t *testing.T) {
			db, barrier := installRelatedPool(t, connector)
			barrier.arm()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			done := make(chan error, 2)
			var workers sync.WaitGroup
			workers.Add(2)
			defer func() { cancel(); workers.Wait() }()
			start := time.Now()
			for range 2 {
				go func() {
					defer workers.Done()
					tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
					if err != nil {
						done <- err
						return
					}
					defer tx.Rollback()
					requestContext := dbutils.SetTx(ctx, tx)
					if mode == "named" {
						if got := readDatasetKindCapabilities(requestContext, "parent_rows_assets"); got == nil {
							done <- fmt.Errorf("named capability evidence missing")
							return
						}
					} else {
						results := []RelatedTableResult{{DatasetUID: 22}}
						populateRelatedKindCapabilities(requestContext, results)
						if results[0].KindCapabilities == nil {
							done <- fmt.Errorf("related capability evidence missing")
							return
						}
					}
					done <- nil
				}()
			}
			for range 2 {
				select {
				case err := <-done:
					if err != nil {
						t.Fatal(err)
					}
				case <-ctx.Done():
					t.Fatal("request enrichment stalled", ctx.Err())
				}
			}
			if elapsed := time.Since(start); elapsed > time.Second {
				t.Fatalf("request enrichment took %v, want <1s", elapsed)
			}
		})
	}
}

func TestKindCapabilitiesReuseSaturatedRequestTransactions(t *testing.T) {
	reads := &scriptedReads{rules: relatedPoolRules()}
	runRequestKindPoolProof(t, relatedPoolScriptConnector{reads})
}
