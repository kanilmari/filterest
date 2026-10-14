// front_page_article_row_picker.js
// Selects one labelled, readable article through searchable canonical result pages.
// Connects the shared single-selection dropdown and article metadata localization.
// Owns cancellation and request ordering so obsolete pages cannot supply a selection.
import { createMultiselectDropdown } from '../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { buildDatasetQueryParams } from '../endpoints/endpoint_data_fetcher_helpers.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { resolveDatasetDisplayValue, bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { parseRoleString } from '../table_views/card_view/card_field_formatter.js';
import { articleButtonCopy as copy } from './front_page_article_buttons_copy.js';

const INITIAL_PAGE_SIZE = 20;

/** Mirrors front_page_article_title_resolver.go using only the authorized projection. */
export function resolveArticleButtonLabel(row, columns = [], types = {}, language = getLanguageWithBrowserFallback(), viewer = 0) {
    const owner = Object.keys(types).find(column => types[column]?.is_row_owner === true);
    const own = viewer > 1 && owner && String(row[owner]) === String(viewer);
    for (const column of columns) {
        const metadata = types[column];
        if (!Object.hasOwn(row, column) || !metadata || metadata.hide_everywhere
            || (metadata.client_delivery_mode && metadata.client_delivery_mode !== 'include')
            || (metadata.hide_on_bg_crd_if_not_own && !own)) continue;
        const { baseRoles, hasLangKey } = parseRoleString(metadata.card_element || '');
        if (!baseRoles.includes('header')) continue;
        let label = resolveDatasetDisplayValue(row[column], metadata, language).trim();
        if (metadata.hide_false_null_on_big_crd && (row[column] === false || label === 'false')) continue;
        if (hasLangKey && label) {
            const translated = getTranslationForKey(label, { countUsage: false });
            label = translated === label ? '' : String(translated || '').trim();
        }
        if (label) return label;
    }
    return '';
}

/** The dropdown owns search/keyboard selection; its paging controls use the same canonical read. */
export function createArticleRowPicker({ onChange, viewerID = 0 }) {
    const element = document.createElement('div');
    element.className = 'front-page-article-picker';
    element.dataset.testid = 'front-page-article-row-picker';
    const host = document.createElement('div');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const paging = document.createElement('div');
    paging.className = 'front-page-settings-actions';
    const previous = document.createElement('button'), next = document.createElement('button');
    previous.type = next.type = 'button';
    previous.className = next.className = 'fw-btn fw-btn--ghost';
    previous.dataset.testid = 'front-page-article-previous';
    next.dataset.testid = 'front-page-article-next';
    const pageLabel = document.createElement('span');
    paging.append(previous, pageLabel, next);
    element.append(host, status);
    let dataset = null, query = '', offset = 0, pageSize = INITIAL_PAGE_SIZE, total = null;
    let hasNext = false, options = [], selected = null;
    let sequence = 0, controller = null, disposed = false, busy = false, enabled = true;
    let statusKey = '';
    const dropdown = createMultiselectDropdown({
        containerElement: host, portalElement: element, options: [], maxSelections: 1, allowExclude: false,
        placeholder: copy('chooseRow'), searchPlaceholder: copy('search'), noResultsLabel: copy('noResults'),
        clearLabel: copy('chooseRow'), closeLabel: copy('chooseRow'),
        beforeSearchElement: paging, preserveViewState: true,
        onSearch: async search => {
            // A dataset change clears this field while the shared debounce may still be pending.
            if (search !== searchInput.value.trim()) return options;
            query = search; offset = 0; return readPage();
        },
        onChange: ({ includeValues }) => {
            selected = options.find(option => option.value === includeValues[0]) || null;
            onChange(selected ? { table_uid: dataset.table_uid, row_id: selected.value, label: selected.label } : null);
        },
    });
    const input = host.querySelector('[role="combobox"]');
    input.setAttribute('aria-label', copy('row'));
    input.id = 'front-page-article-row';
    input.dataset.testid = input.id;
    const searchInput = element.querySelector('.msd-dropdown-search-input');
    searchInput.id = 'front-page-article-search'; searchInput.dataset.testid = searchInput.id;
    const searchLabel = document.createElement('label'); searchLabel.htmlFor = searchInput.id;
    paging.append(searchLabel);
    // Abort immediately on typing, before the shared search debounce fires.
    element.addEventListener('input', () => {
        sequence++; controller?.abort(); busy = false; selected = null; dropdown.setValue({ includeValues: [] });
        onChange(null);
    });
    function update() {
        dropdown.setDisabled(!enabled || !dataset);
        previous.disabled = !enabled || !dataset || busy || offset === 0;
        next.disabled = !enabled || !dataset || busy || !hasNext;
        pageLabel.textContent = copy('page', { page: Math.floor(offset / pageSize) + 1 });
        status.textContent = statusKey ? copy(statusKey) : '';
    }
    async function readPage() {
        if (!dataset || disposed) return [];
        const current = ++sequence;
        controller?.abort(); controller = new AbortController();
        busy = true; statusKey = 'loading'; update();
        try {
            const response = await endpoint_router('getResults', {
                url_params: buildDatasetQueryParams({ dataset_name: dataset.dataset_name, offset,
                    row_count: total, view_key: 'article_view', lang: getLanguageWithBrowserFallback(),
                    sort_column: 'id', sort_order: 'ASC', filters: query ? { search: query } : {} }),
                signal: controller.signal, suppressErrorToast: true, suppressAuthRedirect: true,
            });
            if (disposed || current !== sequence) return options;
            const rows = Array.isArray(response.data) ? response.data : [];
            if (Number.isInteger(response.resultsPerLoad) && response.resultsPerLoad > 0) pageSize = response.resultsPerLoad;
            total = Number.isInteger(response.row_count) ? response.row_count : null;
            hasNext = total === null ? rows.length === pageSize : offset + rows.length < total;
            options = rows.flatMap(row => {
                const label = resolveArticleButtonLabel(row, response.columns, response.types, getLanguageWithBrowserFallback(), viewerID);
                const value = String(row.id ?? '');
                return label && /^(0|[1-9]\d*)$/.test(value) ? [{ value, label, searchTerms: query ? [query] : [] }] : [];
            });
            if (selected && !options.some(option => option.value === selected.value)) options.unshift(selected);
            dropdown.setOptions(options);
            statusKey = options.length ? '' : 'noResults';
            return options;
        } catch (error) {
            // Ignore obsolete failures too; dataset changes also invalidate the dropdown's installation.
            if (disposed || current !== sequence) return options;
            if (error?.name !== 'AbortError') {
                options = []; hasNext = false; statusKey = 'rowsFailed'; dropdown.setOptions([]);
            }
            return [];
        } finally {
            if (!disposed && current === sequence) { busy = false; update(); }
        }
    }
    async function movePage(change) {
        offset += change * pageSize;
        await readPage();
    }
    previous.addEventListener('click', () => { void movePage(-1); });
    next.addEventListener('click', () => { void movePage(1); });
    bindDatasetLanguageRenderer(element, () => {
        previous.textContent = copy('previous'); next.textContent = copy('next'); searchLabel.textContent = copy('search');
        input.setAttribute('aria-label', copy('row'));
        dropdown.setLabels({ placeholder: copy('chooseRow'), searchPlaceholder: copy('search'),
            noResultsLabel: copy('noResults'), clearLabel: copy('chooseRow'),
            popupTitle: copy('chooseRow'), closeLabel: copy('chooseRow') });
        update();
        if (dataset) {
            selected = null; options = []; dropdown.setValue({ includeValues: [] }); onChange(null);
            return readPage();
        }
    });
    return {
        element,
        setDisabled(value) { enabled = !value; update(); },
        setViewerID(value) { viewerID = value; },
        async setDataset(value) {
            // Returning current options alone can hand the dropdown a snapshot taken before the new page loads.
            dropdown.cancelPendingSearch();
            sequence++; controller?.abort(); dropdown.close();
            dataset = value; query = ''; searchInput.value = ''; offset = 0; total = null; hasNext = false; busy = false;
            selected = null; options = []; statusKey = '';
            dropdown.setOptions([]); dropdown.setValue({ includeValues: [] }); onChange(null); update();
            if (dataset) await readPage();
        },
        destroy() { disposed = true; sequence++; controller?.abort(); dropdown.destroy(); },
    };
}
