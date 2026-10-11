// row_response_support_postgres_test.go
// Proves hidden geometry support with real column grants on disposable PostgreSQL.
// Reuses the opt-in owner/reader fixture; native point needs no PostGIS extension.
// Support can add permitted row values while denied geometry and columns stay unchanged.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"net/url"
	"reflect"
	"testing"
)

func TestRowResponseMapSupportPostgres(t *testing.T) {
	owner, reader := ownerResolverPostgres(t)
	if _, err := owner.Exec(`
CREATE TABLE row_support_map(id integer PRIMARY KEY, position point, private_position point);
INSERT INTO row_support_map VALUES(1, point(24,60), point(25,61));
GRANT SELECT(id,position) ON row_support_map TO wl58_reader;`); err != nil {
		t.Fatal(err)
	}
	old := backend.Db
	backend.Db = owner
	t.Cleanup(func() { backend.Db = old })
	geometry, err := getGeometryColumns(owner, "row_support_map")
	if err != nil || len(geometry) != 2 {
		t.Fatal("fixture requires two geometry columns", geometry, err)
	}
	allowed, err := fetchUserSelectableColumns(reader, "row_support_map")
	if err != nil {
		t.Fatal(err)
	}
	allowedColumns := map[string]bool{}
	for _, column := range allowed {
		allowedColumns[column] = true
	}
	listingGeometry := filterAllowedGeometryColumns(geometry, allowedColumns)
	if !reflect.DeepEqual(listingGeometry, []string{"position"}) {
		t.Fatal("listing retained denied geometry", listingGeometry)
	}
	for _, params := range []url.Values{
		{}, {"view_key": {"table"}}, {"view_key": {"map"}, "include_map_support": {"0"}},
		{"include_map_support": {"1"}}, {"view_key": {"card"}, "include_map_support": {"1"}},
	} {
		t.Run(params.Encode(), func(t *testing.T) {
			support := resolveRowSupportRequest(params)
			searchGeometry := resolveSearchMapSupportColumns(reader, "row_support_map", support)
			if support.includeMapSupport && !reflect.DeepEqual(searchGeometry, listingGeometry) {
				t.Fatal("search and listing geometry differ", searchGeometry, listingGeometry)
			}
			for _, permitted := range [][]string{listingGeometry, searchGeometry} {
				rows := []map[string]interface{}{{"id": int64(1)}}
				columns := []string{"id"}
				if err := prepareRowsForResponse(reader, "row_support_map", rows, nil, columns,
					dbutils.NewRequestActorContext(4, "user"), support, permitted); err != nil {
					t.Fatal(err)
				}
				_, hasGeometry := rows[0]["position"]
				if hasGeometry != support.includeMapSupport || rows[0]["private_position"] != nil ||
					!reflect.DeepEqual(columns, []string{"id"}) {
					t.Fatal("support escaped permission/presentation boundary", rows, columns)
				}
				if hasGeometry && rows[0]["position"] != "(24,60)" {
					t.Fatal("geometry value changed", rows)
				}
			}
		})
	}
	if _, err := owner.Exec(`REVOKE SELECT(position) ON row_support_map FROM wl58_reader`); err != nil {
		t.Fatal(err)
	}
	support := resolveRowSupportRequest(url.Values{"view_key": {"map"}})
	if geometry := resolveSearchMapSupportColumns(reader, "row_support_map", support); len(geometry) != 0 {
		t.Fatal("revoked geometry remains permitted", geometry)
	}
	// A stale metadata snapshot must never cause a retry through the owner.
	rows := []map[string]interface{}{{"id": int64(1)}}
	if err := prepareRowsForResponse(reader, "row_support_map", rows, nil, []string{"id"},
		dbutils.NewRequestActorContext(4, "user"), support, listingGeometry); err != nil {
		t.Fatal(err)
	}
	if len(rows[0]) != 1 {
		t.Fatal("owner rescued revoked geometry", rows)
	}
}
