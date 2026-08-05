// recent_tab_saver_helpers.js
// Pure helper functions extracted from recent_tab_saver.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Add an item to the front of a list, removing any existing occurrence,
 * and cap the list at maxSize.
 *
 * @param {Array} list - current list (not mutated)
 * @param {*} newItem - item to insert at front
 * @param {number} maxSize - maximum list length
 * @returns {Array} new list with newItem at index 0
 */
export function rotateRecentList(list, newItem, maxSize) {
    const filtered = list.filter(item => item !== newItem);
    filtered.unshift(newItem);
    return filtered.slice(0, maxSize);
}

/**
 * Remove all occurrences of a key from a list.
 *
 * @param {Array} list - current list (not mutated)
 * @param {*} key - item to remove
 * @returns {Array} new list without the key
 */
export function removeKeyFromList(list, key) {
    return list.filter(item => item !== key);
}
