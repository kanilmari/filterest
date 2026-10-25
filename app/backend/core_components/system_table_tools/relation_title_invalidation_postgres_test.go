// relation_title_invalidation_postgres_test.go
// Proves supported target saves immediately change titles of warm source results.
// Connects real HTTP saves and PostgreSQL reads to the actual browser title resolver.
// Uses a disposable cluster; Node substitutes only translation and language services.
package system_table_tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

// Run the maintained resolver and its real formatting/localization helpers without
// a browser. Translation transport is replaced with the resolver's fallback copy.
func assertRelationResponseTitle(t *testing.T, response map[string]any, fallback bool) {
	t.Helper()
	resolver, err := filepath.Abs("../../../frontend/core_components/table_views/record_title_resolver.js")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	const script = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const path = pathToFileURL(process.argv[1]);
let source = readFileSync(path, 'utf8');
source = source.replace(/from '([^']+)'/g, (_, specifier) => {
  let url;
  if (specifier.endsWith('/translation_handler.js')) {
    url = 'data:text/javascript,export function getTranslationForKey(key, options) { return options.fallback; }';
  } else if (specifier.endsWith('/lang_preference_reader.js')) {
    url = 'data:text/javascript,export function getLanguageWithBrowserFallback() { return "en"; }';
  } else {
    url = new URL(specifier, path).href;
  }
  return 'from ' + JSON.stringify(url);
});
const { resolveRecordTitle } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const response = JSON.parse(readFileSync(0, 'utf8'));
for (const preferredLanguage of ['en', 'fi']) {
  const title = resolveRecordTitle({ rowItem: response.data[0], columns: response.columns,
    dataTypes: response.types, tableMeta: { fk_display_column: 'customer_id' }, preferredLanguage });
  const fallback = process.argv[2] === 'true';
  const expected = fallback ? (preferredLanguage === 'fi' ? 'Tietue 1' : 'Record 1')
    : (preferredLanguage === 'fi' ? 'Asiakkaan nimi' : 'Customer label');
  if (title.text !== expected || title.isFallback !== fallback) {
    throw new Error(JSON.stringify({preferredLanguage, title, expected}));
  }
}`
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script, resolver, fmt.Sprint(fallback))
	command.Stdin = strings.NewReader(string(raw))
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("actual title resolver: %v: %s", err, out)
	}
}

func TestRelationTitleResponseFallbackUsesTargetFacts(t *testing.T) {
	for _, change := range []string{"readable", "hidden", "server_only", "multilingual removed"} {
		t.Run(change, func(t *testing.T) {
			target := map[string]any{"data_type": "jsonb", "hide_everywhere": false, "client_delivery_mode": "include", "is_multilingual": true}
			switch change {
			case "hidden":
				target["hide_everywhere"] = true
			case "server_only":
				target["client_delivery_mode"] = "server_only"
			case "multilingual removed":
				target["is_multilingual"] = false
			}
			assertRelationResponseTitle(t, map[string]any{
				"columns": []string{"id", "customer_id"},
				"types": map[string]any{"id": map[string]any{"data_type": "integer"}, "customer_id": map[string]any{
					"data_type": "integer", "foreign_table": "wl962_title_target", "foreign_display_column": "name", "foreign_display_metadata": target}},
				"data": []map[string]any{{"id": 1, "customer_id": 7, "customer_name (ln)": map[string]string{"en": "Customer label", "fi": "Asiakkaan nimi"}}},
			}, change != "readable")
		})
	}
}

func TestRelationTitleTargetSaveInvalidationPostgres(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `
 CREATE TABLE wl962_title_target(id integer PRIMARY KEY, name jsonb);
 CREATE TABLE wl962_title_source(id integer PRIMARY KEY, customer_id integer REFERENCES wl962_title_target(id));
 INSERT INTO wl962_title_target VALUES(7,'{"en":"Customer label","fi":"Asiakkaan nimi"}');
 INSERT INTO wl962_title_source VALUES(1,7);
 INSERT INTO system_db_tables(table_name,schema_name,folder_id,fk_display_column)
 VALUES('wl962_title_target','public',1,'name'),('wl962_title_source','public',1,'customer_id');
 INSERT INTO system_column_details(table_uid,column_name,data_type,co_number,is_multilingual,show_value_on_card)
 SELECT registry.table_uid,col.column_name,col.data_type,col.ordinal_position,col.column_name='name',true
 FROM information_schema.columns col JOIN system_db_tables registry ON registry.table_name=col.table_name
 WHERE col.table_schema='public' AND col.table_name IN ('wl962_title_source','wl962_title_target');
 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
 SELECT 2,500000,table_uid FROM system_db_tables WHERE table_name IN ('wl962_title_source','wl962_title_target');`)
	var columns []CardVisibilityColumn
	rows, err := db.Query(`SELECT column_uid,column_name FROM system_column_details
 WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='wl962_title_target') ORDER BY co_number`)
	if err != nil {
		t.Fatal(err)
	}
	var nameUID int64
	for rows.Next() {
		var column CardVisibilityColumn
		if err := rows.Scan(&column.ColumnUID, &column.ColumnName); err != nil {
			t.Fatal(err)
		}
		column.ClientDeliveryMode, column.ShowValueOnCard = "include", true
		columns = append(columns, column)
		if column.ColumnName == "name" {
			nameUID = int64(column.ColumnUID)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	if nameUID == 0 {
		t.Fatal("target label missing")
	}
	for _, name := range []string{"wl962_title_source", "wl962_title_target"} {
		read.InvalidateSchemaCache(name)
		read.InvalidatePermissionsCache(name)
		read.InvalidateUserColumnSettingsCache(name, "card")
		t.Cleanup(func() {
			read.InvalidateSchemaCache(name)
			read.InvalidatePermissionsCache(name)
			read.InvalidateUserColumnSettingsCache(name, "card")
		})
	}
	requestSource := func() map[string]any {
		t.Helper()
		response := httptest.NewRecorder()
		read.GetResults(response, frontPageSessionRequest(t, 42, "basic", "GET", "/api/get-results?dataset=wl962_title_source&view_key=card"))
		var result map[string]any
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatalf("source read: %d %s", response.Code, response.Body)
		}
		if data, ok := result["data"].([]any); !ok || len(data) != 1 {
			t.Fatalf("source record disappeared: %v", result)
		}
		return result
	}
	save := func(handler http.HandlerFunc, target string, body any) *dbutils.LazyTx {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		lazy := dbutils.NewLazyTx(db)
		t.Cleanup(func() { lazy.Rollback() })
		request := frontPageSessionRequest(t, 42, "admin", "POST", target)
		request.Body = io.NopCloser(strings.NewReader(string(raw)))
		request = request.WithContext(dbutils.SetLazyTx(request.Context(), lazy))
		response := httptest.NewRecorder()
		// Keep manual commits so reads can assert both pre-commit and post-commit titles.
		handler(&appearanceTestResponseBuffer{response}, request)
		if response.Code != http.StatusOK {
			t.Fatalf("save %s: %d %s", target, response.Code, response.Body)
		}
		return lazy
	}
	for _, change := range []string{"hidden", "server_only", "multilingual removed"} {
		t.Run(change, func(t *testing.T) {
			for i := range columns {
				columns[i].HideEverywhere, columns[i].ClientDeliveryMode = false, "include"
			}
			if err := save(UpdateCardVisibilityHandler, "/api/card-visibility/update", map[string]any{"table_name": "wl962_title_target", "columns": columns}).Commit(); err != nil {
				t.Fatal(err)
			}
			if err := save(UpdateColumnMultilingualHandler, "/api/admin/column-multilingual", map[string]any{"dataset": "wl962_title_target", "column_uid": nameUID, "is_multilingual": true}).Commit(); err != nil {
				t.Fatal(err)
			}
			assertRelationResponseTitle(t, requestSource(), false) // Warm the referencing dataset.
			var lazy *dbutils.LazyTx
			if change == "multilingual removed" {
				lazy = save(UpdateColumnMultilingualHandler, "/api/admin/column-multilingual", map[string]any{"dataset": "wl962_title_target", "column_uid": nameUID, "is_multilingual": false})
			} else {
				for i := range columns {
					if int64(columns[i].ColumnUID) == nameUID {
						columns[i].HideEverywhere = change == "hidden"
						if change == "server_only" {
							columns[i].ClientDeliveryMode = "server_only"
						}
					}
				}
				lazy = save(UpdateCardVisibilityHandler, "/api/card-visibility/update", map[string]any{"table_name": "wl962_title_target", "columns": columns})
			}
			assertRelationResponseTitle(t, requestSource(), false) // Still uncommitted.
			if err := lazy.Commit(); err != nil {
				t.Fatal(err)
			}
			assertRelationResponseTitle(t, requestSource(), true) // Immediate safe fallback, no TTL wait.
		})
	}
}
