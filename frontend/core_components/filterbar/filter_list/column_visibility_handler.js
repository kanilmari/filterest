// column_visibility_handler.js
// Manages per-table column visibility via localStorage and CSS hide rules.
// Between column visibility helpers, the filter bar, and dataset rendering.
// Exists to toggle column display without re-fetching data.
import {
    makeColumnClass as _makeColumnClass,
    buildCssHideRules,
    parseHiddenColumns,
    isColumnVisible,
} from './column_visibility_handler_helpers.js';

// Re-export pure helpers so existing importers keep working
export { _makeColumnClass as makeColumnClass };

// ---------- 1) localStorage-aput ----------------------------------------------
export function getHiddenColumns(tableName) {
    const raw = localStorage.getItem(`${tableName}_hide_columns`);
    return parseHiddenColumns(raw);
}

export function setColumnVisibility(tableName, columnName, shouldShow) {
    const cur = getHiddenColumns(tableName);
    if (shouldShow) delete cur[columnName];
    else cur[columnName] = true;
    localStorage.setItem(`${tableName}_hide_columns`, JSON.stringify(cur));

    // 🔔 lähetä ilmoitus kaikille kiinnostuneille:
    window.dispatchEvent(
        new CustomEvent("column_visibility_changed", { detail: { tableName } })
    );

    // Päivitä näkymä heti myös tässä kontekstissa
    applyColumnVisibility(tableName);
}

/* ---------- 2) CSP-nonce-apu ------------------------------------------------- */
function getCspNonce() {

    /* 1) Yritä lukea nykyisen <script>-tägisi nonce --------------- */
    const fromCurrentScript =
        document.currentScript?.nonce ||
        document.currentScript?.getAttribute("nonce");

    if (fromCurrentScript) return fromCurrentScript;

    /* 2) Seuraavaksi etsitään ensimmäinen <script nonce="…"> ----- */
    const fromAnyScript =
        document.querySelector("script[nonce]")?.getAttribute("nonce");

    if (fromAnyScript) return fromAnyScript;

    /* 3) Viimeinen ja luotettavin – <meta name="csp-nonce"> -------- */
    const fromMeta =
        document.querySelector('meta[name="csp-nonce"]')?.getAttribute("content");

    if (fromMeta) return fromMeta;

    /* 4) Jos noncea ei löytynyt, palautetaan tyhjä merkkijono ------ */
    return "";
}

/* ---------- 3) Luo / hae <style> ja lisää nonce, jos sellainen löytyi -------- */
function ensureHiddenStylesElement(tableName) {
    const styleId = `${tableName}_hidden_columns_styles`;
    let styleEl   = document.getElementById(styleId);

    if (!styleEl) {
        styleEl    = document.createElement("style");
        styleEl.id = styleId;

        const nonce = getCspNonce();
        if (nonce) styleEl.setAttribute("nonce", nonce);

        document.head.appendChild(styleEl);
    }
    return styleEl;
}

/* ---------- 4) NÄKYMÄN PÄIVITYS --------------------------------------------- */
export function applyColumnVisibility(tableName) {

    const hiddenMap      = getHiddenColumns(tableName);
    const cleanTableName = String(tableName ?? "").replace(/\s+/g, "");

    /* 0) Siivoa vanhat 'hidden-column'-luokat (legacy-tuki) ------------------ */
    document
        .querySelectorAll(".hidden-column")
        .forEach((el) => el.classList.remove("hidden-column"));

    /* 1) Generoi CSS-säännöt kaikille piilotettaville sarakkeille ------------- */
    const cssRules = buildCssHideRules(hiddenMap, tableName);

    /* 2) Päivitä <style>-elementin sisältö ----------------------------------- */
    const styleEl = ensureHiddenStylesElement(cleanTableName);
    styleEl.textContent = cssRules;
}

export function shouldShowColumn(tableName, columnName) {
    const hidden = getHiddenColumns(tableName);
    return isColumnVisible(hidden, columnName);
}

// ---------- 5) UI-rakentaja ---------------------------------------------------
export function buildColumnSelector(tableName, allColumns) {

    const wrapper = document.createElement("div");
    wrapper.classList.add("column-selector-wrapper");

    const label = document.createElement("label");
    label.textContent = "Sarakkeet:";
    label.style.fontWeight = "bold";
    wrapper.appendChild(label);

    const select = document.createElement("select");
    select.multiple = true;
    select.size = Math.min(8, allColumns.length);
    select.id = `${tableName}_column_selector`;
    select.classList.add("column-selector");
    wrapper.appendChild(select);

    const hiddenMap = getHiddenColumns(tableName);

    allColumns.forEach((col) => {
        const opt = document.createElement("option");
        opt.value = col;
        opt.textContent = col;
        opt.selected = !hiddenMap[col]; // selected ⇢ näkyy
        select.appendChild(opt);
    });

    // Päivitä valinnan muuttuessa
    select.addEventListener("change", () => {
        // Kaikki optionit jotka eivät ole selected → piiloon
        for (const optionEl of select.options) {
            setColumnVisibility(tableName, optionEl.value, optionEl.selected);
        }
        // (applyColumnVisibility kutsutaan jo setColumnVisibilityssä)
    });

    return wrapper;
}
