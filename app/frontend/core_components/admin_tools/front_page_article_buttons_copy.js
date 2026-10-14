// front_page_article_buttons_copy.js
// Supplies the Home article editor's keyed copy in all four bundled languages.
// Connects component dictionaries and the current interface language without a migration.
// Keeps feedback readable before site-authored translations are available.
import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

export const ARTICLE_BUTTON_COPY = {
    title: ['Artikkelipainikkeet', 'Article buttons', '文章按钮', '文章按鈕'],
    help: ['Valitse aineisto ja artikkeli. Kukin käyttäjä näkee vain artikkelit, jotka hän saa avata.', 'Choose a dataset and an article. Each viewer sees only articles they may open.', '选择数据集和文章。每位用户只能看到有权打开的文章。', '揀資料集同文章。每位用戶只會見到有權開啟嘅文章。'],
    placement: ['Painikkeiden sijainti', 'Button placement', '按钮位置', '按鈕位置'],
    below_text: ['Tekstin alla', 'Below the text', '文字下方', '文字下面'],
    top_row: ['Ylärivillä', 'In the top row', '顶部栏', '頂部列'],
    dataset: ['Aineisto', 'Dataset', '数据集', '資料集'],
    chooseDataset: ['Valitse aineisto…', 'Choose a dataset…', '选择数据集…', '揀資料集…'],
    currentProject: ['Nykyinen projekti', 'Current project', '当前项目', '目前專案'],
    otherDatasets: ['Muut aineistot', 'Other datasets', '其他数据集', '其他資料集'],
    row: ['Artikkeli', 'Article', '文章', '文章'],
    chooseRow: ['Valitse artikkeli…', 'Choose an article…', '选择文章…', '揀文章…'],
    search: ['Etsi artikkeleita…', 'Search articles…', '搜索文章…', '搜尋文章…'],
    noResults: ['Ei nimettyjä artikkeleita', 'No labelled articles', '没有有标题的文章', '冇有標題嘅文章'],
    previous: ['Edellinen sivu', 'Previous page', '上一页', '上一頁'],
    next: ['Seuraava sivu', 'Next page', '下一页', '下一頁'],
    page: ['Sivu {page}', 'Page {page}', '第 {page} 页', '第 {page} 頁'],
    preview: ['Painikkeen teksti: {label}', 'Button label: {label}', '按钮文字：{label}', '按鈕文字：{label}'],
    add: ['Lisää painike', 'Add button', '添加按钮', '加入按鈕'],
    enabled: ['Käytössä', 'Enabled', '启用', '啟用'],
    up: ['Siirrä ylöspäin', 'Move up', '上移', '上移'],
    down: ['Siirrä alaspäin', 'Move down', '下移', '下移'],
    remove: ['Poista painike', 'Remove button', '移除按钮', '移除按鈕'],
    save: ['Tallenna artikkelipainikkeet', 'Save article buttons', '保存文章按钮', '儲存文章按鈕'],
    reload: ['Lataa artikkelipainikkeet uudelleen', 'Reload article buttons', '重新加载文章按钮', '重新載入文章按鈕'],
    loading: ['Ladataan…', 'Loading…', '正在加载…', '載入緊…'],
    saving: ['Tallennetaan…', 'Saving…', '正在保存…', '儲存緊…'],
    saved: ['Artikkelipainikkeet tallennettu.', 'Article buttons saved.', '文章按钮已保存。', '文章按鈕已儲存。'],
    loadFailed: ['Artikkelipainikkeita ei voitu ladata.', 'Could not load article buttons.', '无法加载文章按钮。', '載入唔到文章按鈕。'],
    rowsFailed: ['Artikkeleita ei voitu ladata. Yritä hakua uudelleen.', 'Could not load articles. Try searching again.', '无法加载文章。请重试搜索。', '載入唔到文章。請再搜尋。'],
    saveFailed: ['Artikkelipainikkeita ei voitu tallentaa.', 'Could not save article buttons.', '无法保存文章按钮。', '儲存唔到文章按鈕。'],
    refreshFailed: ['Painikkeet tallennettiin, mutta etusivua ei voitu päivittää.', 'Buttons were saved, but Home could not be refreshed.', '按钮已保存，但无法刷新首页。', '按鈕已儲存，但更新唔到首頁。'],
    invalid: ['Valitse nimetty artikkeli. Enintään 10 eri painiketta sallitaan.', 'Choose a labelled article. Up to 10 different buttons are allowed.', '请选择有标题的文章。最多可添加10个不同按钮。', '請揀有標題嘅文章。最多可加入10個唔同按鈕。'],
    unavailable: ['Artikkeli ei ole saatavilla. Poista painike ennen tallentamista.', 'Article unavailable. Remove this button before saving.', '文章不可用。保存前请移除此按钮。', '文章用唔到。儲存前請移除呢個按鈕。'],
    target: ['Aineisto {dataset}, rivi {row}', 'Dataset {dataset}, row {row}', '数据集 {dataset}，行 {row}', '資料集 {dataset}，資料行 {row}'],
    configurationError: ['Tallennettu painikeasetus on virheellinen. Lataa uudelleen tai korvaa lista tallentamalla.', 'The saved button setting is invalid. Reload or save a replacement list.', '已保存的按钮设置无效。请重新加载或保存新的列表。', '已儲存嘅按鈕設定無效。請重新載入或儲存新清單。'],
    conflict: ['Toinen ylläpitäjä on muuttanut asetuksia. Lataa asetukset uudelleen ennen tallentamista.', 'Another administrator changed these settings. Reload before saving.', '另一位管理员已更改设置。请重新加载后再保存。', '另一位管理員改咗設定。請重新載入再儲存。'],
};

/** Resolve a language key with an authored fallback; never expose a missing key. */
export function articleButtonCopy(key, values = {}) {
    const language = getLanguageWithBrowserFallback() || 'en';
    const lower = language.toLowerCase();
    const index = lower.startsWith('fi') ? 0 : ['yue', 'zh-hk', 'zh-tw'].includes(lower) ? 3
        : lower === 'ch' || lower.startsWith('zh') ? 2 : 1;
    const langKey = key === 'conflict' ? 'front_page_save_conflict' : `front_page_article_buttons_${key}`;
    const text = getTranslationForKey(langKey, { language, fallback: ARTICLE_BUTTON_COPY[key]?.[index], countUsage: false });
    return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), text);
}
