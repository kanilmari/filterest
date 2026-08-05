// dataset_view_registry.js
// Defines canonical metadata for dataset views and selector aliases.
// Bridges dataset rendering, view-selector buttons, permission routes, and translation fallbacks.
// Exists to remove duplicated view keys, labels, container IDs, and UI permission routes.
// Keep this file renderer-free so selectors can read metadata without loading view modules.

export const DATASET_VIEW_SELECTOR_GROUP_DIRECT = "direct";
export const DATASET_VIEW_SELECTOR_GROUP_MORE = "more";
export const CARD_VIEW_KEY = "card";
export const ARTICLE_VIEW_KEY = "article";

export const DATASET_VIEW_SELECTOR_TEXT = Object.freeze({
    heading: Object.freeze({
        langKey: "views_and_presentations",
        labelFallback: "N\u00e4kym\u00e4t ja esitystavat",
        translations: Object.freeze({
            fi: "N\u00e4kym\u00e4t ja esitystavat",
            en: "Views and presentations",
            ch: "\u89c6\u56fe\u4e0e\u5c55\u793a\u65b9\u5f0f",
        }),
    }),
    moreViews: Object.freeze({
        langKey: "add_more_views",
        labelFallback: "Lis\u00e4\u00e4",
        placeholderFallback: "Lis\u00e4\u00e4 n\u00e4kymi\u00e4",
        translations: Object.freeze({
            fi: "Lis\u00e4\u00e4",
            en: "More",
            ch: "\u66f4\u591a",
        }),
    }),
});

const DATASET_VIEW_DEFINITION_LIST = [
    {
        viewKey: CARD_VIEW_KEY,
        rendererKey: CARD_VIEW_KEY,
        containerSuffix: "card_view_container",
        langKey: "view_card",
        labelFallback: "Kortti",
        translations: {
            fi: "Kortit",
            en: "Cards",
            ch: "\u5361\u7247",
        },
        permissionRoute: "/ui/view/card",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_DIRECT,
    },
    {
        viewKey: ARTICLE_VIEW_KEY,
        targetViewKey: CARD_VIEW_KEY,
        langKey: "view_article",
        labelFallback: "Artikkeli",
        translations: {
            fi: "Artikkeli",
            en: "Article",
            ch: "\u6587\u7ae0",
        },
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_DIRECT,
    },
    {
        viewKey: "table",
        rendererKey: "table",
        containerSuffix: "table_view_container",
        langKey: "view_table",
        labelFallback: "Taulu",
        translations: {
            fi: "Taulu",
            en: "Table",
            ch: "\u8868\u683c",
        },
        permissionRoute: "/ui/view/table",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_DIRECT,
        usesFullWidthContent: true,
    },
    {
        viewKey: "normal",
        rendererKey: "normal",
        containerSuffix: "normal_view_container",
        langKey: "view_normal",
        labelFallback: "Lista",
        translations: {
            fi: "Lista",
            en: "List",
            ch: "\u5217\u8868",
        },
        permissionRoute: "/ui/view/list",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_DIRECT,
        usesFullWidthContent: true,
    },
    {
        viewKey: "transposed",
        rendererKey: "transposed",
        containerSuffix: "transposed_view_container",
        langKey: "view_transposed",
        labelFallback: "Vertailu",
        translations: {
            fi: "Vertailu",
            en: "Compare",
            ch: "\u5bf9\u6bd4",
        },
        permissionRoute: "/ui/view/transposed",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_DIRECT,
        scrollDirection: "horizontal",
        usesFullWidthContent: true,
    },
    {
        viewKey: "tree",
        rendererKey: "tree",
        containerSuffix: "tree_view_container",
        langKey: "view_tree",
        labelFallback: "Puun\u00e4kym\u00e4",
        translations: {
            fi: "Puun\u00e4kym\u00e4",
            en: "Tree",
            ch: "\u6811\u89c6\u56fe",
        },
        permissionRoute: "/ui/view/tree",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
        contentPadding: "6px",
    },
    {
        viewKey: "ticket",
        rendererKey: "ticket",
        containerSuffix: "ticket_view_container",
        langKey: "view_ticket",
        labelFallback: "Tiketti",
        translations: {
            fi: "Tiketti",
            en: "Ticket",
            ch: "\u5de5\u5355",
        },
        permissionRoute: "/ui/view/ticket",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
    },
    {
        viewKey: "product_card",
        rendererKey: "product_card",
        containerSuffix: "product_card_view_container",
        langKey: "view_product_card",
        labelFallback: "Tuotekortti",
        translations: {
            fi: "Tuotekortti",
            en: "Product card",
            ch: "\u4ea7\u54c1\u5361\u7247",
        },
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
    },
    {
        viewKey: "calendar",
        rendererKey: "calendar",
        containerSuffix: "calendar_view_container",
        langKey: "view_calendar",
        labelFallback: "Kalenteri",
        translations: {
            fi: "Kalenteri",
            en: "Calendar",
            ch: "\u65e5\u5386",
        },
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
    },
    {
        viewKey: "map",
        rendererKey: "map",
        containerSuffix: "map_view_container",
        langKey: "view_map",
        labelFallback: "Kartta",
        translations: {
            fi: "Kartta",
            en: "Map",
            ch: "\u5730\u56fe",
        },
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
    },
    {
        viewKey: "price_chart",
        rendererKey: "price_chart",
        containerSuffix: "price_chart_view_container",
        langKey: "view_price_chart",
        labelFallback: "Hintagraafi",
        translations: {
            fi: "Hintagraafi",
            en: "Price chart",
            ch: "\u4ef7\u683c\u56fe\u8868",
        },
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
        translateDropdownLabel: true,
    },
    {
        viewKey: "settings",
        rendererKey: "settings",
        containerSuffix: "settings_view_container",
        langKey: "view_settings",
        labelFallback: "Asetusn\u00e4kym\u00e4",
        translations: {
            fi: "Asetusn\u00e4kym\u00e4",
            en: "Settings",
            ch: "\u8bbe\u7f6e\u89c6\u56fe",
        },
        permissionRoute: "/ui/view/settings",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
    },
    {
        viewKey: "cloud_management",
        rendererKey: "cloud_management",
        containerSuffix: "cloud_management_view_container",
        langKey: "view_cloud_management",
        labelFallback: "Pilvihallinta",
        translations: {
            fi: "Pilvihallinta",
            en: "Cloud management",
            ch: "\u4e91\u7ba1\u7406",
        },
        permissionRoute: "/ui/view/cloud_management",
        selectorGroup: DATASET_VIEW_SELECTOR_GROUP_MORE,
        usesFullWidthContent: true,
    },
];

