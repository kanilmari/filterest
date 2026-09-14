// card_label_visibility_test.go
// Verifies raw inherited label choices through JSON, SQL writes and the shared policy.
// Connects the real upgrade migration to admin reads and the support matrix.
// Protects explicit choices while future default changes affect only inherited rows.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
)

func TestCardLabelVisibilityRequestPresence(t *testing.T) {
	for _, test := range []struct {
		body     string
		provided bool
		want     string
	}{
		{`{}`, false, "null"}, {`{"show_key_on_card_override":null}`, true, "null"},
		{`{"show_key_on_card_override":false}`, true, "false"}, {`{"show_key_on_card_override":true}`, true, "true"},
		{`{"show_key_on_card":false}`, true, "false"}, {`{"show_key_on_card":true}`, true, "true"},
		{`{"show_key_on_card":true,"show_key_on_card_override":null}`, true, "null"},
		{`{"show_key_on_card":false,"show_key_on_card_override":true}`, true, "true"},
		{`{"label_value_layout":"stacked"}`, false, "null"},
	} {
		t.Run(test.body, func(t *testing.T) {
			var column CardVisibilityColumn
			if err := json.Unmarshal([]byte(test.body), &column); err != nil {
				t.Fatal(err)
			}
			provided, value := cardLabelVisibilityOverrideForWrite(column)
			raw, err := json.Marshal(value)
			if err != nil || provided != test.provided || string(raw) != test.want {
				t.Fatalf("write = %v %s %v", provided, raw, err)
			}
			serialized, err := json.Marshal(column)
			if err != nil || !strings.Contains(string(serialized), `"show_key_on_card_override":`) {
				t.Fatalf("raw key missing: %s %v", serialized, err)
			}
		})
	}
}

func TestCardLabelVisibilityRejectsInvalidValuesBeforeTransaction(t *testing.T) {
	for _, field := range []string{"show_key_on_card", "show_key_on_card_override"} {
		values := []string{`"true"`, `"false"`, `""`, "0", "1", "[]", "{}"}
		if field == "show_key_on_card" {
			values = append(values, "null")
		}
		for _, value := range values {
			body := `{"table_name":"fixture","columns":[{"column_uid":1,"` + field + `":` + value + `}]}`
			rec := httptest.NewRecorder()
			UpdateCardVisibilityHandler(rec, httptest.NewRequest(http.MethodPost, "/api/card-visibility/update", strings.NewReader(body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s=%s: status %d %s", field, value, rec.Code, rec.Body)
			}
		}
	}
}

func cardLabelVisibilityFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := sitePresentationDisposableDB(t)
	_, err := db.Exec(`
 CREATE TABLE system_db_tables(table_uid integer PRIMARY KEY, table_name text, schema_name text DEFAULT 'public',
 row_policy_owner_column text, card_details_layout text);
 CREATE TABLE system_table_views(id integer PRIMARY KEY, view_key text, name text, status text);
 CREATE TABLE system_column_details(
 column_uid integer PRIMARY KEY, table_uid integer, column_name text, co_number integer,
 card_element text, show_key_on_card boolean DEFAULT false, show_value_on_card boolean,
 card_detail_label_mode text, card_detail_icon_svg text, card_detail_icon_key text,
 card_detail_capitalization boolean, label_value_layout text, updated timestamptz,
 hide_everywhere boolean, client_delivery_mode text, hide_on_small_card boolean,
 hide_false_null_on_sml_crd boolean, hide_false_null_on_big_crd boolean, hide_on_bg_crd_if_not_own boolean,
 hide_in_filter_panel boolean, insertable boolean, data_type text, editable_in_ui boolean, is_multilingual boolean);
 INSERT INTO system_db_tables(table_uid,table_name) VALUES(1,'fixture');
 INSERT INTO system_table_views VALUES(1,'card','Card','active'),(2,'article_view','Article','active');
 INSERT INTO system_column_details(column_uid,table_uid,column_name,card_element,show_key_on_card)
 VALUES(1,1,'inherited','details',NULL),(2,1,'explicit_false','details',false),(3,1,'explicit_true','header',true);
 `)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20260914000005_inherit_card_field_labels.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(migration)); err != nil {
		t.Fatalf("actual migration05: %v", err)
	}
	return db
}

