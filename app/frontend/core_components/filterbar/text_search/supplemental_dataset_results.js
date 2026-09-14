// supplemental_dataset_results.js
// Renders compact, localized matches from other permitted main-tab datasets.
// Reuses canonical dataset/row URLs and navigation approval before changing target query state.
// Keeps result content as text, with no editor or full article lifecycle inside a search group.

import { getTranslationForKey } from "../../lang/translation_handler.js";
import { bindDatasetLanguageRenderer, setLocalizedDatasetText } from "../../table_views/dataset_value_localizer.js";
import { buildDatasetPath } from "../../navigation/nav_engine/dataset_aliases.js";
import { buildCardUrl } from "../../table_views/card_view/row_article_opener_helpers.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";

const COPY = Object.freeze({
    fi: { heading: "Muista aineistoista", showAll: "Näytä kaikki" },
    en: { heading: "From other datasets", showAll: "Show all" },
    ch: { heading: "其他数据集的结果", showAll: "显示全部" },
    yue: { heading: "其他資料集嘅結果", showAll: "顯示全部" },
});
export function getSupplementalSearchCopy(language) {
    const locale = String(language).toLowerCase();
    const key = locale.startsWith("zh-hk") || locale.startsWith("zh-hant") ? "yue"
        : locale.startsWith("zh") ? "ch" : locale.split("-")[0];
    return COPY[key] || COPY.en;
}

function plainText(value, length) {
    const parsed = document.createElement("template");
    parsed.innerHTML = String(value ?? "");
    parsed.content.querySelectorAll("script,style").forEach(node => node.remove());
    const text = (parsed.content.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > length ? text.slice(0, length - 1).trimEnd() + "…" : text;
}

function roleColumn(columns, types, role) {
    return columns.find(column => {
        const metadata = types[column];
        if (metadata?.show_value_on_card !== true || metadata.hide_everywhere === true || metadata.hide_on_small_card === true) return false;
        const roles = String(metadata.card_element || "").split(",").map(item => item.trim());
        if (roles.includes("hidden")) return false;
        return roles.some(item => new RegExp("^" + role + "\\d*(?:\\+lang_key)?$").test(item.trim()));
    });
}

function bindQueryNavigation(link, dataset, query, rowID = null) {
    link.addEventListener("click", async event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        try {
            const { openNavTab } = await import("../../navigation/main_tabs/main_tab_printer.js");
            const result = await openNavTab(dataset, {
                forceReload: true, replacementParams: { search: query },
            });
            if (result?.abort || rowID === null || getSelectedDataset() !== dataset) return;
            const { openRowArticleView } = await import("../../table_views/card_view/row_article_opener.js");
            await openRowArticleView({ id: rowID }, dataset, null, {
                isCurrent: () => getSelectedDataset() === dataset,
            });
        } catch (error) {
            console.warn("Supplemental result navigation failed:", error);
        }
    });
}

/** One stable group per dataset; order comes solely from the accepted main-tab list. */
export function createSupplementalDatasetGroup(tab, query) {
    const element = document.createElement("section");
    element.className = "supplemental-dataset-group";
    element.dataset.dataset = tab.dataset;
    element.hidden = true;
    const heading = document.createElement("h3");
    bindDatasetLanguageRenderer(heading, () => {
        heading.textContent = plainText(getTranslationForKey(tab.langKey, {
            fallback: tab.text || tab.dataset, countUsage: false,
        }), 100);
    });
    const list = document.createElement("ul");
    const showAll = document.createElement("a");
    showAll.className = "supplemental-dataset-show-all";
    showAll.href = buildDatasetPath(tab.dataset) + "?" + new URLSearchParams({ search: query });
    bindDatasetLanguageRenderer(showAll, language => {
        showAll.textContent = getSupplementalSearchCopy(language).showAll;
    });
    bindQueryNavigation(showAll, tab.dataset, query);
    element.append(heading, list, showAll);

    return {
        element,
        render(rows, columns, types) {
            list.replaceChildren();
            const titleColumn = roleColumn(columns, types, "header");
            const descriptionColumn = roleColumn(columns, types, "description");
            for (const row of rows.slice(0, 3)) {
                const item = document.createElement("li");
                const title = document.createElement("a");
                title.href = buildCardUrl("/", tab.dataset, row.id, "") + "?" + new URLSearchParams({ search: query });
                title.dataset.rowId = String(row.id);
                setLocalizedDatasetText(title, titleColumn ? row[titleColumn] : row.id, types[titleColumn], {
                    transform: value => plainText(value, 140) || String(row.id),
                });
                bindQueryNavigation(title, tab.dataset, query, row.id);
                item.append(title);
                if (descriptionColumn) {
                    const description = document.createElement("p");
                    setLocalizedDatasetText(description, row[descriptionColumn], types[descriptionColumn], {
                        transform: value => plainText(value, 220),
                    });
                    item.append(description);
                }
                list.append(item);
            }
            element.hidden = rows.length === 0;
        },
    };
}
