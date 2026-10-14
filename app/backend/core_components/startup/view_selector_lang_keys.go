// view_selector_lang_keys.go
// Seeds canonical language keys for generic dataset view-selector controls.
// Bridges startup maintenance and system_lang_keys values used by filterbar view controls.
// Exists so old DB rows with "view/nakyma" wording are normalized through app logic.
package startup

import (
	"database/sql"
	"log"
)

var viewSelectorLangKeySeeds = []startupLangKeySeed{
	{
		langKey: "view_card",
		fi:      "Kortit",
		en:      "Cards",
		ch:      "卡片",
	},
	{
		langKey: "view_article",
		fi:      "Artikkeli",
		en:      "Article",
		ch:      "文章",
	},
	{
		langKey: "view_table",
		fi:      "Taulu",
		en:      "Table",
		ch:      "表格",
	},
	{
		langKey: "view_normal",
		fi:      "Lista",
		en:      "List",
		ch:      "列表",
	},
	{
		langKey: "view_transposed",
		fi:      "Vertailu",
		en:      "Compare",
		ch:      "对比",
	},
	{
		langKey: "add_more_views",
		fi:      "Lisää",
		en:      "More",
		ch:      "更多",
	},
	{
		langKey: "view_ticket",
		fi:      "Tiketti",
		en:      "Ticket",
		ch:      "工单",
	},
	{
		langKey: "view_product_card",
		fi:      "Tuotekortti",
		en:      "Product card",
		ch:      "产品卡片",
	},
	{
		langKey: "view_calendar",
		fi:      "Kalenteri",
		en:      "Calendar",
		ch:      "日历",
	},
	{
		langKey: "view_map",
		fi:      "Kartta",
		en:      "Map",
		ch:      "地图",
	},
	{
		langKey: "view_settings",
		fi:      "Asetusnäkymä",
		en:      "Settings",
		ch:      "设置视图",
	},
	{
		langKey: "view_cloud_management",
		fi:      "Pilvihallinta",
		en:      "Cloud management",
		ch:      "云管理",
	},
	{
		langKey: "view_tree",
		fi:      "Puunäkymä",
		en:      "Tree",
		ch:      "树视图",
	},
}

// EnsureViewSelectorLangKeys normalizes generic view-selector labels.
// Unlike missing-value startup seeds, these labels are product-owned wording and
// intentionally overwrite older DB values such as "Korttinakyma" or "View card".
func EnsureViewSelectorLangKeys(db *sql.DB) {
	const upsertQuery = `
		INSERT INTO system_lang_keys (lang_key, fi, en, ch)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (lang_key) DO UPDATE
			SET fi = EXCLUDED.fi,
			    en = EXCLUDED.en,
			    ch = EXCLUDED.ch
	`

	for _, seed := range viewSelectorLangKeySeeds {
		_, err := db.Exec(upsertQuery, seed.langKey, seed.fi, seed.en, seed.ch)
		if err != nil {
			log.Printf("[STARTUP] Error upserting view selector lang key %q: %v", seed.langKey, err)
		}
	}
}
