// front_page_article_buttons.js
// Builds Home's ordered article links from the viewer-filtered Home payload.
// Connects the Home text and top row without another title or permission read.
// Empty lists produce no element; only explicit Page clicks borrow IFAV history.

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
        const address = new URL(item.href, location.origin);
        if (address.searchParams.get('view') === 'image_first_page_view') {
            link.addEventListener('click', event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const target = address.pathname.match(/^\/([^/]+)\/(\d+)$/);
                if (!target) return;
                event.preventDefault();
                const origin = location.href;
                void Promise.all([
                    import('../table_views/card_view/image_first_view_opener.js'),
                    import('../navigation/nav_engine/dataset_aliases.js'),
                ]).then(([{ openImageFirstView }, { getInternalDatasetName }]) => openImageFirstView({
                    tableName: getInternalDatasetName(decodeURIComponent(target[1])),
                    rowItem: { id: target[2] }, layout: 'page',
                    isCurrent: () => location.href === origin && link.isConnected,
                })).catch(error => console.warn('Home Page opening failed', error));
            });
        }
        list.append(link);
    }
    return list.hasChildNodes() ? list : null;
}