func TestCardLabelVisibilitySharedPolicyAndAPIPostgres(t *testing.T) {
	db := cardLabelVisibilityFixture(t)
	for _, test := range []struct {
		role string
		want bool
	}{
		{"details", true}, {"details0", true}, {"details123", true}, {"details_link", true}, {"details_link10 + lang-key", true},
		{" details2+lang_key ", true}, {"image,details", true}, {"details, header + lang_key", false},
		{"description", false}, {"description123", false}, {"details,description12", false}, {"details,keywords", false},
		{"image", false}, {"", false}, {"unknown", false}, {"header2", false}, {"Details", false}, {"details_bad", false},
	} {
		var value bool
		if err := db.QueryRow("SELECT public.resolve_card_label_visibility(NULL,$1)", test.role).Scan(&value); err != nil || value != test.want {
			t.Fatalf("role %q=%t: %v", test.role, value, err)
		}
		for _, override := range []bool{false, true} {
			if err := db.QueryRow("SELECT public.resolve_card_label_visibility($1,$2)", override, test.role).Scan(&value); err != nil || value != override {
				t.Fatalf("explicit %t role %q=%t: %v", override, test.role, value, err)
			}
		}
	}
	if _, err := db.Exec("INSERT INTO system_column_details(column_uid,table_uid,column_name,card_element) VALUES(4,1,'new_column','details')"); err != nil {
		t.Fatal(err)
	}
	var raw *bool
	if err := db.QueryRow("SELECT show_key_on_card FROM system_column_details WHERE column_uid=4").Scan(&raw); err != nil || raw != nil {
		t.Fatalf("new column raw=%v: %v", raw, err)
	}
	previous := backend.Db
	backend.Db = db
	t.Cleanup(func() { backend.Db = previous })
	rec := httptest.NewRecorder()
	GetCardVisibilityHandler(rec, httptest.NewRequest(http.MethodGet, "/api/card-visibility/fixture", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin read %d: %s", rec.Code, rec.Body)
	}
	var response CardVisibilityResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Columns) != 4 {
		t.Fatalf("columns=%d", len(response.Columns))
	}
	for _, column := range response.Columns {
		var effective bool
		if err := db.QueryRow("SELECT show_key_on_card FROM system_column_supported_views WHERE column_uid=$1 AND view_key='card'", column.ColumnUID).Scan(&effective); err != nil {
			t.Fatal(err)
		}
		if effective != column.ShowKeyOnCard {
			t.Fatalf("admin/support mismatch: %#v", column)
		}
		if (column.ColumnUID == 1 || column.ColumnUID == 4) && (column.ShowKeyOnCardOverride != nil || !effective) {
			t.Fatalf("inherited API=%#v", column)
		}
		if column.ColumnUID == 2 && (column.ShowKeyOnCardOverride == nil || *column.ShowKeyOnCardOverride || effective) {
			t.Fatalf("explicit false API=%#v", column)
		}
		if column.ColumnUID == 3 && (column.ShowKeyOnCardOverride == nil || !*column.ShowKeyOnCardOverride || !effective) {
			t.Fatalf("explicit true API=%#v", column)
		}
	}
	// Simulate a later policy version inside an isolated rollback-only transaction.
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	_, err = tx.Exec(`CREATE OR REPLACE FUNCTION public.resolve_card_label_visibility(label_override boolean,card_role text)
 RETURNS boolean LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS 'SELECT COALESCE(label_override,false)'`)
	if err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int]bool{1: false, 2: false, 3: true, 4: false} {
		var got bool
		if err := tx.QueryRow("SELECT show_key_on_card FROM system_column_supported_views WHERE column_uid=$1 AND view_key='card'", id).Scan(&got); err != nil || got != want {
			t.Fatalf("future policy %d=%t: %v", id, got, err)
		}
	}
}

func TestCardLabelVisibilityConditionalWritesPostgres(t *testing.T) {
	db := cardLabelVisibilityFixture(t)
	for _, test := range []struct {
		body string
		want string
	}{
		{`{"label_value_layout":"stacked"}`, "null"},
		{`{"show_key_on_card_override":false}`, "false"},
		{`{"label_value_layout":null}`, "false"},
		{`{"show_key_on_card_override":true}`, "true"},
		{`{"show_key_on_card":true,"show_key_on_card_override":null}`, "null"},
		{`{"show_key_on_card":false}`, "false"},
		{`{"show_key_on_card_override":null}`, "null"},
	} {
		var column CardVisibilityColumn
		if err := json.Unmarshal([]byte(test.body), &column); err != nil {
			t.Fatal(err)
		}
		column.ColumnUID = 1
		column.CardElement = "details"
		column.ClientDeliveryMode = "include"
		_, err := db.Exec(buildCardVisibilityUpdateQuery(true, true, column.labelValueLayoutProvided),
			buildCardVisibilityUpdateArgs(column, true, true, column.labelValueLayoutProvided)...)
		if err != nil {
			t.Fatalf("%s: %v", test.body, err)
		}
		var value *bool
		if err := db.QueryRow("SELECT show_key_on_card FROM system_column_details WHERE column_uid=1").Scan(&value); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(value)
		if string(raw) != test.want {
			t.Fatalf("%s raw=%s want=%s", test.body, raw, test.want)
		}
	}
	var untouched bool
	if err := db.QueryRow("SELECT show_key_on_card FROM system_column_details WHERE column_uid=3").Scan(&untouched); err != nil || !untouched {
		t.Fatalf("other column changed: %v", err)
	}
}
