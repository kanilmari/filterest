// filterbar_meta_fetcher.js
// Fetches table metadata such as row counts and PostGIS status for the filterbar.
// Bridges filterbar setup code with backend metadata reads used to tailor available filter UI.
// Exists to keep filterbar metadata loading separate from rendering and visibility orchestration.

import { endpoint_router } from "../../endpoints/endpoint_router.js";

/**
 * Hakee taulun metatiedot: rivimäärän + PostGIS-statuksen
 * Palauttaa:
 *   {
 *     rowCount:    number|null,
 *     hasGeo:      boolean,            // onko suoria tai FK-geom-viitteitä
 *     geomColumns: string[],           // tämän taulun geometry-sarakkeet
 *     geomSources: string[],           // viittauksen päässä olevat taulut, joissa geometry
 *   }
 */
export async function fetchTableMeta(tableName) {
    // 🔢 funktiolaskuri (ohjeidesi mukaisesti)

    try {
        const {
            row_count: rowCount,
            has_geo: hasGeo = false,
            geom_columns: geomColumns = [],
            geom_sources: geomSources = [],
        } = await endpoint_router("getRowCount", {
            url_params: `?dataset=${encodeURIComponent(tableName)}`,
        });

        return {
            rowCount: typeof rowCount === "number" ? rowCount : null,
            hasGeo: Boolean(hasGeo),
            geomColumns,
            geomSources,
        };
    } catch (err) {
        console.warn("virhe fetchTableMeta-funktiossa:", err);
        return {
            rowCount: null,
            hasGeo: false,
            geomColumns: [],
            geomSources: [],
        };
    }
}
