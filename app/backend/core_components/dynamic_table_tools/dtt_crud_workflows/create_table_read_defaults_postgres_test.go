// create_table_read_defaults_postgres_test.go
// Proves the creation flag writes ordinary guest grants against the public bootstrap.
// Exercises creation, permission edits and no-toggle definition saves in disposable PostgreSQL.
// Explicit administrator grants remain possible without migrating existing datasets.
package dtt_crud_workflows

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/runtime_grants/granttest"
)

func TestCreatedDatasetGuestReadDefaultsAndExplicitAIGrantPostgres(t *testing.T) {
	db, _ := registrationDisposableDB(t)
	loadPublicBootstrap(t, db)
	for _, flags := range []struct {
		name          string
		users, guests bool
	}{
		{"b283_no_read", false, false}, {"b283_users_read", true, false},
		{"b283_guests_read", false, true}, {"b283_both_read", true, true},
	} {
		t.Run(flags.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{
				"dataset_name": flags.name, "folder_id": 4,
				"grant_users_read": flags.users, "grant_guests_read": flags.guests,
				"column_list": []map[string]string{{"name": "id", "data_type": "SERIAL"}, {"name": "title", "data_type": "TEXT"}},
			})
			rec := postCreateDataset(t, db, string(body))
			if rec.Code != http.StatusCreated {
				t.Fatalf("create: %d %s", rec.Code, rec.Body)
			}
			for _, group := range []string{"guests", "users"} {
				granted := createdDatasetFunctionGrants(t, db, flags.name, group)
				want := []string{}
				if group == "guests" && flags.guests {
					want = datasetReadFunctionNames(false)
				}
				if group == "users" && flags.users {
					want = datasetReadFunctionNames(true)
				}
				slices.Sort(want)
				if !slices.Equal(granted, want) {
					t.Fatalf("%s grants=%v; want=%v", group, granted, want)
				}
			}
			admins := createdDatasetFunctionGrants(t, db, flags.name, "admins")
			for _, name := range []string{"dtt_1_row_read.GetIntelligentResultsHandlerWrapper", "dtt_1_row_read.GetResultsVector"} {
				if !slices.Contains(admins, name) {
					t.Fatalf("administrator lost %s", name)
				}
			}
			assertDefinitionSavePreservesGrants(t, db, flags.name)
		})
	}

	// Exercise the administrator permission writer rather than inserting a grant
	// in the proof. The route's administrator/CSRF middleware is tested separately.
	var uid, guestID int
	if err := db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name='b283_guests_read'`).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT id FROM system_user_groups WHERE name='guests'`).Scan(&guestID); err != nil {
		t.Fatal(err)
	}
	var additions []backend.Permission
	for _, name := range []string{"dtt_1_row_read.GetIntelligentResultsHandlerWrapper", "dtt_1_row_read.GetResultsVector"} {
		var functionID int
		if err := db.QueryRow(`SELECT id FROM system_functions WHERE name=$1`, name).Scan(&functionID); err != nil {
			t.Fatal(err)
		}
		additions = append(additions, backend.Permission{AuthUserGroupID: guestID, FunctionID: functionID, TargetTableUID: uid, TargetSchemaName: "public"})
	}
	payload, _ := json.Marshal(map[string]any{"add": additions})
	lt := dbutils.NewLazyTx(db)
	defer lt.Rollback()
	req := httptest.NewRequest(http.MethodPatch, "/api/dataset_permissions", strings.NewReader(string(payload)))
	rec := httptest.NewRecorder()
	backend.PermissionsHandler(granttest.Recorder{ResponseRecorder: rec}, req.WithContext(dbutils.SetLazyTx(req.Context(), lt)))
	if rec.Code != http.StatusOK {
		t.Fatalf("explicit grant: %d %s", rec.Code, rec.Body)
	}
	if err := lt.Commit(); err != nil {
		t.Fatal(err)
	}
	granted := createdDatasetFunctionGrants(t, db, "b283_guests_read", "guests")
	want := datasetReadFunctionNames(true)
	slices.Sort(want)
	if !slices.Equal(granted, want) {
		t.Fatalf("explicit AI grants=%v; want=%v", granted, want)
	}
	// A legacy or separately granted guest AI bundle survives the definition
	// request that the editor still sends when neither read checkbox changed.
	assertDefinitionSavePreservesGrants(t, db, "b283_guests_read")
}

func assertDefinitionSavePreservesGrants(t *testing.T, db *sql.DB, dataset string) {
	t.Helper()
	readRows := func() []string {
		t.Helper()
		rows, err := db.Query(`SELECT row_to_json(p)::text FROM system_group_table_func_rights p
            JOIN system_db_tables d ON d.table_uid=p.target_table_uid
            WHERE d.table_name=$1 ORDER BY p.id`, dataset)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		result := []string{}
		for rows.Next() {
			var row string
			if err := rows.Scan(&row); err != nil {
				t.Fatal(err)
			}
			result = append(result, row)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}
	before := readRows()
	body, err := json.Marshal(map[string]any{
		"dataset_name": dataset, "modified_columns": []any{}, "added_columns": []any{}, "removed_columns": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	lt := dbutils.NewLazyTx(db)
	defer lt.Rollback()
	req := httptest.NewRequest(http.MethodPost, "/api/modify_columns", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	ModifyColumnsHandler(granttest.Recorder{ResponseRecorder: rec}, req.WithContext(dbutils.SetLazyTx(req.Context(), lt)))
	if rec.Code != http.StatusOK {
		t.Fatalf("no-toggle definition save: %d %s", rec.Code, rec.Body)
	}
	if err := lt.Commit(); err != nil {
		t.Fatal(err)
	}
	if after := readRows(); !slices.Equal(before, after) {
		t.Fatalf("no-toggle save rewrote grants: before=%v after=%v", before, after)
	}
}

func createdDatasetFunctionGrants(t *testing.T, db *sql.DB, dataset, group string) []string {
	t.Helper()
	rows, err := db.Query(`SELECT f.name FROM system_group_table_func_rights p
        JOIN system_functions f ON f.id=p.function_id
        JOIN system_user_groups g ON g.id=p.user_group_id
        JOIN system_db_tables d ON d.table_uid=p.target_table_uid
        WHERE d.table_name=$1 AND g.name=$2 ORDER BY f.name`, dataset, group)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		result = append(result, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}
