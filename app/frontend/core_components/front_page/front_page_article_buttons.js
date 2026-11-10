// front_page_article_buttons.js
// Builds Home's ordered article links from the viewer-filtered Home payload.
// Displays only server-supplied titles at enabled, usable destinations.
// Inherited links stay off the page until their destination is known to be usable.
import { getInternalDatasetName } from '../navigation/nav_engine/dataset_aliases.js';
import { listPermittedRowPresentations } from '../table_views/row_presentation/row_presentation_choice.js';

async function mountInheritedLinks(list, entries) {
    const current = () => list.isConnected;
    if (!current()) return;
    try {
        await Promise.allSettled(entries.map(async ({ slot, link, dataset, rowId }) => {
            const permitted = listPermittedRowPresentations(dataset);
            if (!permitted.length) { slot.remove(); return; }
            if (permitted.length < 3) {
                const { resolveRowOpening } = await import('../table_views/row_presentation/row_presentation_dispatcher.js');
                const decision = await resolveRowOpening(dataset, { rowId, permitted, isCurrent: current });
                if (!current() || decision.status !== 'resolved') { slot.remove(); return; }
                // A restricted viewer may rely on a personal Page choice. An explicit
                // native href preserves it even in a new tab with fresh session storage.
                const address = new URL(link.href);
                address.searchParams.set('view', decision.viewKey);
                link.href = address.pathname + address.search;
            }
            if (current()) { slot.replaceWith(link); list.style.removeProperty('display'); }
        }));
    } finally {
        if (current() && !list.firstElementChild) list.remove();
    }
}


/**
 * Mount only server-supplied labels and local ordinary article addresses.
 * Inherited buttons use native navigation after resolving their target grants.
 * An explicit Page click can open in place without changing the tab's preference.
 */
export function createFrontPageArticleButtons(items) {
    const list = document.createElement('div');
    list.className = 'front-page-article-buttons';
    const inherited = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (typeof item?.label !== 'string' || !item.label.trim()
            || typeof item.href !== 'string' || !/^\/(?!\/)/.test(item.href)
            || /[\\\s]/.test(item.href)) continue;
        const link = document.createElement('a');
        link.className = 'front-page-article-button fw-btn fw-btn--primary';
        link.href = item.href;
        link.textContent = item.label;
        const address = new URL(item.href, location.origin);
        if (!address.searchParams.has('view')) {
            const target = address.pathname.match(/^\/([^/]+)\/(\d+)$/);
            if (!target) continue;
            let dataset;
            try { dataset = getInternalDatasetName(decodeURIComponent(target[1])); } catch { continue; }
            if (!dataset) continue;
            const slot = document.createComment('article');
            list.append(slot);
            inherited.push({slot, link, dataset, rowId: target[2]});
            continue;
        }
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
    if (inherited.length) {
        if (!list.firstElementChild) list.style.display = 'none';
        // The Home renderer mounts this list synchronously. This guard also drops
        // late permission and row reads when the visitor leaves or signs out.
        queueMicrotask(() => { void mountInheritedLinks(list, inherited).catch(() => {}); });
    }
    return list.hasChildNodes() ? list : null;
}
