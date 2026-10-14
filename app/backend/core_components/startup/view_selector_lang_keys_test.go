// view_selector_lang_keys_test.go
// Verifies startup-owned view-selector lang keys overwrite legacy wording.
// Bridges EnsureViewSelectorLangKeys and the startup SQL mock driver used in this package.
// Exists to keep product-owned selector wording consistent across installations.
package startup

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"reflect"
	"strings"
	"testing"
)

func TestEnsureViewSelectorLangKeysOverwritesLegacyLabels(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()
	// Extend this package's SQL mock with argument capture; no PostgreSQL or
	// installation data is needed to prove the unconditional overwrite query.
	connection := &viewSelectorLangKeyTestConn{}
	seedDB := sql.OpenDB(viewSelectorLangKeyTestConnector{connection})
	defer seedDB.Close()
	wantSeeds := map[string][]driver.Value{
		"view_card":             {"Kortit", "Cards", "卡片"},
		"view_article":          {"Artikkeli", "Article", "文章"},
		"view_table":            {"Taulu", "Table", "表格"},
		"view_normal":           {"Lista", "List", "列表"},
		"view_transposed":       {"Vertailu", "Compare", "对比"},
		"add_more_views":        {"Lisää", "More", "更多"},
		"view_ticket":           {"Tiketti", "Ticket", "工单"},
		"view_product_card":     {"Tuotekortti", "Product card", "产品卡片"},
		"view_calendar":         {"Kalenteri", "Calendar", "日历"},
		"view_map":              {"Kartta", "Map", "地图"},
		"view_settings":         {"Asetusnäkymä", "Settings", "设置视图"},
		"view_cloud_management": {"Pilvihallinta", "Cloud management", "云管理"},
		"view_tree":             {"Puunäkymä", "Tree", "树视图"},
	}

	for range viewSelectorLangKeySeeds {
		pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	}

	EnsureViewSelectorLangKeys(seedDB)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != len(viewSelectorLangKeySeeds) {
		t.Fatalf("expected %d view-selector lang-key calls, got %d (%v)", len(viewSelectorLangKeySeeds), len(calls), calls)
	}
	for _, call := range calls {
		if !strings.Contains(call, "INSERT INTO system_lang_keys") {
			t.Fatalf("expected system_lang_keys upsert, got %q", call)
		}
		if !strings.Contains(call, "ON CONFLICT (lang_key) DO UPDATE") {
			t.Fatalf("expected lang_key overwrite on conflict, got %q", call)
		}
		for _, language := range []string{"fi", "en", "ch"} {
			if !strings.Contains(call, language+" = EXCLUDED."+language) {
				t.Fatalf("expected replacement of old %s text (including View ...), got %q", language, call)
			}
		}
		if strings.Contains(strings.ToUpper(call), "CASE") || strings.Contains(strings.ToUpper(call), "WHERE") {
			t.Fatalf("expected unconditional overwrite of nonempty old View ... labels: %q", call)
		}
	}
	for _, args := range connection.arguments {
		if len(args) != 4 {
			t.Fatalf("expected key and three languages, got %v", args)
		}
		key := args[0].Value.(string)
		want, allowed := wantSeeds[key]
		got := []driver.Value{args[1].Value, args[2].Value, args[3].Value}
		if !allowed || !reflect.DeepEqual(got, want) {
			t.Fatalf("unexpected product-owned seed %q: got %v, want %v", key, got, want)
		}
		delete(wantSeeds, key)
	}
	if len(wantSeeds) != 0 {
		t.Fatalf("missing product-owned seeds: %v", wantSeeds)
	}
}

type viewSelectorLangKeyTestConn struct {
	appDBCompatibilityConn
	arguments [][]driver.NamedValue
}

func (connection *viewSelectorLangKeyTestConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	connection.arguments = append(connection.arguments, append([]driver.NamedValue(nil), args...))
	return connection.appDBCompatibilityConn.ExecContext(ctx, query, args)
}

type viewSelectorLangKeyTestConnector struct {
	connection *viewSelectorLangKeyTestConn
}

func (connector viewSelectorLangKeyTestConnector) Connect(context.Context) (driver.Conn, error) {
	return connector.connection, nil
}

func (viewSelectorLangKeyTestConnector) Driver() driver.Driver {
	return &appDBCompatibilityDriver{}
}
