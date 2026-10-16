// dataset_default_view_test.go
// Checks the default-view request boundary and presentation shape rules.
// Connects untrusted JSON and registered view semantics to pure validation.
// Protects explicit clears, Chart's scalar axes and specialized-tool exclusions.
package system_table_tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultViewPermissionFallback(t *testing.T) {
	for _, item := range []struct {
		saved, site  string
		chartAllowed bool
		want         string
	}{
		{"", "table", false, "table"}, {"calendar", "table", false, "calendar"},
		{"", "price_chart", false, "card"}, {"price_chart", "table", false, "table"},
		{"price_chart", "table", true, "price_chart"}, {"unknown", "calendar", false, "calendar"},
		{"article", "card", false, "article_view"}, {"", "image_first_view", true, "card"},
	} {
		var saved *string
		if item.saved != "" {
			saved = &item.saved
		}
		if got := defaultViewPermissionFallback(saved, item.site, item.chartAllowed); got != item.want {
			t.Fatal(item, got)
		}
	}
}

func TestReadSiteDefaultView(t *testing.T) {
	root := t.TempDir()
	if got := readSiteDefaultView(root); got != "card" {
		t.Fatal(got)
	}
	if err := os.Mkdir(filepath.Join(root, "frontend"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ raw, want string }{{`{"default_view":"table"}`, "table"}, {`{"default_view":false}`, "card"}, {`invalid`, "card"}} {
		if err := os.WriteFile(filepath.Join(root, "frontend", "config.json"), []byte(item.raw), 0600); err != nil {
			t.Fatal(err)
		}
		if got := readSiteDefaultView(root); got != item.want {
			t.Fatal(got, item.want)
		}
	}
}

func TestDecodeDefaultViewRequest(t *testing.T) {
	for _, input := range []string{`{}`, `{"dataset":"x"}`, `{"dataset":"x","view_key":""}`, `{"dataset":"x","view_key":3}`, `{"dataset":"x","view_key":null,"name":"y"}`, `{"dataset":"x","view_key":null} {}`} {
		if _, _, err := decodeDefaultViewRequest(strings.NewReader(input)); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	for _, value := range []string{`null`, `"calendar"`} {
		dataset, view, err := decodeDefaultViewRequest(strings.NewReader(`{"dataset":"x","view_key":` + value + `}`))
		if err != nil || dataset != "x" || (view == nil) != (value == `null`) {
			t.Fatal(dataset, view, err)
		}
	}
}

func TestDefaultViewDatasetShape(t *testing.T) {
	flat := defaultViewDatasetShape{dataset: "app_notes", columns: map[string]string{"id": "integer", "title": "text"}}
	for _, view := range []string{"card", "article_view", "table", "normal", "transposed", "ticket", "product_card", "calendar"} {
		if !flat.offers(view) {
			t.Fatal("generic view excluded", view)
		}
	}
	for _, view := range []string{"tree", "map", "price_chart", "settings", "cloud_management", "image_first_view", "unknown"} {
		if flat.offers(view) {
			t.Fatal("specialized view offered", view)
		}
	}
	for _, dataType := range []string{"date", "timestamp with time zone", "time without time zone"} {
		flat.columns["when"] = dataType
		if !flat.offers("price_chart") {
			t.Fatal("Chart scalar axes rejected", dataType)
		}
	}
	flat.columns["when"] = "text"
	if flat.offers("price_chart") {
		t.Fatal("Chart accepted a text date")
	}
	flat.tree = true
	if !flat.offers("tree") {
		t.Fatal("self-reference rejected")
	}
	for _, unsupported := range []string{"geometry", "postgis.geometry(polygon,4326)", "postgis.geometry(point,3857)"} {
		flat.columns["position"] = unsupported
		if flat.offers("map") {
			t.Fatal("unsupported point contract offered", unsupported)
		}
	}
	flat.columns["position"] = "postgis.geometry(point,4326)"
	if !flat.offers("map") {
		t.Fatal("point geometry rejected")
	}
	delete(flat.columns, "position")
	flat.columns["lat"] = "numeric"
	flat.columns["lng"] = "numeric"
	if !flat.offers("map") {
		t.Fatal("coordinate pair rejected")
	}
	flat.columns["key"] = "text"
	flat.columns["value_type"] = "integer"
	flat.columns["text_value"] = "text"
	if !flat.offers("settings") {
		t.Fatal("settings shape rejected")
	}
}
