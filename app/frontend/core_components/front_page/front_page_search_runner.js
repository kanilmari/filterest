// front_page_search_runner.js
// Runs ordinary text searches against the viewer's accepted readable app tabs.
// Shares the supplemental queue and renderer, without the AI search transport.
// Owns debounce, cancellation and stable placeholders for each query generation.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getMainDatasetTabs, subscribeMainDatasetTabs } from '../navigation/main_tabs/main_dataset_tabs.js';
import { createSupplementalDatasetGroup } from '../table_views/compact_dataset_group.js';
import { scheduleDatasetSearch } from '../filterbar/text_search/dataset_search_queue.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

const DEBOUNCE_MS = 300;
const MIN_CHARACTERS = 2;
const ROW_LIMIT = 3;

/** Bind one open sheet; teardown aborts transports and drops all viewer-owned results. */
export function createFrontPageSearchRunner(input, groups, status) {
    let generation = 0;
    let controller;
    let timer;
    let destroyed = false;
    let statusKey = null;
    bindDatasetLanguageRenderer(status, () => {
        status.textContent = statusKey ? getTranslationForKey(statusKey, { countUsage: false }) : '';
    });
    function setStatus(key) {
        statusKey = key;
        status.textContent = key ? getTranslationForKey(key, { countUsage: false }) : '';
    }
    function stop() {
        generation += 1;
        clearTimeout(timer);
        controller?.abort();
    }
    async function run(query, expected) {
        controller = new AbortController();
        const { signal } = controller;
        const current = () => !destroyed && generation === expected && !signal.aborted;
        // The accepted list is the navbar/Home projection of this viewer's read rights.
        // Never discover extra datasets or reuse another viewer's search catalogue.
        const tabs = getMainDatasetTabs().filter(tab => tab.dataset?.startsWith('app_')
            && tab.id !== 'system_users' && tab.id !== 'system_about'
            && tab.can_read_rows !== false && !tab.is_about_table && !tab.is_users_table);
        const entries = tabs.map(tab => {
            const slot = document.createElement('div');
            slot.className = 'front-page-search-sheet__slot';
            slot.setAttribute('aria-busy', 'true');
            const group = createSupplementalDatasetGroup(tab, query, {
                rowCap: ROW_LIMIT, headingTag: 'h2', includeThumbnails: true,
                showAllKey: 'front_page_show_all',
            });
            slot.append(group.element);
            groups.append(slot);
            return { tab, slot, group, hits: false };
        });
        let failed = false;
        await Promise.all(entries.map(entry => scheduleDatasetSearch(async () => {
            if (!current()) return;
            const params = new URLSearchParams({ dataset: entry.tab.dataset, search: query,
                limit: String(ROW_LIMIT), view_key: 'card', include_card_support: '1',
                lang: getLanguageWithBrowserFallback() });
            try {
                const result = await endpoint_router('getResults', { url_params: params.toString(), signal,
                    suppressAuthRedirect: true, suppressErrorToast: true });
                if (!current()) return;
                const rows = (result.data || []).slice(0, ROW_LIMIT);
                entry.hits = rows.length > 0;
                entry.group.render(rows, result.columns || [], result.types || {});
            } catch (error) {
                // A rights change reveals neither a dataset name nor denied content.
                if (current() && ![403, 404].includes(error?.status)) failed = true;
            } finally {
                if (current()) entry.slot.setAttribute('aria-busy', 'false');
            }
        }, signal)));
        if (!current()) return;
        for (const entry of entries) {
            entry.slot.classList.add('front-page-search-sheet__slot--complete');
            entry.slot.hidden = !entry.hits;
        }
        setStatus(failed ? 'front_page_search_failed'
            : entries.some(entry => entry.hits) ? null : 'front_page_search_no_results');
    }
    function change() {
        if (destroyed) return;
        stop();
        groups.replaceChildren();
        const query = input.value.trim();
        if (Array.from(query).length < MIN_CHARACTERS) { setStatus(null); return; }
        setStatus('front_page_search_searching');
        const expected = generation;
        timer = setTimeout(() => { void run(query, expected); }, DEBOUNCE_MS);
    }
    input.addEventListener('input', change);
    const unsubscribe = subscribeMainDatasetTabs(change);
    return {
        destroy() {
            destroyed = true;
            stop();
            unsubscribe();
            input.removeEventListener('input', change);
            groups.replaceChildren();
        },
    };
}
