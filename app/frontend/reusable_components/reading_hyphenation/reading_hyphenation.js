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
const excluded = 'a, code, pre, kbd, samp, button, input, select, textarea, script, style, [contenteditable], [role="textbox"], .reading-no-hyphenate';
const eligible = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,th,td,.reading-hyphenate,[data-reading-language],[data-article-heading-language]';
const languageOwner = '[lang],[data-reading-language],[data-article-heading-language]';
let sitePolicy = { fi: true, en: false };

export function setReadingHyphenation(policy) {
    if (!policy || (policy.fi === sitePolicy.fi && policy.en === sitePolicy.en)) return;
    sitePolicy = { fi: policy.fi === true, en: policy.en === true };
    if (typeof document !== 'undefined' && document.body) void refreshReadingHyphenation(document.body);
}

function readingLanguage(element, explicitField) {
    if (element.closest(excluded) || (!explicitField && !element.closest(eligible))) return '';
    const owner = element.closest(languageOwner);
    const language = owner?.dataset.readingLanguage ?? owner?.dataset.articleHeadingLanguage ?? owner?.lang ?? '';
    const base = language.toLowerCase().split('-')[0];
    return sitePolicy[base] === true ? base : '';
}

function markTextNode(node, hyphenate, language) {
    const source = node.data;
    const result = document.createDocumentFragment();
    let offset = 0;
    for (const token of source.matchAll(/\S+/gu)) {
        const parts = wordToken.exec(token[0]);
        if (!parts) continue;
        const syllables = hyphenate(parts[2]).split('\u00ad');
        if (syllables.length < 2 || syllables.join('') !== parts[2]) continue;
        const start = token.index + parts[1].length;
        result.append(source.slice(offset, start), syllables[0]);
        for (const syllable of syllables.slice(1)) {
            const marker = document.createElement('span');
            marker.className = 'reading-hyphen';
            marker.setAttribute('aria-hidden', 'true');
            result.append(marker, syllable);
        }
        offset = start + parts[2].length;
    }
    if (offset) {
        // Keep one replaceable run per authored text node. Markers carry no selectable text.
        const run = document.createElement('span');
        run.dataset.hyphenatedRun = language;
        run.append(result, source.slice(offset));
        node.replaceWith(run);
    }
}

async function applyPatterns(language, nodes, scope, explicitField) {
    try {
        const [{ default: createHyphenator }, { default: patterns }] = await Promise.all([
            import('./vendor/hyphen.js'), loadPatterns.get(language)(),
        ]);
        const [levels, trie, exceptions] = patterns;
        // Each pass gets a fresh word dictionary, including on pages with private data.
        const hyphenate = createHyphenator([levels, trie, { ...exceptions }]);
        for (const node of nodes) {
            const element = node.parentElement;
            if (element && scope.contains(node) && readingLanguage(element, explicitField) === language) {
                markTextNode(node, hyphenate, language);
            }
        }
    } catch {
        // Authored text remains readable if a pattern cannot be loaded.
    }
}

export async function refreshReadingHyphenation(scope, explicitField = false) {
    if (scope.closest('[data-hyphenated-run]')) return;
    for (const run of scope.querySelectorAll('[data-hyphenated-run]')) {
        if (readingLanguage(run, explicitField) !== run.dataset.hyphenatedRun) {
            run.replaceWith(document.createTextNode(run.textContent));
        }
    }
    if (scope.closest(excluded)) return;
    const groups = new Map();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                return node.matches(excluded + ',[data-hyphenated-run]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
            }
            return /\p{L}{5}/u.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const language = readingLanguage(node.parentElement, explicitField);
        if (!language) continue;
        if (!groups.has(language)) groups.set(language, []);
        groups.get(language).push(node);
    }
    await Promise.all(Array.from(groups, ([language, nodes]) => applyPatterns(language, nodes, scope, explicitField)));
}

export function hyphenateReadingField(field, language) {
    field.lang = language || '';
    return refreshReadingHyphenation(field, true);
}

/** Keep mounted reading content in sync with new rows, language and opt-out changes. */
export function observeReadingHyphenation(root) {
    const observer = new MutationObserver(records => {
        const changed = new Set();
        for (const record of records) {
            if (record.type === 'attributes') {
                if (record.attributeName === 'class') {
                    const classes = ['reading-hyphenate', 'reading-no-hyphenate'];
                    const previous = new Set((record.oldValue || '').split(/\s+/));
                    if (!classes.some(key => previous.has(key) !== record.target.classList.contains(key))) continue;
                }
                changed.add(record.target);
            } else if (record.type === 'characterData') {
                if (record.target.parentElement) changed.add(record.target.parentElement);
            } else {
                for (const node of record.addedNodes) {
                    // Our own replacement is already complete.
                    if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute('data-hyphenated-run')) changed.add(node);
                    if (node.nodeType === Node.TEXT_NODE && node.parentElement) changed.add(node.parentElement);
                }
            }
        }
        for (const element of changed) {
            if (!root.contains(element)) continue;
            let parent = element.parentElement;
            while (parent && !changed.has(parent)) parent = parent.parentElement;
            if (!parent) void refreshReadingHyphenation(element);
        }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeOldValue: true, attributeFilter: ['lang', 'class', 'contenteditable', 'data-reading-language', 'data-article-heading-language'] });
    void refreshReadingHyphenation(root);
    return observer;
}
