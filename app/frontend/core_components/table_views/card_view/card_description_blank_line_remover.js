// card_description_blank_line_remover.js
// Drops the blank lines out of the text a result card shows in its short description.
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
