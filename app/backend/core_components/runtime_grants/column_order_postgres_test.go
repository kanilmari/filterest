// column_order_postgres_test.go
// Exercises the field editor, startup synchronization and catalogue maintenance
// on real PostgreSQL, including the metadata sent to the add-row form.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	addrow "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	fielddefs "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	dropfields "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_delete"
	columns "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/runtime_grants/granttest"
	"easelect/backend/core_components/security"
	"easelect/backend/core_components/system_table_tools"
)

func assertFieldOrder(t *testing.T, db *sql.DB, uid int64, name string, want int) {
	t.Helper()
	var order sql.NullInt64
	if err := db.QueryRow(`SELECT co_number FROM system_column_details WHERE table_uid=$1 AND column_name=$2`, uid, name).Scan(&order); err != nil || !order.Valid || order.Int64 != int64(want) {
		t.Fatalf("field %s order=%v, want %d: %v", name, order, want, err)
	}
}

func fieldOrderEditorPayload(t *testing.T, dataset string) (string, int) {
	t.Helper()
	rec := httptest.NewRecorder()
	system_table_tools.GetCardVisibilityHandler(rec, httptest.NewRequest("GET", "/api/card-visibility/"+dataset, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("load field editor: %d %s", rec.Code, rec.Body.String())
	}
	var fields struct {
		Columns []system_table_tools.CardVisibilityColumn `json:"columns"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &fields); err != nil {
		t.Fatal(err)
	}
	// Explicitly put description and title first, independently of identity allocation.
	ordered := make([]system_table_tools.CardVisibilityColumn, 0, len(fields.Columns))
	for _, name := range []string{"description", "title", ""} {
		for _, field := range fields.Columns {
			if name == field.ColumnName || name == "" && field.ColumnName != "title" && field.ColumnName != "description" {
				ordered = append(ordered, field)
			}
		}
	}
	data, err := json.Marshal(map[string]any{"table_name": dataset, "columns": ordered})
	if err != nil {
		t.Fatal(err)
	}
	return string(data), len(ordered)
}

func TestSavedFieldOrderAcrossMetadataWritersPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	runtime_grants.FixtureExec(t, f.owner, `DELETE FROM system_db_tables WHERE schema_name='public' AND table_name IN ('spatial_ref_sys','payments') AND to_regclass(format('%I.%I',schema_name,table_name)) IS NULL`)
	const dataset = "ordered_fields"
	uid := f.create(dataset, `,{"name":"description","data_type":"TEXT"}`)
	f.request(system_table_tools.HandleUpdateOidsAndTableNames, "", http.StatusOK)

	current := func(t *testing.T, want string) {
		t.Helper()
		req := concurrentAdminRequest(t, context.Background(), "/api/update-oids?only_if_changed=true", "")
		rec := httptest.NewRecorder()
		middlewares.WithLazyTransaction(http.HandlerFunc(system_table_tools.HandleUpdateOidsAndTableNames)).ServeHTTP(rec, req)
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Fatalf("conditional refresh: HTTP %d %q, want %q", rec.Code, rec.Body.String(), want)
		}
	}
	save := func(t *testing.T) {
		t.Helper()
		data, _ := fieldOrderEditorPayload(t, dataset)
		f.request(system_table_tools.UpdateCardVisibilityHandler, data, http.StatusOK)
		assertFieldOrder(t, f.owner, uid, "description", 1)
		assertFieldOrder(t, f.owner, uid, "title", 2)
	}
	addRowOrder := func(t *testing.T, want []string) {
		t.Helper()
		rec := httptest.NewRecorder()
		addrow.GetAddRowColumnsHandlerWrapper(rec, httptest.NewRequest("GET", fmt.Sprintf("/api/get-columns?table_uid=%d", uid), nil))
		var fields []struct {
			Name string `json:"column_name"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &fields); rec.Code != http.StatusOK || err != nil {
			t.Fatalf("add-row metadata: HTTP %d %s: %v", rec.Code, rec.Body, err)
		}
		var got []string
		for _, field := range fields {
			got = append(got, field.Name)
		}
		if !slices.Equal(got, want) {
			t.Fatalf("add-row fields %v, want %v", got, want)
		}
	}
	t.Run("startup", func(t *testing.T) {
		save(t)
		if err := columns.UpdateColumnMetadata(f.owner, true); err != nil {
			t.Fatal(err)
		}
		assertFieldOrder(t, f.owner, uid, "description", 1)
		assertFieldOrder(t, f.owner, uid, "title", 2)
		addRowOrder(t, []string{"description", "title"})
	})
	t.Run("conditional and explicit catalogue", func(t *testing.T) {
		save(t)
		current(t, "Catalogue metadata is current.")
		for _, drift := range []string{
			`UPDATE system_column_details SET data_type='stale' WHERE table_uid=$1 AND column_name='title'`,
			`UPDATE system_column_details SET card_element='' WHERE table_uid=$1 AND column_name='title'`,
			`UPDATE system_column_details SET co_number=NULL WHERE table_uid=$1 AND column_name='id'`,
		} {
			runtime_grants.FixtureExec(t, f.owner, drift, uid)
			current(t, "OID values, table names, and column metadata updated successfully.")
			current(t, "Catalogue metadata is current.")
		}
		f.request(system_table_tools.HandleUpdateOidsAndTableNames, "", http.StatusOK)
		assertFieldOrder(t, f.owner, uid, "description", 1)
		assertFieldOrder(t, f.owner, uid, "title", 2)
		addRowOrder(t, []string{"description", "title"})
	})
	t.Run("append in physical order after legacy positions", func(t *testing.T) {
		// Restored datasets may have gaps, negative values and missing positions.
		runtime_grants.FixtureExec(t, f.owner, `UPDATE system_column_details SET co_number=CASE column_name WHEN 'description' THEN -7 WHEN 'title' THEN 1000000 WHEN 'id' THEN NULL ELSE co_number END WHERE table_uid=$1`, uid)
		f.request(workflows.ModifyColumnsHandler, `{"dataset_name":"ordered_fields","added_columns":[{"new_name":"z_first","data_type":"TEXT"},{"new_name":"a_second","data_type":"TEXT"}]}`, http.StatusOK)
		for name, order := range map[string]int{"description": -7, "title": 1000000, "id": 1000001, "z_first": 1000002, "a_second": 1000003} {
			assertFieldOrder(t, f.owner, uid, name, order)
		}
		current(t, "Catalogue metadata is current.")
		addRowOrder(t, []string{"description", "title", "z_first", "a_second"})
	})
	t.Run("rename keeps identity and order", func(t *testing.T) {
		var before, after int
		if err := f.owner.QueryRow(`SELECT column_uid FROM system_column_details WHERE table_uid=$1 AND column_name='title'`, uid).Scan(&before); err != nil {
			t.Fatal(err)
		}
		runtime_grants.FixtureExec(t, f.owner, `UPDATE system_column_details SET co_number=694 WHERE table_uid=$1 AND column_uid=$2`, uid, before)
		f.request(workflows.ModifyColumnsHandler, `{"dataset_name":"ordered_fields","modified_columns":[{"original_name":"title","new_name":"renamed_title","data_type":"TEXT"}]}`, http.StatusOK)
		if err := f.owner.QueryRow(`SELECT column_uid FROM system_column_details WHERE table_uid=$1 AND column_name='renamed_title'`, uid).Scan(&after); err != nil || after != before {
			t.Fatalf("renamed field uid=%d, want %d: %v", after, before, err)
		}
		assertFieldOrder(t, f.owner, uid, "renamed_title", 694)
	})
}

