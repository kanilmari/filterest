// card_description_blank_line_remover.js
// Drops blank text lines and empty HTML edges from a result card's short description.
// Between a field's stored text and the clipped, few-line description of one card.
// Exists because a card shows only a couple of lines: an empty line after a heading
// spends one of them on nothing, while the stored text and every full view keep it.

/** A line that carries no visible character, so a card would show it as a gap. */
function isBlankLine(line) {
    return line.trim() === "";
}

/**
 * The same text with its blank lines left out, for a card's short description only.
 *
 * Line breaks between the remaining lines are preserved, and so is each kept
 * line's own leading and trailing space: only wholly blank lines go. Text that
 * is nothing but blank lines becomes empty, because a card has nothing to show
 * for it. The stored value is never touched — the caller keeps it for editing
 * and for the article view, which show the text in full.
 *
 * @param {string} text - the text as the card received it
 * @returns {string} the same text without its blank lines
 */
export function removeBlankLinesFromCardDescription(text) {
    if (text === null || text === undefined) {
        return "";
    }
    const normalizedText = String(text);
    if (!normalizedText.includes("\n") && !normalizedText.includes("\r")) {
        // One line has no blank line to lose; keep it exactly as it came.
        return normalizedText;
    }
    return normalizedText
        .split(/\r\n|\r|\n/)
        .filter((line) => !isBlankLine(line))
        .join("\n");
}

/**
 * Trim empty edges of an already sanitized card preview, before CSS clamps it.
 * Walk the renderer's DOM rather than reparsing HTML with a tag expression.
 * Keep populated blocks and inline elements intact: their boundaries separate
 * words, paragraphs and list items. Trailing empty blocks must not cause a
 * false overflow cue either. Only this preview's children change; its stored
 * value, the article and the editor keep the original content.
 *
 * @param {HTMLElement} preview - the field formatter's sanitized description
 */
export function trimEmptyEdgesFromCardDescription(preview) {
    function trimEdge(parent, fromStart) {
        let child = fromStart ? parent.firstChild : parent.lastChild;
        while (child) {
            if (child.nodeType === Node.TEXT_NODE) {
                child.textContent = fromStart
                    ? child.textContent.trimStart()
                    : child.textContent.trimEnd();
                if (child.textContent) return;
            } else if (child.nodeType === Node.ELEMENT_NODE && child.textContent.trim()) {
                trimEdge(child, fromStart);
                return;
            }
            // Empty paragraphs, breaks and empty inline wrappers cannot carry
            // visible preview text, even when they contain NBSP or more breaks.
            const next = fromStart ? child.nextSibling : child.previousSibling;
            child.remove();
            child = next;
        }
    }
    trimEdge(preview, true);
    trimEdge(preview, false);
}