function freezeDatasetViewDefinition(definition) {
    return Object.freeze({
        scrollDirection: "vertical",
        usesFullWidthContent: false,
        translateDropdownLabel: false,
        ...definition,
        translations: definition.translations
            ? Object.freeze({ ...definition.translations })
            : undefined,
    });
}

export const DATASET_VIEW_DEFINITIONS = Object.freeze(
    DATASET_VIEW_DEFINITION_LIST.map(freezeDatasetViewDefinition)
);

export const DATASET_VIEW_REGISTRY = Object.freeze(
    Object.fromEntries(DATASET_VIEW_DEFINITIONS.map((definition) => [
        definition.viewKey,
        definition,
    ]))
);

export const RENDERABLE_DATASET_VIEW_DEFINITIONS = Object.freeze(
    DATASET_VIEW_DEFINITIONS.filter((definition) => definition.rendererKey)
);

export const DATASET_VIEW_PERMISSION_ROUTES = Object.freeze(
    Object.fromEntries(
        DATASET_VIEW_DEFINITIONS
            .filter((definition) => definition.permissionRoute)
            .map((definition) => [
                definition.viewKey,
                definition.permissionRoute,
            ])
    )
);

/**
 * Returns the registered metadata for one dataset view key.
 * Operates between raw localStorage/UI view keys and the canonical registry.
 * Exists so callers do not duplicate object lookups or fallback behavior.
 */
export function getDatasetViewDefinition(viewKey) {
    return DATASET_VIEW_REGISTRY[viewKey] || null;
}

/**
 * Returns the concrete renderer view key for a selector option.
 * Operates between alias-like UI entries and renderable view definitions.
 * Exists to preserve the article button as a UI alias for card view.
 */
