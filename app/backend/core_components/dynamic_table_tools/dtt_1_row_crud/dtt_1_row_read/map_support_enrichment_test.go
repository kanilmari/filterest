// map_support_enrichment_test.go
// Checks permitted geometry selection, transport SQL and optional read failures.
// Connects the response-support owner to the existing map enrichment boundary.
// Denied reads must leave rows intact without retrying through the owner.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

func TestFilterAllowedGeometryColumnsKeepsPermittedUniqueColumns(t *testing.T) {
	got := filterAllowedGeometryColumns(
		[]string{"position", "position", "internal_geom", " "},
		map[string]bool{
			"position": true,
		},
	)

	if !reflect.DeepEqual(got, []string{"position"}) {
		t.Fatalf("filterAllowedGeometryColumns() = %#v, want [position]", got)
	}
}

type deniedMapSupportDriver struct{ calls *int }
type deniedMapSupportConn struct {
	canonicalAssetMockConn
	calls *int
}

func (d deniedMapSupportDriver) Open(string) (driver.Conn, error) {
	return &deniedMapSupportConn{calls: d.calls}, nil
}

func (c *deniedMapSupportConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	*c.calls++
	return nil, fmt.Errorf("geometry read denied")
}

func TestPrepareRowResponseMapSupportNeverRetriesDeniedGeometryAsOwner(t *testing.T) {
	open := func(calls *int) *sql.DB {
		t.Helper()
		name := fmt.Sprintf("denied_map_support_%d", atomic.AddInt64(&legacyImageMockCounter, 1))
		sql.Register(name, deniedMapSupportDriver{calls})
		db, err := sql.Open(name, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	var readerCalls, ownerCalls int
	reader, owner := open(&readerCalls), open(&ownerCalls)
	old := backend.Db
	backend.Db = owner
	t.Cleanup(func() { backend.Db = old })
	rows := []map[string]interface{}{{"id": int64(1), "title": "kept"}}
	columns := []string{"id", "title"}
	support := resolveRowSupportRequest(url.Values{"view_key": {"map"}})
	permitted := filterAllowedGeometryColumns([]string{"position", "private_position"}, map[string]bool{"position": true})
	if err := prepareRowsForResponse(reader, "locations", rows, nil, columns,
		dbutils.NewRequestActorContext(4, "basic"), support, permitted); err != nil {
		t.Fatal("optional geometry failure rejected readable rows", err)
	}
	if readerCalls != 1 || ownerCalls != 0 || !reflect.DeepEqual(rows, []map[string]interface{}{{"id": int64(1), "title": "kept"}}) ||
		!reflect.DeepEqual(columns, []string{"id", "title"}) {
		t.Fatal("geometry failure changed response or retried as owner", readerCalls, ownerCalls, rows, columns)
	}
}

func TestBuildMapSupportRowsQueryCastsGeometryColumnsToText(t *testing.T) {
	query, args := buildMapSupportRowsQuery(
		"app_service_locations",
		[]string{"position"},
		[]int64{188, 201},
	)

	for _, want := range []string{
		`"app_service_locations"."id" AS "id"`,
		`"app_service_locations"."position"::text AS "position"`,
		`WHERE "app_service_locations"."id" IN ($1, $2)`,
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("query = %q, want it to contain %q", query, want)
		}
	}
	if !reflect.DeepEqual(args, []interface{}{int64(188), int64(201)}) {
		t.Fatalf("args = %#v, want row ids", args)
	}
}