// Interleave a second connection's commits with the two discovery snapshots.
// This is the non-transactional Querier used by startup.
type interleavedColumnDiscovery struct {
	*sql.DB
	beforeMetadataRead, afterMetadataRead func()
}

func (c interleavedColumnDiscovery) Query(query string, args ...any) (*sql.Rows, error) {
	if !strings.Contains(query, "SELECT column_name, column_uid, data_type") {
		return c.DB.Query(query, args...)
	}
	c.beforeMetadataRead()
	rows, err := c.DB.Query(query, args...)
	if err == nil {
		c.afterMetadataRead()
	}
	return rows, err
}

func TestColumnDiscoveryKeepsConcurrentlyRegisteredFieldsPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	uid := f.create("column_discovery", "")
	runtime_grants.FixtureExec(t, f.owner, `ALTER TABLE column_discovery ADD COLUMN awaiting_registration text, ADD COLUMN dropped_during_discovery text`)
	connection := interleavedColumnDiscovery{f.owner, func() {
		// Appears after discovery read pg_attribute and before it reads the registry.
		runtime_grants.FixtureExec(t, f.owner, `ALTER TABLE column_discovery ADD COLUMN registered_later text`)
		runtime_grants.FixtureExec(t, f.owner, `INSERT INTO system_column_details (table_uid,column_name,data_type,co_number,card_element)
            VALUES ($1,'registered_later','text',902,'header')`, uid)
	}, func() {
		runtime_grants.FixtureExec(t, f.owner, `ALTER TABLE column_discovery DROP COLUMN dropped_during_discovery`)
		// Another writer wins the INSERT after discovery saw this registry row missing.
		runtime_grants.FixtureExec(t, f.owner, `INSERT INTO system_column_details (table_uid,column_name,data_type,co_number,card_element)
            VALUES ($1,'awaiting_registration','text',802,'header')`, uid)
	}}
	if err := columns.UpdateDatasetColumnMetadata(connection, "column_discovery"); err != nil {
		t.Fatal(err)
	}
	assertFieldOrder(t, f.owner, uid, "awaiting_registration", 802)
	assertFieldOrder(t, f.owner, uid, "registered_later", 902)
	var revived bool
	if err := f.owner.QueryRow(`SELECT EXISTS(SELECT FROM system_column_details WHERE table_uid=$1 AND column_name='dropped_during_discovery')`, uid).Scan(&revived); err != nil || revived {
		t.Fatalf("dropped field registered again: %t, %v", revived, err)
	}

}

