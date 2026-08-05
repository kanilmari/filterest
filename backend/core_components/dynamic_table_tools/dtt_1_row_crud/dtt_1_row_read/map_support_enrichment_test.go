package dtt_1_row_read

import (
	"reflect"
	"strings"
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
