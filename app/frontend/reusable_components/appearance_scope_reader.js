// appearance_scope_reader.js
// Reads presentation projections from the nearest owning surface.
// Connects portable field/media adapters with caller-provided dataset scopes.
// Keeps nested datasets independent and unscoped legacy renderers compatible.

export const APPEARANCE_SCOPE_SELECTOR = '[data-dataset-appearance-scope]';
let publicAttributes = {};

/** Public defaults are transient projections, never dataset snapshots. */
export function setPublicAppearanceAttributes(attributes) {
    publicAttributes = { ...attributes };
}

export function readAppearanceAttribute(element, attribute) {
    const scope = element?.closest?.(APPEARANCE_SCOPE_SELECTOR);
    return scope ? scope._datasetAppearanceAttributes?.[attribute] ?? scope.dataset[attribute]
        : document.documentElement.dataset[attribute] ?? publicAttributes[attribute];
}

/** Excludes descendants whose nearest scope belongs to another surface. */
export function appearanceScopeElements(scope, selector) {
    return [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)]
        .filter(element => scope === document.documentElement
            ? !element.closest(APPEARANCE_SCOPE_SELECTOR)
            : element.closest(APPEARANCE_SCOPE_SELECTOR) === scope);
}
