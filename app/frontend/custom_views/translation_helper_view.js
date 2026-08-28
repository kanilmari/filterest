// translation_helper_view.js
// Admin view for detecting missing translations in datasets and fixing them with AI.
// Bridges the translation data API and the admin UI for translation repair workflows.
// Exists to let admins identify and repair missing translation coverage across datasets.

import { endpoint_router } from "../core_components/endpoints/endpoint_router.js";
import { fetch_columns_for_table } from "../core_components/endpoints/endpoint_column_fetcher.js";
import { fetchDatasetData } from "../core_components/endpoints/endpoint_data_fetcher.js";
import { applyPermission } from "../core_components/route_permission_checker.js";

// normalizeDatasetNameList accepts both the current array response and older/wrapped shapes.
function normalizeDatasetNameList(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.names)) return response.names;
    if (Array.isArray(response?.datasets)) return response.datasets;
    return [];
}

export async function generate_translation_helper_view(container) {
    container.replaceChildren();

    const select = document.createElement("select");
    const opt = document.createElement("option");
    opt.textContent = "Dataset";
    opt.dataset.langKey = "dataset";
    opt.value = "";
    select.appendChild(opt);

    let datasetNames = [];
    try {
        datasetNames = normalizeDatasetNameList(await endpoint_router("datasetNames"));
    } catch (e) {
        console.warn("dataset fetch error", e);
    }
    datasetNames
        .filter((datasetName) => typeof datasetName === "string" && !datasetName.startsWith("system_"))
        .forEach((datasetName) => {
            const o = document.createElement("option");
            o.value = datasetName;
            o.textContent = datasetName;
            select.appendChild(o);
        });
    container.appendChild(select);

    const resultsDiv = document.createElement("div");
    container.appendChild(resultsDiv);

    select.addEventListener("change", async () => {
        const datasetName = select.value;
        resultsDiv.replaceChildren();
        if (!datasetName) return;

        const fetchedColumns = await fetch_columns_for_table(datasetName);
        const columns = Array.isArray(fetchedColumns) ? fetchedColumns : [];
        // Exclude columns that hold filenames/images —
        // they should never be wrapped in JSON language objects.
        const NON_TRANSLATABLE_PATTERNS = /cached_image|_image$|^image$|_file$|_filename$/i;
        const textCols = columns
            .filter(
                (c) =>
                    c &&
                    (c.data_type === "text" ||
                    c.data_type === "character varying") &&
                    !NON_TRANSLATABLE_PATTERNS.test(c.column_name)
            )
            .map((c) => c.column_name);
        if (textCols.length === 0) {
            const p = document.createElement("p");
            p.textContent = "No text columns";
            p.dataset.langKey = "no_text_columns";
            resultsDiv.appendChild(p);
            return;
        }

        const data = await fetchDatasetData({ dataset_name: datasetName });
        const rows = Array.isArray(data?.data) ? data.data : [];

        const tbl = document.createElement("table");
        const thead = document.createElement("thead");
        const hRow = document.createElement("tr");

        const thFix = document.createElement("th");
        thFix.textContent = "Fix";
        thFix.dataset.langKey = "fix";
        hRow.appendChild(thFix);

        const thId = document.createElement("th");
        thId.textContent = "id";
        thId.dataset.langKey = "id";
        hRow.appendChild(thId);

        textCols.forEach((col) => {
            const th = document.createElement("th");
            th.textContent = col;
            hRow.appendChild(th);
        });
        thead.appendChild(hRow);
        tbl.appendChild(thead);

        const tbody = document.createElement("tbody");
        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const tdCb = document.createElement("td");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.dataset.rowId = row.id;
            tdCb.appendChild(cb);
            tr.appendChild(tdCb);

            const tdId = document.createElement("td");
            tdId.textContent = row.id;
            tr.appendChild(tdId);

            textCols.forEach((col) => {
                const td = document.createElement("td");
                const val = row[col];
                td.textContent = isMultilingual(val) ? "☑" : "🗷";
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        resultsDiv.appendChild(tbl);

        const btn = document.createElement("button");
        btn.textContent = "Fix selected rows";
        btn.dataset.langKey = "fix_selected_rows";
        applyPermission(btn, "/api/fix-translations");
        btn.addEventListener("click", async () => {
            const ids = Array.from(
                tbody.querySelectorAll('input[type="checkbox"]:checked')
            )
                .map((c) => parseInt(c.dataset.rowId, 10))
                .filter(Number.isFinite);
            if (ids.length === 0) return;
            try {
                await endpoint_router("fixTranslations", {
                    method: "POST",
                    body_data: {
                        table: datasetName,
                        row_ids: ids,
                        columns: textCols,
                    },
                });
                select.dispatchEvent(new Event("change"));
            } catch (err) {
                console.warn("fix failed", err);
                let msg = resultsDiv.querySelector(".translation-error");
                if (!msg) {
                    msg = document.createElement("div");
                    msg.className = "translation-error";
                    resultsDiv.appendChild(msg);
                }
                msg.textContent = "Translation failed, please try again.";
                msg.dataset.langKey = "translation_failed_try_again";
            }
        });
        resultsDiv.appendChild(btn);
    });
}

function isMultilingual(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return Boolean(value.en && value.fi);
    }
    if (typeof value !== "string") return false;
    try {
        const obj = JSON.parse(value);
        return !!obj.en && !!obj.fi;
    } catch (_e) {
        return false;
    }
}
