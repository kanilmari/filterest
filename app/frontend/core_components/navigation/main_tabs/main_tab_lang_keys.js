// main_tab_lang_keys.js
// Owns the language key one main navigation tab prints as its own label.
// Between the tab bar that shows the label and every other surface that has to say the
// same words about the same tab, above all the browser tab title.
// Exists because a tab's label key is not always its dataset or view name, and one place
// has to decide which key that is instead of each surface guessing again.

/**
 * The tab identities whose visible label comes from a different language key than the
 * identity itself. Everything else — an ordinary dataset tab and every custom view — is
 * labelled by the key that carries its own name.
 */
const MAIN_TAB_LANG_KEY_OVERRIDES = new Map([
    // The people dataset is named system_users, but its tab says "Users".
    ["system_users", "users"],
    // The account view is named user, but its tab says "Account".
    ["user", "account"],
]);

/**
 * Answers which language key the application's own tab bar prints for one tab.
 *
 * @param {string} tabIdentity Dataset name, static tab id or custom view name.
 * @returns {string} Language key of that tab's visible label, or "" for no tab.
 */
export function getMainTabLangKey(tabIdentity) {
    const identity = String(tabIdentity ?? "").trim();
    if (!identity) {
        return "";
    }
    return MAIN_TAB_LANG_KEY_OVERRIDES.get(identity) || identity;
}
