// relation_detail_helpers.js
// Expands foreign-key detail rows into reusable id + display-name navigation entries.
// Bridges FK metadata, generated alias columns, and deep-link URL helpers for card-like surfaces.
// Exists so small cards and big cards can expose relation ids and names without dataset-specific hardcoding.

import { buildCardUrl, buildSlug } from "./row_article_opener_helpers.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import {
    buildGeneratedForeignDisplayAliasBase,
    getGeneratedForeignDisplayColumn,
} from "./card_field_formatter_helpers.js";
import { ROW_ARTICLE_RELATION_DETAILS_MODES } from "../../../ui_config.js";

const DEFAULT_DATASET_PREFIX = "/";

function formatColumnLabel(columnName) {
    const replaced = String(columnName || "").replace(/_/g, " ").trim();
    if (!replaced) {
        return "";
    }
    return replaced.charAt(0).toUpperCase() + replaced.slice(1);
}

function coerceTrimmedText(value) {
    return String(value ?? "").trim();
}

/**
 * Expand one detail entry so FK-backed rows can expose both the raw id and the
 * generated human-readable display name as navigable rows.
 *
 * @param {object} detailEntry
 * @param {Object<string, *>} rowItem
 * @param {Object<string, object>} dataTypes
 * @param {string} datasetPrefix
 * @returns {object[]}
 */
export function expandForeignKeyDetailEntry(
    detailEntry,
    rowItem,
    dataTypes = {},
    datasetPrefix = DEFAULT_DATASET_PREFIX
) {
    if (!detailEntry || detailEntry.isLink === true) {
        return detailEntry ? [detailEntry] : [];
    }

    const columnMeta = dataTypes[detailEntry.column] || {};
    const foreignTable = String(columnMeta.foreign_table || "").trim();
    if (!foreignTable) {
        return [detailEntry];
    }

    const targetId = coerceTrimmedText(rowItem?.[detailEntry.column]);
    if (!targetId) {
        return [detailEntry];
    }

    const aliasColumn = getGeneratedForeignDisplayColumn(rowItem, detailEntry.column, dataTypes);
    const aliasValue = extractLangValue(
        aliasColumn ? rowItem?.[aliasColumn] : "",
        getLanguageWithBrowserFallback()
    ).trim();
    const aliasBase = buildGeneratedForeignDisplayAliasBase(detailEntry.column);
    const href = buildCardUrl(datasetPrefix, foreignTable, targetId, buildSlug(aliasValue));

    const expandedEntries = [
        {
            ...detailEntry,
            rawValue: targetId,
            storedRawValue: targetId,
            isLink: true,
            href,
            openInNewTabHref: href,
            labelKey: detailEntry.column,
            dataColumn: detailEntry.column,
        },
    ];

    if (aliasValue) {
        expandedEntries.push({
            ...detailEntry,
            column: aliasBase,
            label: formatColumnLabel(aliasBase),
            labelKey: aliasBase,
            rawValue: aliasValue,
            storedRawValue: aliasValue,
            isLink: true,
            href,
            openInNewTabHref: href,
            dataColumn: null,
            isDerived: true,
            sourceColumn: detailEntry.column,
        });
    }

    return expandedEntries;
}

/**
 * Expand an array of detail entries so FK-backed rows can contribute multiple
 * navigable entries while non-FK rows pass through unchanged.
 *
 * @param {object[]} detailEntries
 * @param {Object<string, *>} rowItem
 * @param {Object<string, object>} dataTypes
 * @param {string} datasetPrefix
 * @returns {object[]}
 */
export function expandForeignKeyDetailEntries(
    detailEntries,
    rowItem,
    dataTypes = {},
    datasetPrefix = DEFAULT_DATASET_PREFIX
) {
    const entries = Array.isArray(detailEntries) ? detailEntries : [];
    return entries.flatMap((entry) =>
        expandForeignKeyDetailEntry(entry, rowItem, dataTypes, datasetPrefix)
    );
}

/**
 * Resolves article-view details so FK-backed values follow the configured
 * hide/name/id presentation without changing the small-card expansion contract.
 * Non-relation details retain their original order and relation rows are appended.
 */
export function resolveRowArticleRelationDetailEntries(
    detailEntries,
    rowItem,
    dataTypes = {},
    mode = ROW_ARTICLE_RELATION_DETAILS_MODES.HIDE,
    datasetPrefix = DEFAULT_DATASET_PREFIX
) {
    const ordinaryEntries = [];
    const relationEntries = [];

    for (const entry of Array.isArray(detailEntries) ? detailEntries : []) {
        const columnMeta = dataTypes[entry?.column] || {};
        if (!String(columnMeta.foreign_table || "").trim()) {
            ordinaryEntries.push(entry);
            continue;
        }

        if (mode === ROW_ARTICLE_RELATION_DETAILS_MODES.HIDE) {
            continue;
        }

        const expandedEntries = expandForeignKeyDetailEntry(
            { ...entry, isLink: false },
            rowItem,
            dataTypes,
            datasetPrefix
        );
        if (mode === ROW_ARTICLE_RELATION_DETAILS_MODES.NAMES_AT_END) {
            relationEntries.push(...expandedEntries.filter((candidate) => candidate.isDerived));
            continue;
        }
        if (mode === ROW_ARTICLE_RELATION_DETAILS_MODES.IDS_AND_NAMES_AT_END) {
            relationEntries.push(...expandedEntries);
        }
    }

    return [...ordinaryEntries, ...relationEntries];
}
