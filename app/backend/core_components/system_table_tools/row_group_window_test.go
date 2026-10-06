// row_group_window_test.go
// Proves editable taxonomy, bounded assignment and forged-route administrator gates.
// Bridges HTTP handlers and real transaction helpers with statement-ordered fixtures.
// Exists to catch identity changes, widened selections and writes before validation.
package system_table_tools

import (
	"context"
	"database/sql/driver"
	"easelect/backend/core_components/dbutils"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRowGroupWindowCreateAndUpdateContract(t *testing.T) {
	for _, body := range []string{
		`{"classification":{"slug":"transport","title":{"fi":" Matka ","en":"Trip"},"is_single":true}}`,
		`{"classification_id":1,"slug":"boat","title":{"fi":"Laiva","en":"Boat"}}`,
		`{"classification":{"id":2,"title":{"fi":"Uusi"},"sort_order":-10,"enabled":false}}`,
		`{"id":2,"enabled":false}`, `{"id":2,"sort_order":0}`,
	} {
		if _, err := decodeCreateRowGroupRequest(strings.NewReader(body)); err != nil {
			t.Fatalf("%s: %v", body, err)
		}
	}
	for _, body := range []string{
		`{"slug":"boat","title":{"fi":"Laiva"}}`,
		`{"id":2,"slug":"changed"}`, `{"id":2,"is_single":false}`,
		`{"classification":{"id":2,"slug":"changed"}}`, `{"classification":{"id":2,"is_single":true}}`,
		`{"classification":{"slug":"x","title":{"fi":"X"}},"enabled":true}`,
		`{"classification":{"classification":{}}}`, `{"id":2,"classification_id":3}`, `{"id":2}`,
	} {
		if _, err := decodeCreateRowGroupRequest(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
}

func TestRowGroupWindowSaveChecksDefaultLanguageAndEditableFields(t *testing.T) {
	for _, heading := range []bool{false, true} {
		t.Run(fmt.Sprint(heading), func(t *testing.T) {
			body := `{"classification_id":1,"slug":"boat","title":{"fi":"Laiva","en":"Boat"},"sort_order":-3}`
			table := "system_row_groups"
			if heading {
				body = `{"classification":{"slug":"transport","title":{"fi":"Matka","en":"Trip"},"is_single":true}}`
				table = "system_row_group_classifications"
			}
			request, err := decodeCreateRowGroupRequest(strings.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			if heading {
				request = *request.Classification
			}
			steps := []rowGroupSQLStep{rowGroupLanguageStep()}
			if !heading {
				steps = append(steps, rowGroupSQLStep{contains: []string{"SELECT EXISTS", "system_row_group_classifications"}, rows: [][]driver.Value{{true}}})
			}
			steps = append(steps, rowGroupSQLStep{contains: []string{"INSERT INTO public." + table}, rows: [][]driver.Value{{int64(2)}}})
			result, err := saveRowGroupInDB(context.Background(), rowGroupMockTx(t, steps...), request, heading)
			if err != nil || result.ID != 2 || (heading && (result.IsSingle == nil || !*result.IsSingle)) {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			request = createRowGroupRequest{ID: 2, Title: map[string]string{"en": "Boat"}}
			tx := rowGroupMockTx(t, rowGroupSQLStep{contains: []string{"FROM public.system_languages"}, rows: [][]driver.Value{{"en", false}}}, rowGroupSQLStep{contains: []string{"WHERE is_default = TRUE"}, rows: [][]driver.Value{{"fi"}}})
			if _, err = saveRowGroupInDB(context.Background(), tx, request, heading); !errors.Is(err, errRowGroupLanguages) {
				t.Fatalf("default language omission: %v", err)
			}
			order, enabled := -5, false
			request = createRowGroupRequest{ID: 2, SortOrder: &order, Enabled: &enabled}
			tx = rowGroupMockTx(t, rowGroupSQLStep{contains: []string{"UPDATE public." + table, "sort_order=COALESCE", "enabled=COALESCE"}, excludes: []string{"SET slug", "is_single="}, rows: [][]driver.Value{{int64(2), "boat", `{"fi":"Laiva"}`, int64(-5), false}}})
			result, err = saveRowGroupInDB(context.Background(), tx, request, heading)
			if err != nil || result.Enabled || result.SortOrder != -5 {
				t.Fatalf("update=%+v err=%v", result, err)
			}
		})
	}
}

func TestRowGroupWindowBulkNormalizationAndLimit(t *testing.T) {
	for _, size := range []int{1, 200} {
		ids := make([]int64, size)
		for i := range ids {
			ids[i] = int64(i + 1)
		}
		body, _ := json.Marshal(map[string]any{"dataset": "rows", "group_id": 1, "row_ids": ids})
		result, err := decodeRowGroupMembershipRequest(strings.NewReader(string(body)))
		if err != nil || len(result.RowIDs) != size {
			t.Fatalf("%d rows: %v", size, err)
		}
	}
	for _, body := range []string{`{"dataset":"rows","group_id":1,"row_ids":[]}`, `{"dataset":"rows","group_id":1,"row_ids":[-1]}`, `{"dataset":"rows","table_uid":103,"group_id":1,"row_ids":[1]}`} {
		if _, err := decodeRowGroupMembershipRequest(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	ids := make([]int, 201)
	for i := range ids {
		ids[i] = i + 1
	}
	body, _ := json.Marshal(map[string]any{"dataset": "rows", "group_id": 1, "row_ids": ids})
	if _, err := decodeRowGroupMembershipRequest(strings.NewReader(string(body))); err == nil {
		t.Fatal("201 rows accepted")
	}
	result, err := decodeRowGroupMembershipRequest(strings.NewReader(`{"dataset":"rows","group_id":1,"row_ids":[9,2,9]}`))
	if err != nil || fmt.Sprint(result.RowIDs) != "[2 9]" {
		t.Fatalf("normalized: %+v %v", result, err)
	}
}

func TestRowGroupWindowUnknownRowReturns400BeforeMutation(t *testing.T) {
	steps := rowGroupAssignmentSteps(true, true)
	steps = append(steps, rowGroupSQLStep{contains: []string{"ORDER BY id FOR KEY SHARE"}, rows: [][]driver.Value{{int64(1)}}})
	tx := rowGroupMockLazyTx(t, steps...)
	request := httptest.NewRequest(http.MethodPost, "/api/admin/row-group-memberships", strings.NewReader(`{"dataset":"rows","group_id":1,"row_ids":[1,999]}`))
	request = request.WithContext(dbutils.SetLazyTx(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(12, "admin")), tx))
	response := httptest.NewRecorder()
	AdminRowGroupMembershipsHandler(response, request)
	if response.Code != 400 {
		t.Fatalf("response=%d %s", response.Code, response.Body.String())
	}
}

func TestRowGroupWindowBothMembershipMethodsLockBeforeWrites(t *testing.T) {
	for _, assign := range []bool{false, true} {
		t.Run(fmt.Sprint(assign), func(t *testing.T) {
			steps := rowGroupAssignmentSteps(true, true)
			steps = append(steps, rowGroupSQLStep{contains: []string{"FOR KEY SHARE"}, rows: [][]driver.Value{{int64(1)}}})
			if assign {
				steps = append(steps, rowGroupSQLStep{contains: []string{"DELETE FROM", "g.classification_id=$1", "g.id<>$2"}, excludes: []string{"enabled"}}, rowGroupSQLStep{contains: []string{"INSERT INTO", "ON CONFLICT (group_id,table_uid,row_id) DO NOTHING"}})
			} else {
				steps = append(steps, rowGroupSQLStep{contains: []string{"DELETE FROM", "group_id=$1"}})
			}
			err := mutateRowGroupMembership(context.Background(), rowGroupMockTx(t, steps...), rowGroupMembershipRequest{GroupID: 1, Dataset: "rows", RowIDs: []int64{1}}, assign)
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRowGroupWindowForgedRouteGrantCannotBypassAdministratorCheck(t *testing.T) {
	// This models a mistaken route grant: the handler is reached with a non-admin actor.
	for _, handler := range []http.HandlerFunc{AdminRowGroupsHandler, AdminRowGroupMembershipsHandler} {
		for _, method := range []string{"GET", "POST", "DELETE"} {
			request := httptest.NewRequest(method, "/api/admin/row-groups", strings.NewReader(`{}`))
			request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(12, "basic")))
			response := httptest.NewRecorder()
			handler(response, request)
			if response.Code != 403 {
				t.Fatalf("%s: got %d", method, response.Code)
			}
		}
	}
}

func TestAdminRowGroupsHandlerLegacyAndBulkReadback(t *testing.T) {
	for _, query := range []string{"?table_uid=103&row_id=1", "?target=rows&row_ids=1"} {
		steps := []rowGroupSQLStep{}
		if strings.Contains(query, "target") {
			steps = append(steps, rowGroupSQLStep{contains: []string{"FROM public.system_db_tables"}, rows: [][]driver.Value{{int64(103), "public"}}}, rowGroupSQLStep{contains: []string{"SELECT id"}, rows: [][]driver.Value{{int64(1)}}})
		}
		steps = append(steps, rowGroupSQLStep{contains: []string{"g.classification_id", "m.row_id=ANY"}, rows: [][]driver.Value{{int64(1), "boat", `{"fi":"Laiva"}`, `{}`, int64(0), true, int64(1), "{1}"}}}, rowGroupSQLStep{contains: []string{"FROM public.system_row_group_classifications"}, rows: [][]driver.Value{{int64(1), "transport", `{"fi":"Matka"}`, true, int64(0), true}}})
		tx := rowGroupMockLazyTx(t, steps...)
		request := httptest.NewRequest("GET", "/api/admin/row-groups"+query, nil)
		request = request.WithContext(dbutils.SetLazyTx(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(12, "admin")), tx))
		response := httptest.NewRecorder()
		AdminRowGroupsHandler(response, request)
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"selected_rows":[1]`) || !strings.Contains(response.Body.String(), `"classifications":[`) {
			t.Fatalf("response=%d %s", response.Code, response.Body.String())
		}
	}
}

func TestRowGroupWindowStableKeyAndMaximumBatchStatements(t *testing.T) {
	t.Run("legacy stable key", func(t *testing.T) {
		steps := rowGroupAssignmentSteps(false, true)
		steps[2] = rowGroupSQLStep{contains: []string{"WHERE table_uid=$1"}, rows: [][]driver.Value{{"public", "system_config"}}}
		steps = append(steps, rowGroupSQLStep{contains: []string{`SELECT id FROM "public"."system_config"`, `FOR KEY SHARE`}, rows: [][]driver.Value{{int64(8)}}},
			rowGroupSQLStep{contains: []string{"SELECT key FROM public.system_config"}, rows: [][]driver.Value{{"semantic_setting"}}},
			rowGroupSQLStep{contains: []string{"SELECT $1,$2,id,key FROM public.system_config", "ON CONFLICT (group_id,table_uid,target_stable_key)", "DO UPDATE SET row_id=EXCLUDED.row_id"}})
		request, err := decodeRowGroupMembershipRequest(strings.NewReader(`{"group_id":4,"table_uid":104,"row_id":8}`))
		if err != nil {
			t.Fatal(err)
		}
		if err := assignRowGroupInDB(context.Background(), rowGroupMockTx(t, steps...), request); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("200 row writer", func(t *testing.T) {
		ids := make([]int64, 200)
		rows := make([][]driver.Value, 200)
		for i := range ids {
			ids[i] = int64(i + 1)
			rows[i] = []driver.Value{ids[i]}
		}
		steps := rowGroupAssignmentSteps(false, true)
		steps = append(steps, rowGroupSQLStep{contains: []string{"FOR KEY SHARE"}, rows: rows}, rowGroupSQLStep{contains: []string{"ON CONFLICT (group_id,table_uid,row_id) DO NOTHING"}, check: func(args []driver.NamedValue) {
			if fmt.Sprint(args[2].Value) != "{"+strings.Trim(strings.ReplaceAll(fmt.Sprint(ids), " ", ","), "[]")+"}" {
				t.Fatal("writer lost row IDs")
			}
		}})
		if err := assignRowGroupInDB(context.Background(), rowGroupMockTx(t, steps...), rowGroupMembershipRequest{GroupID: 1, Dataset: "rows", RowIDs: ids}); err != nil {
			t.Fatal(err)
		}
	})
}
