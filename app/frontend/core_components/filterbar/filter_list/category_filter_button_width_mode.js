// category_filter_button_width_mode.js
// Applies the site-wide category button width choice to the document.
// Connects the auth bootstrap answer and a guarded refresh hint to category CSS.
// Keeps missing, invalid and unavailable settings on the fill-row default.
const KEY = 'category_filter_button_width_mode';
const DEFAULT = 'fill_row_with_centered_label';

export function normalizeCategoryFilterButtonWidthMode(value) {
    return value === 'fit_to_label' ? value : DEFAULT;
}

export function setCategoryFilterButtonWidthMode(value) {
    const mode = normalizeCategoryFilterButtonWidthMode(value);
    document.documentElement.dataset.categoryFilterButtonWidthMode = mode;
    try { localStorage.setItem(KEY, mode); } catch { /* Storage is only a refresh hint. */ }
    return mode;
}

let hint;
try { hint = localStorage.getItem(KEY); } catch { /* The base layout supplies the default. */ }
setCategoryFilterButtonWidthMode(hint);