func TestFieldNamesCanBeReusedInOneDefinitionSavePostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	uid := f.create("reuse_field_name", `,{"name":"description","data_type":"TEXT"},{"name":"replacement","data_type":"TEXT"}`)
	runtime_grants.FixtureExec(t, f.owner, `UPDATE system_column_details SET co_number=CASE column_name
        WHEN 'title' THEN 9900 WHEN 'replacement' THEN 40 WHEN 'description' THEN -9 ELSE co_number END WHERE table_uid=$1`, uid)
	fieldUID := func(name string) int {
		t.Helper()
		var id int
		if err := f.owner.QueryRow(`SELECT column_uid FROM system_column_details WHERE table_uid=$1 AND column_name=$2`, uid, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	from, removed := fieldUID("replacement"), fieldUID("title")
	f.request(workflows.ModifyColumnsHandler, `{"dataset_name":"reuse_field_name","removed_columns":["description","title"],
        "modified_columns":[{"original_name":"replacement","new_name":"description","data_type":"TEXT"}],
        "added_columns":[{"new_name":"title","data_type":"TEXT"}]}`, http.StatusOK)
	if fieldUID("description") != from || fieldUID("title") == removed {
		t.Fatal("reused name retained the wrong metadata identity")
	}
	assertFieldOrder(t, f.owner, uid, "description", 40)
	assertFieldOrder(t, f.owner, uid, "title", 41)
}

func TestFieldOrderInInheritedTablesPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	runtime_grants.FixtureExec(t, f.owner, `CREATE SCHEMA other;
        CREATE TABLE public.order_parent (id integer, label text, shared text);
        CREATE TABLE other.order_child (shared text) INHERITS (public.order_parent);
        CREATE TABLE other.order_reference (untouched text);
        CREATE TABLE public.order_child (unregistered_shadow text);
        INSERT INTO system_db_tables (schema_name,table_name) VALUES
        ('public','order_parent'),('other','order_child'),('other','order_reference')`)
	if err := columns.UpdateColumnMetadata(f.owner, true); err != nil {
		t.Fatal(err)
	}
	runtime_grants.FixtureExec(t, f.owner, `UPDATE system_column_details d SET co_number=
        CASE t.table_name WHEN 'order_child' THEN -33 ELSE 70 END
        FROM system_db_tables t WHERE t.table_uid=d.table_uid AND
        t.table_name IN ('order_parent','order_child','order_reference') AND d.column_name IN ('label','shared','untouched')`)
	tx, err := f.owner.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := columns.UpdateColumns(tx, "order_parent", []fielddefs.ModifiedCol{{OriginalName: "label", NewName: "renamed", DataType: "text"}}, security.SanitizeIdentifier); err != nil {
		t.Fatal(err)
	}
	if err := dropfields.RemoveColumns(tx, "order_parent", []string{"shared"}); err != nil {
		t.Fatal(err)
	}
	if err := columns.UpdateColumnMetadata(tx); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	rows, err := f.owner.Query(`SELECT t.schema_name||'.'||t.table_name||'.'||d.column_name||'='||d.co_number FROM system_column_details d
        JOIN system_db_tables t USING(table_uid) WHERE t.table_name IN ('order_parent','order_child','order_reference') AND d.column_name<>'id' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatal(err)
		}
		got = append(got, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []string{"other.order_child.renamed=-33", "other.order_child.shared=-33", "other.order_reference.untouched=70", "public.order_parent.renamed=70"}
	if !slices.Equal(got, want) {
		t.Fatalf("inherited and schema-qualified fields=%v, want %v", got, want)
	}
}

func TestFieldOrderIntegerLimitPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	uid := f.create("field_order_limit", "")
	runtime_grants.FixtureExec(t, f.owner, `UPDATE system_column_details SET co_number=$2 WHERE table_uid=$1 AND column_name='title'`, uid, math.MaxInt32)
	if err := columns.UpdateDatasetColumnMetadata(f.owner, "field_order_limit"); err != nil {
		t.Fatal(err)
	}
	runtime_grants.FixtureExec(t, f.owner, `ALTER TABLE field_order_limit ADD COLUMN extra text`)
	if err := columns.UpdateDatasetColumnMetadata(f.owner, "field_order_limit"); err == nil || !strings.Contains(err.Error(), "integer range") {
		t.Fatalf("adding beyond last integer returned %v", err)
	}
	assertFieldOrder(t, f.owner, uid, "title", math.MaxInt32)
}

// Commit when the actual discovery statement is waiting on this editor. If
// discovery completes without waiting, commit immediately afterwards instead.
func finishOverlappingFieldSave(db *sql.DB, editor *dbutils.LazyTx, pid int, finished <-chan struct{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	defer editor.Rollback()
	for {
		var waiting bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, pid).Scan(&waiting); err != nil {
			return err
		}
		if waiting {
			return editor.Commit()
		}
		select {
		case <-finished:
			return editor.Commit()
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func TestFieldDiscoveryAppendsAcrossEditorSavePostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	for _, stage := range []string{"committed", "uncommitted"} {
		t.Run(stage, func(t *testing.T) {
			dataset := "editor_" + stage
			uid := f.create(dataset, `,{"name":"description","data_type":"TEXT"}`)
			runtime_grants.FixtureExec(t, f.owner, `UPDATE system_column_details SET co_number=0 WHERE table_uid=$1`, uid)
			runtime_grants.FixtureExec(t, f.owner, "ALTER TABLE "+dataset+" ADD COLUMN z_first text, ADD COLUMN a_second text")
			editor := dbutils.NewLazyTx(f.owner)
			defer editor.Rollback()
			finished := make(chan struct{})
			saved := make(chan error, 1)
			count := 0
			snapshot := interleavedColumnDiscovery{f.owner, func() {
				data, n := fieldOrderEditorPayload(t, dataset)
				count = n
				req := concurrentAdminRequest(t, context.Background(), "/api/card-visibility/update", data)
				req = req.WithContext(dbutils.SetLazyTx(req.Context(), editor))
				rec := httptest.NewRecorder()
				system_table_tools.UpdateCardVisibilityHandler(granttest.Recorder{ResponseRecorder: rec}, req)
				if rec.Code != http.StatusOK {
					t.Fatalf("editor: %d %s", rec.Code, rec.Body)
				}
				if stage == "committed" {
					if err := editor.Commit(); err != nil {
						t.Fatal(err)
					}
				} else {
					tx, err := editor.Begin()
					if err != nil {
						t.Fatal(err)
					}
					var pid int
					if err := tx.QueryRow("SELECT pg_backend_pid()").Scan(&pid); err != nil {
						t.Fatal(err)
					}
					go func() { saved <- finishOverlappingFieldSave(f.owner, editor, pid, finished) }()
				}
			}, func() {}}
			err := columns.UpdateDatasetColumnMetadata(snapshot, dataset)
			close(finished)
			if stage == "uncommitted" {
				if saveErr := <-saved; saveErr != nil {
					t.Fatal(saveErr)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			assertFieldOrder(t, f.owner, uid, "description", 1)
			assertFieldOrder(t, f.owner, uid, "title", 2)
			assertFieldOrder(t, f.owner, uid, "z_first", count+1)
			assertFieldOrder(t, f.owner, uid, "a_second", count+2)
		})
	}
}
