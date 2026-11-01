// hidden_field_projection_test.go
// Holds map support, FK labels and label evidence to the client delivery boundary.
// Exercises cached primary joins, related joins and their SQL expression maps.
// Uses in-process schema fixtures; PostgreSQL response proofs live with handlers.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"easelect/backend/core_components/dbutils/queryfixture"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func visibleLabelTargetsForTest(keys map[string]dtt_utils.ForeignKey) map[string]recordTitleTargetMetadata {
	targets := map[string]recordTitleTargetMetadata{}
	for source := range keys {
		targets[source] = recordTitleTargetMetadata{DataType: "text", ClientDeliveryMode: "include"}
	}
	return targets
}

func TestFKDisplayLabelExpressionVisibility(t *testing.T) {
	for _, tc := range []struct {
		name   string
		target recordTitleTargetMetadata
		proven bool
		want   string
	}{
		{"visible", recordTitleTargetMetadata{ClientDeliveryMode: "include"}, true, `"a""lias"."ti""tle"`},
		{"hidden", recordTitleTargetMetadata{HideEverywhere: true, ClientDeliveryMode: "include"}, true, "NULL::text"},
		{"server only", recordTitleTargetMetadata{ClientDeliveryMode: "server_only"}, true, "NULL::text"},
		{"unknown mode", recordTitleTargetMetadata{ClientDeliveryMode: "future"}, true, "NULL::text"},
		{"missing proof", recordTitleTargetMetadata{ClientDeliveryMode: "include"}, false, "NULL::text"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := fkDisplayLabelExpression(`a"lias`, `ti"tle`, tc.target, tc.proven); got != tc.want {
				t.Fatalf("expression=%s want=%s", got, tc.want)
			}
		})
	}
}

func TestHiddenFKLabelConsumers(t *testing.T) {
	keys := map[string]dtt_utils.ForeignKey{"target_id": {ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"}}
	for _, role := range []string{"basic", "guest", "admin"} {
		for _, state := range []string{"visible", "hidden", "server_only", "unproven"} {
			t.Run(role+"/"+state, func(t *testing.T) {
				resetJoinMetadataCacheForTests()
				t.Cleanup(resetJoinMetadataCacheForTests)
				targets := visibleLabelTargetsForTest(keys)
				target := targets["target_id"]
				target.HideEverywhere = state == "hidden"
				if state == "server_only" {
					target.ClientDeliveryMode = state
				}
				targets["target_id"] = target
				if state == "unproven" {
					delete(targets, "target_id")
				}
				db := openBuildJoinsMockDB(t, &buildJoinsQueryCounter{counts: map[string]int{}})
				setCachedJoinMetadata("sources", joinMetadataCacheEntry{tableUID: "42", foreignKeys: keys, titleTargets: targets})
				auth := allowForeignLabelsForTest()
				auth.userRole, auth.userID = role, 4
				auth.policies = map[string]ReadRowPolicy{"targets": {}}
				selected, _, expressions, _, err := buildJoinsWith1MRelations(db, "sources",
					map[int]dtt_models.ColumnInfo{1: {ColumnName: "target_id"}}, []int{1}, auth, 0)
				if err != nil {
					t.Fatal(err)
				}
				want := `"target_id_alias1"."title"`
				relatedWant := `"target_id_related_fk_alias1"."title"`
				if state != "visible" {
					want, relatedWant = "NULL::text", "NULL::text"
				}
				if expressions["target_name (ln)"] != want || !strings.Contains(selected, want+` AS "target_name (ln)"`) {
					t.Fatal("primary projection bypassed flags", selected, expressions)
				}
				related, _, _ := buildRelatedLabelProjection("sources", []string{"target_id"}, keys, targets, nil, auth, 0)
				if !strings.Contains(related, relatedWant+` AS "target_name"`) {
					t.Fatal("related projection bypassed flags", related)
				}
				evidence := linkedLabelEvidenceAliases([]string{"target_id"}, nil, keys, targets, nil)
				for _, aliases := range evidence {
					if (len(aliases) != 0) != (state == "visible") {
						t.Fatal("label evidence bypassed flags", evidence)
					}
				}
			})
		}
	}
}

type visibilityPredicateDriver struct{ t *testing.T }
type visibilityPredicateConn struct {
	buildJoinsMockConn
	t *testing.T
}

func (d visibilityPredicateDriver) Open(string) (driver.Conn, error) {
	return &visibilityPredicateConn{t: d.t}, nil
}

func (c *visibilityPredicateConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	for _, clause := range []string{
		"COALESCE(scd.hide_everywhere, false) = false OR c.column_name = 'id'",
		"COALESCE(scd.client_delivery_mode, 'include') = 'include'",
		"c.table_schema = 'public'", "scd.column_name = c.column_name", "scd.table_uid =",
	} {
		if !strings.Contains(query, clause) {
			c.t.Errorf("projection lacks visibility clause %q: %s", clause, query)
		}
	}
	return &buildJoinsMockRows{cols: []string{"column_name"}, rows: [][]driver.Value{{"position"}}}, nil
}

func TestGeometryAndVisibleColumnsUseDeliveryPredicate(t *testing.T) {
	name := fmt.Sprintf("visibility_predicate_%d", atomic.AddInt64(&buildJoinsDriverCounter, 1))
	sql.Register(name, visibilityPredicateDriver{t})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, read := range []func() ([]string, error){
		func() ([]string, error) { return getVisibleColumnNames(db, "places") },
		func() ([]string, error) { return getGeometryColumns(db, "places") },
	} {
		if got, err := read(); err != nil || !reflect.DeepEqual(got, []string{"position"}) {
			t.Fatal(got, err)
		}
	}
}

func TestFilterOptionLabelsUseTargetVisibilityProof(t *testing.T) {
	for _, target := range []recordTitleTargetMetadata{
		{HideEverywhere: true, ClientDeliveryMode: "include"},
		{ClientDeliveryMode: "server_only"}, {},
	} {
		for _, role := range []string{"basic", "admin"} {
			t.Run(fmt.Sprintf("%s/%+v", role, target), func(t *testing.T) {
				valueQueries := sec4FilterOptionDeliveryFixture(t, role, "name", nil, target)
				request := queryfixture.Request(t, "GET", "/api/get-filter-options?dataset=private_data", "", 42, role)
				response := httptest.NewRecorder()
				GetFilterOptionsHandler(response, request)
				if response.Code != http.StatusForbidden || *valueQueries != 0 {
					t.Fatalf("picker read a withheld label: %d %s", response.Code, response.Body)
				}
			})
		}
	}
}

func TestHiddenLabelEvidencePreservesAliasCollisions(t *testing.T) {
	keys := map[string]dtt_utils.ForeignKey{"owner_id": {NameColumn: "title"}, "owner_uid": {NameColumn: "title"}}
	targets := visibleLabelTargetsForTest(keys)
	targets["owner_id"] = recordTitleTargetMetadata{HideEverywhere: true, ClientDeliveryMode: "include"}
	evidence := linkedLabelEvidenceAliases([]string{"owner_id", "owner_uid", "owner_name"}, nil, keys, targets, nil)
	if related := evidence[`candidate = baseAlias + " (ln)"`]; len(related) != 1 || !related["owner_name (ln 2)"] {
		t.Fatal("hidden label changed the next visible alias", evidence)
	}
}
