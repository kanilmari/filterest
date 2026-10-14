// front_page_article_buttons.js
// Builds Home's ordered article links from the viewer-filtered Home payload.
// Connects the Home text and top row without another title or permission read.
// Empty lists produce no element; native anchors retain ordinary article navigation.

/** Mount only server-supplied labels and local ordinary article addresses. */
export function createFrontPageArticleButtons(items) {
    const list = document.createElement('div');
    list.className = 'front-page-article-buttons';
    for (const item of Array.isArray(items) ? items : []) {
        if (typeof item?.label !== 'string' || !item.label.trim()
            || typeof item.href !== 'string' || !/^\/(?!\/)/.test(item.href)
            || /[\\\s]/.test(item.href)) continue;
        const link = document.createElement('a');
        link.className = 'front-page-article-button fw-btn fw-btn--primary';
        link.href = item.href;
        link.textContent = item.label;
        list.append(link);
    }
    return list.hasChildNodes() ? list : null;
}
