// reading_hyphenation.js
// Adds optional breaks to localized, sanitized reading fields.
// Empty inline markers paint a soft hyphen while text, selection and find retain the authored word.
// Modules are served by Filterest and loaded only for a supported language.

const loadPatterns = new Map([
    ['fi', () => import('./vendor/fi.js')],
    ['en', () => import('./vendor/en-us.js')],
]);

// Work only on complete natural-language tokens. Addresses, identifiers, numbers,
// paths and words with authored soft hyphens pass through, including plain-text URLs.
const wordToken = /^([("'“‘«]*)(\p{L}[\p{L}\p{M}]{4,127})([.,!?;:)"'”’»…]*)$/u;
const excluded = 'a, code, pre, kbd, samp, button, input, select, textarea, [contenteditable], [data-lang-key]';

function markTextNode(node, hyphenate) {
    const source = node.data;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const token of source.matchAll(/\S+/gu)) {
        const parts = wordToken.exec(token[0]);
        if (!parts) continue;
        const syllables = hyphenate(parts[2]).split('\u00ad');
        if (syllables.length < 2 || syllables.join('') !== parts[2]) continue;
        const start = token.index + parts[1].length;
        fragment.append(source.slice(offset, start), syllables[0]);
        for (const syllable of syllables.slice(1)) {
            const marker = document.createElement('span');
            marker.className = 'reading-hyphen';
            marker.setAttribute('aria-hidden', 'true');
            fragment.append(marker, syllable);
        }
        offset = start + parts[2].length;
    }
    if (offset) {
        fragment.append(source.slice(offset));
        node.replaceWith(fragment);
    }
}

/** Apply once to fresh read-mode DOM. A failed import leaves the original readable immediately. */
export async function hyphenateReadingField(field, language) {
    field.lang = language || '';
    const load = loadPatterns.get(field.lang.toLowerCase().split('-')[0]);
    if (!load || field.matches(excluded)) return;
    const nodes = [];
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement.closest(excluded) && /\p{L}{5}/u.test(node.data)) nodes.push(node);
    }
    if (!nodes.length) return;
    try {
        const [{ default: createHyphenator }, { default: patterns }] = await Promise.all([
            import('./vendor/hyphen.js'), load(),
        ]);
        // Per field: no site-wide word cache retains private text after the article closes.
        // The engine augments its exception dictionary with every new word.
        const [levels, trie, exceptions] = patterns;
        const hyphenate = createHyphenator([levels, trie, { ...exceptions }]);
        for (const node of nodes) {
            if (field.contains(node) && field.lang === language) markTextNode(node, hyphenate);
        }
    } catch {
        // The normal wrapping rules also work offline or during a version handover.
    }
}
