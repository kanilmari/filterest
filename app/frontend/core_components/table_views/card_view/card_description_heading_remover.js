// card_description_heading_remover.js
// Leaves the stored text's own subheadings out of the short description a result card shows.
// Between the text a card's short description is rendered from and the element it is rendered into.
// Exists because a card shows only a couple of lines and a subheading would take one of them, while the stored text and every full view keep it.

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/**
 * A string that may be a heading's end tag. Only the browser's HTML parser can
 * tell whether it is one: inside a quoted attribute value, a comment or raw
 * text it is plain text.
 */
const POSSIBLE_HEADING_END_TAG = /<\/h([1-6])(?=[\s/>])[^<>]*>/gi;

/** The element written after each possible end tag, so the parse shows which ones were tags. */
const END_TAG_MARKER = "card-heading-end";

/** Formatting elements the HTML parser reopens straight after a heading that left one of them open. */
const REOPENED_FORMATTING_ELEMENTS = new Set([
    "a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong", "tt", "u",
]);

/** The card's allowed elements that stand on lines of their own. */
const BLOCK_ELEMENTS = new Set([
    "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr", "blockquote", "pre",
]);

function isElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE;
}

function isText(node) {
    return node?.nodeType === Node.TEXT_NODE;
}

function isBlock(node) {
    return isElement(node) && BLOCK_ELEMENTS.has(node.localName);
}

function isLineBreakOrBlock(node) {
    return isBlock(node) || (isElement(node) && node.localName === "br");
}

/**
 * Whether each heading the browser builds from the text, in document order, is
 * closed by an end tag of its own level. A heading the parser closes some other
 * way — at the next heading, by an end tag of another level, or at the end of
 * the text — is not. Null when the text holds no possible end tag at all.
 *
 * @param {string} text
 * @returns {boolean[]|null}
 */
function readHeadingClosures(text) {
    if (!/<\/h[1-6]/i.test(text)) {
        return null;
    }
    // The marker carries no quotation mark, so inside an attribute value or a
    // comment it stays text and changes nothing around it.
    const markedText = text.replace(
        POSSIBLE_HEADING_END_TAG,
        (endTag, level) => `${endTag}<${END_TAG_MARKER} data-level=${level}></${END_TAG_MARKER}>`
    );
    const parsed = new DOMParser().parseFromString(markedText, "text/html");
    return Array.from(parsed.body.querySelectorAll(HEADING_SELECTOR), isClosedByOwnEndTag);
}

function isClosedByOwnEndTag(heading) {
    // The parser writes the marker straight after the heading its end tag
    // closed, inside any formatting element it reopens there first.
    let next = heading.nextSibling;
    while (isElement(next) && REOPENED_FORMATTING_ELEMENTS.has(next.localName)) {
        next = next.firstChild;
    }
    return isElement(next)
        && next.localName === END_TAG_MARKER
        && next.getAttribute("data-level") === heading.localName.slice(1);
}

function leadingWhitespace(text) {
    return text.slice(0, text.length - text.trimStart().length);
}

function trailingWhitespace(text) {
    return text.slice(text.trimEnd().length);
}

/** The node a node's content starts with, looking into inline elements. */
function firstNodeInside(node) {
    let current = node;
    while (isElement(current) && !isLineBreakOrBlock(current) && current.firstChild) {
        current = current.firstChild;
    }
    return current;
}

/** The node a node's content ends with, looking into inline elements. */
function lastNodeInside(node) {
    let current = node;
    while (isElement(current) && !isLineBreakOrBlock(current) && current.lastChild) {
        current = current.lastChild;
    }
    return current;
}

/** Whether nothing more follows on the line this node ends. */
function endsLine(node) {
    const last = lastNodeInside(node);
    if (last === null) {
        return true;
    }
    return isText(last) ? trailingWhitespace(last.data).includes("\n") : isLineBreakOrBlock(last);
}

/** Whether this node begins a line of its own. */
function startsLine(node) {
    const first = firstNodeInside(node);
    if (first === null) {
        return true;
    }
    return isText(first) ? leadingWhitespace(first.data).includes("\n") : isLineBreakOrBlock(first);
}

function dropLeadingLineBreaks(node) {
    const first = firstNodeInside(node);
    if (!isText(first)) {
        return;
    }
    const lastBreak = leadingWhitespace(first.data).lastIndexOf("\n");
    if (lastBreak !== -1) {
        first.data = first.data.slice(lastBreak + 1);
    }
}

function dropTrailingLineBreaks(node) {
    const last = lastNodeInside(node);
    if (!isText(last)) {
        return;
    }
    const trailing = trailingWhitespace(last.data);
    if (trailing.includes("\n")) {
        last.data = last.data.slice(0, last.data.length - trailing.length);
    }
}

/** Whether a parent holds nothing but this child, apart from blank text. */
function holdsOnly(parent, child) {
    for (const sibling of parent.childNodes) {
        if (sibling !== child && !(isText(sibling) && sibling.data.trim() === "")) {
            return false;
        }
    }
    return true;
}

/** The heading, or the outermost element that held nothing but it, such as a list item. */
function outermostHolderOf(heading, renderedDescription) {
    let node = heading;
    while (node.parentNode && node.parentNode !== renderedDescription && holdsOnly(node.parentNode, node)) {
        node = node.parentNode;
    }
    return node;
}

/**
 * Takes a node out without leaving an empty line where it stood, and without
 * joining the text before and after it when the node was all that kept them
 * on lines of their own.
 */
function removeKeepingLines(node) {
    const before = node.previousSibling;
    const after = node.nextSibling;
    if (!endsLine(before) && !startsLine(after)) {
        node.replaceWith(node.ownerDocument.createTextNode("\n"));
        return;
    }
    node.remove();
    if (after !== null && endsLine(before)) {
        dropLeadingLineBreaks(after);
    }
    if (before !== null && (after === null || isBlock(after))) {
        dropTrailingLineBreaks(before);
    }
}

/**
 * Leaves the text's own subheadings out of a card's rendered short description.
 *
 * The card has already rendered the text, so the browser's own HTML parser has
 * decided what is a heading: a tag-like string inside a quoted attribute value,
 * a comment or raw text is none. A heading goes, with its content, when an end
 * tag of its own level closes it; an unclosed or mismatched heading stays as it
 * is, so a missing end tag never takes the rest of the text with it. A list
 * item or other element that held nothing but the heading goes with it, and no
 * empty line is left where it stood. A plain text, or a rendering without
 * headings, is not touched at all, and the stored text is never changed: the
 * article view and the edit form show it in full.
 *
 * @param {HTMLElement} renderedDescription - the card's short description as rendered
 * @param {string} renderedText - the text that element was rendered from
 */
export function removeHeadingsFromCardDescription(renderedDescription, renderedText) {
    const renderedHeadings = Array.from(renderedDescription.querySelectorAll(HEADING_SELECTOR));
    if (renderedHeadings.length === 0) {
        return;
    }
    const closures = readHeadingClosures(String(renderedText ?? ""));
    if (closures === null || closures.length !== renderedHeadings.length) {
        // The element does not read as this text does; leave it as rendered.
        return;
    }
    renderedHeadings.forEach((heading, index) => {
        if (closures[index] && renderedDescription.contains(heading)) {
            removeKeepingLines(outermostHolderOf(heading, renderedDescription));
        }
    });
}