export function resolveDatasetViewSelectionTarget(viewKey) {
    const definition = getDatasetViewDefinition(viewKey);
    return definition?.targetViewKey || viewKey;
}

/**
 * Tells whether a view key is selector-only rather than directly renderable.
 * Operates between view-selector permission logic and registry metadata.
 * Exists so aliases such as article can intentionally avoid new route checks.
 */
export function isDatasetViewSelectorAlias(viewKey) {
    const definition = getDatasetViewDefinition(viewKey);
    return Boolean(definition?.targetViewKey);
}

/**
 * Tells whether a view key has a registered renderer.
 * Operates between persisted view state and dataset rendering.
 * Exists to validate fallback candidates without duplicating renderer maps.
 */
export function isRenderableDatasetView(viewKey) {
    return Boolean(getDatasetViewDefinition(viewKey)?.rendererKey);
}

/**
 * Builds the DOM container ID for one renderable dataset view.
 * Operates between dataset names and registry-defined container suffixes.
 * Exists so renderer and tests share the same container naming rule.
 */
export function getDatasetViewContainerId(viewKey, datasetName) {
    const definition = getDatasetViewDefinition(viewKey);
    if (!definition?.containerSuffix) return "";
    return `${datasetName}_${definition.containerSuffix}`;
}

/**
 * Returns the UI permission route for a view key, when one exists.
 * Operates between view selectors and the route-permission checker.
 * Exists so permission routing stays aligned with view registration.
 */
export function getDatasetViewPermissionRoute(viewKey) {
    return getDatasetViewDefinition(viewKey)?.permissionRoute || "";
}

/**
 * Returns selector options for a direct button group or the more-views dropdown.
 * Operates between registry metadata and admin/filterbar selector builders.
 * Exists to keep selector ordering and labels in one canonical place.
 */
export function getDatasetViewSelectorOptions(selectorGroup) {
    return DATASET_VIEW_DEFINITIONS
        .filter((definition) => definition.selectorGroup === selectorGroup)
        .map((definition) => ({
            viewKey: definition.viewKey,
            label: definition.labelFallback,
            langKey: definition.langKey,
            translateDropdownLabel: Boolean(definition.translateDropdownLabel),
        }));
}

/**
 * Returns the language key for a registered view.
 * Operates between selector DOM nodes and registry metadata.
 * Exists so callers do not recreate the view_<key> convention by hand.
 */
export function getDatasetViewLangKey(viewKey) {
    return getDatasetViewDefinition(viewKey)?.langKey || `view_${viewKey}`;
}

/**
 * Returns a readable fallback label for a registered view.
 * Operates between untranslated UI controls and registry metadata.
 * Exists so admin buttons and dropdowns share the same fallback text.
 */
export function getDatasetViewLabelFallback(viewKey) {
    return getDatasetViewDefinition(viewKey)?.labelFallback || String(viewKey || "");
}

/**
 * Returns whether a view should use the full-width content layout.
 * Operates between active view state and the dataset page wrapper.
 * Exists to remove hardcoded width decisions from the selector printer.
 */
export function usesFullWidthDatasetContent(viewKey) {
    return Boolean(getDatasetViewDefinition(viewKey)?.usesFullWidthContent);
}

/**
 * Returns the infinite-scroll direction for a renderable view.
 * Operates between the active view state and the infinite-scroll handler.
 * Exists so transposed-view direction stays registered with the view metadata.
 */
export function getDatasetViewScrollDirection(viewKey) {
    return getDatasetViewDefinition(viewKey)?.scrollDirection || "vertical";
}

/**
 * Returns local translation fallbacks for dataset view labels.
 * Operates between the view registry and the translation handler.
 * Exists so bootstrapping can translate selector labels before DB rows exist.
 */
export function getDatasetViewLocalTranslationFallbacks() {
    const fallbackEntries = DATASET_VIEW_DEFINITIONS
        .filter((definition) => definition.langKey && definition.translations)
        .map((definition) => [
            definition.langKey,
            definition.translations,
        ]);

    for (const selectorText of Object.values(DATASET_VIEW_SELECTOR_TEXT)) {
        fallbackEntries.push([
            selectorText.langKey,
            selectorText.translations,
        ]);
    }

    return Object.fromEntries(fallbackEntries);
}
