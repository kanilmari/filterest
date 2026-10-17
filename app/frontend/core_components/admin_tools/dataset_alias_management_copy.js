// dataset_alias_management_copy.js
// Supplies the alias editor's copy in every bundled language through language keys.
// Connects the site translation dictionary and the administrator language preference.
// Keeps refusal and preserved-audit notices understandable before translations load.
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getTranslationForKey, loadTranslationsForLanguage } from '../lang/component_language_dictionary.js';

// fi, en, ch, yue. Runtime translations may override the authored fallback.
const COPY = {
    title: ['Aineistojen URL-aliakset', 'Dataset URL Alias Management', '数据集网址别名管理', '資料集網址別名管理'],
    intro: ['Muokkaa aineiston ensisijaista osoitenimeä. Aineiston varsinainen nimi toimii edelleen.', 'Manage the primary public URL slug for each dataset while keeping raw dataset routes backward compatible.', '管理数据集的主要网址别名，原始名称仍可使用。', '管理資料集嘅主要網址別名，原本名稱仍可使用。'],
    uniqueness: ['Aineiston nimet ja aliakset varaavat saman osoitenimiavaruuden.', 'Dataset names also reserve their URL routes.', '数据集名称和别名共用同一网址名称空间。', '資料集名稱同別名共用同一網址名稱空間。'],
    dataset: ['Aineisto', 'Dataset', '数据集', '資料集'],
    primary: ['Ensisijainen julkinen alias', 'Primary public alias', '主要公开别名', '主要公開別名'],
    slug: ['julkinen-aineiston-nimi', 'public-dataset-slug', 'public-dataset-slug', 'public-dataset-slug'],
    hint: ['Käytä pieniä kirjaimia, numeroita, alaviivoja tai yhdysmerkkejä. app_-aineisto voi käyttää lyhyttä nimeä automaattisesti; system_-aineiston alias otetaan käyttöön tallentamalla.', 'Use lowercase letters, numbers, underscores, or hyphens. app_ datasets may keep a stripped alias automatically, while system_ datasets stay on the raw URL until an alias is saved here.', '使用小写字母、数字、下划线或连字符。app_ 数据集可自动使用短名称；system_ 别名须保存后启用。', '用小寫字母、數字、底線或連字號。app_ 資料集可自動用短名稱；system_ 別名要儲存先啟用。'],
    routing: ['Nykyiset osoitteet', 'Current Routing', '当前网址', '目前網址'],
    source: ['Aliaksen lähde', 'Alias source', '别名来源', '別名來源'],
    rawRoute: ['Varsinainen osoite', 'Raw route', '原始网址', '原本網址'],
    canonical: ['Ensisijainen osoite', 'Canonical route', '主要网址', '主要網址'],
    publicRoute: ['Julkinen osoite', 'Public route', '公开网址', '公開網址'],
    candidate: ['Lyhyen nimen ehdotus', 'Default stripped candidate', '默认短名称', '預設短名稱'],
    policy: ['Aliaskäytäntö', 'Policy Recommendation', '别名规则', '別名規則'],
    recommendation: ['Pidä system_-aineistojen lyhyet nimet erikseen hyväksyttävinä. Tallenna alias vain tarkoituksella julkiselle aineistolle.', 'Keep stripped system_ aliases opt-in and explicitly reviewed. Save an alias only for an intentionally public dataset.', 'system_ 短名称须明确批准。仅为有意公开的数据集保存别名。', 'system_ 短名稱要明確批准。只為有意公開嘅資料集儲存別名。'],
    save: ['Tallenna alias', 'Save alias', '保存别名', '儲存別名'],
    clear: ['Poista tallennettu alias', 'Clear stored alias', '清除已保存别名', '清除已儲存別名'],
    useCandidate: ['Käytä lyhyttä nimeä', 'Use stripped candidate', '使用短名称', '用短名稱'],
    select: ['Valitse aineisto…', 'Select dataset...', '选择数据集…', '揀資料集…'],
    search: ['Etsi aineistoja…', 'Search datasets...', '搜索数据集…', '搜尋資料集…'],
    empty: ['Aliasten hallintaan ei ole aineistoja.', 'No datasets available for alias management.', '没有可管理别名的数据集。', '冇可管理別名嘅資料集。'],
    selectFirst: ['Valitse ensin aineisto.', 'Select a dataset before saving.', '请先选择数据集。', '請先揀資料集。'],
    rawOnly: ['Vain varsinainen osoite', 'Raw URL only', '仅使用原始网址', '只用原本網址'],
    automatic_app_policy: ['Automaattinen app_-alias', 'Automatic app_ alias', '自动 app_ 别名', '自動 app_ 別名'],
    database_primary_active: ['Tallennettu ensisijainen alias', 'Stored primary alias', '已保存的主要别名', '已儲存嘅主要別名'],
    code_fallback: ['Varajärjestelmän alias', 'Fallback safety-net alias', '后备别名', '後備別名'],
    raw_only: ['Vain varsinainen osoite', 'Raw URL only', '仅使用原始网址', '只用原本網址'],
    noneSelected: ['Aineistoa ei ole valittu', 'No dataset selected', '未选择数据集', '未揀資料集'],
    selectReview: ['Valitse aineisto tarkistaaksesi sen aliaskäytännön.', 'Select a dataset to review how its public alias policy behaves.', '选择数据集以查看其别名规则。', '揀資料集去睇佢嘅別名規則。'],
    noCandidate: ['Ei lyhyen nimen ehdotusta', 'No stripped candidate', '没有短名称', '冇短名稱'],
    automaticCandidate: ['{name} (automaattinen app_-aineistoille)', '{name} (auto-applies for app_ datasets)', '{name}（app_ 数据集自动使用）', '{name}（app_ 資料集自動用）'],
    optInCandidate: ['{name} (erikseen käyttöön; aktivoi tallentamalla)', '{name} (opt-in only; save to activate)', '{name}（保存后启用）', '{name}（儲存後啟用）'],
    implicitAutomatic: ['Alias tulee automaattisesta app_-käytännöstä. Voit korvata sen tallentamalla toisen aliaksen; tyhjentäminen säilyttää automaattisen osoitteen.', 'This alias currently comes from the automatic app_ alias policy. Save a different alias to override it; clearing it keeps the automatic app_ route in place.', '此别名来自自动 app_ 规则。保存另一别名可覆盖它；清除后仍使用自动网址。', '呢個別名來自自動 app_ 規則。儲存另一個別名可覆蓋佢；清除後仍用自動網址。'],
    implicitFallback: ['Alias tulee varajärjestelmästä. Voit korvata sen tallentamalla toisen aliaksen.', 'This alias currently comes from the fallback safety net. Save a different alias to override it.', '此别名来自后备规则。保存另一别名可覆盖它。', '呢個別名來自後備規則。儲存另一個別名可覆蓋佢。'],
    storedPolicy: ['Tallennettu alias on käytössä. Sen poistaminen palauttaa automaattisen nimen, jos se on vapaa, tai varsinaisen osoitteen.', 'This public alias is active because it was saved explicitly. Clearing it returns to the automatic name when available, or the raw URL.', '已保存的别名正在使用。清除后将使用可用的自动名称或原始网址。', '已儲存嘅別名正使用中。清除後會用可用嘅自動名稱或原本網址。'],
    noChange: ['Ei tallennettavia muutoksia.', 'No changes to save.', '没有需要保存的更改。', '冇要儲存嘅更改。'],
    loadFailed: ['Aliasten hallintaa ei voitu ladata.', 'Loading dataset alias management failed', '无法加载别名管理。', '載入別名管理失敗。'],
    saveFailed: ['Aliaksen tallennus epäonnistui.', 'Saving dataset alias failed', '保存别名失败。', '儲存別名失敗。'],
    disabled: ['Poistetut käytöstä; aliastiedot on säilytetty', 'Disabled aliases; records preserved', '已停用别名；记录已保留', '已停用別名；記錄已保留'],
    dataset_namespace_conflict: ['Nimi kuuluu jo toiselle aineistolle tai varatulle osoitteelle. Valitse toinen nimi.', 'This name already belongs to another dataset or a reserved route. Choose another name.', '此名称已属于其他数据集或保留网址。请选择其他名称。', '呢個名稱已屬於另一個資料集或保留網址。請揀另一個名稱。'],
    dataset_namespace_invalid: ['Valitse kelvollinen aineiston nimi tai alias.', 'Choose a valid dataset name or alias.', '请选择有效的数据集名称或别名。', '請揀有效嘅資料集名稱或別名。'],
    dataset_namespace_retry: ['Aineistojen nimet muuttuivat toiminnon aikana. Yritä uudelleen.', 'Dataset names changed during this operation. Please retry.', '操作期间数据集名称发生了变化。请重试。', '操作期間資料集名稱有變。請再試。'],
    dataset_namespace_real_name_conflict: ['Alias on poistettu käytöstä, koska nimi kuuluu varsinaiselle aineistolle. Aliastiedot on säilytetty.', 'This alias was disabled because a real dataset owns the name. The alias record was preserved.', '此别名因名称属于真实数据集而被停用。别名记录已保留。', '呢個別名因名稱屬於真實資料集而停用。別名記錄已保留。'],
    dataset_namespace_automatic_conflict: ['Alias on poistettu käytöstä, koska nimi kuuluu toisen aineiston automaattiselle aliakselle. Aliastiedot on säilytetty.', 'This alias was disabled because another dataset reserves the automatic name. The alias record was preserved.', '此别名因名称被另一数据集自动保留而被停用。记录已保留。', '呢個別名因名稱被另一資料集自動保留而停用。記錄已保留。'],
    dataset_namespace_alias_conflict: ['Alias on poistettu käytöstä, koska useampi aliastieto käyttää samaa nimeä. Aliastiedot on säilytetty.', 'This alias was disabled because several alias records use the same name. The records were preserved.', '此别名因多条别名记录使用同一名称而被停用。记录已保留。', '呢個別名因多條別名記錄用同一名稱而停用。記錄已保留。'],
    dataset_alias_saved: ['Aineiston alias tallennettu.', 'Dataset alias saved', '数据集别名已保存。', '資料集別名已儲存。'],
    dataset_alias_cleared: ['Aineiston alias poistettu.', 'Dataset alias cleared', '数据集别名已清除。', '資料集別名已清除。'],
};

/** Loads the editor's preferred dictionary through the shared page request cache. */
export async function loadAliasTranslations() {
    const language = getLanguageWithBrowserFallback() || 'en';
    try {
        await Promise.all([...new Set([language, 'en'])].map(loadTranslationsForLanguage));
    } catch (error) {
        console.warn('dataset_alias_management_copy: translations unavailable', error);
    }
}

// Only existing seeded names are declared; the alias-prefixed fallback names
// have no seed entries. B4 must not create keys for those fallback lookups.
// lang-key-declaration: {"build":"`dataset_alias_editor_${key}`","keys":["dataset_namespace_conflict","dataset_namespace_invalid","dataset_namespace_retry","dataset_namespace_real_name_conflict","dataset_namespace_automatic_conflict","dataset_namespace_alias_conflict","dataset_alias_saved","dataset_alias_cleared"]}

/** Reads the stored editor language, which can differ from the public menu language. */
export function aliasCopy(key, values = {}) {
    const language = String(getLanguageWithBrowserFallback() || 'en').toLowerCase();
    const index = language.startsWith('fi') ? 0 : ['yue', 'zh-hk', 'zh-tw'].includes(language) ? 3
        : language === 'ch' || language.startsWith('zh') ? 2 : 1;
    const langKey = key.startsWith('dataset_') ? key : `dataset_alias_editor_${key}`;
    // Language tags preserve region case (zh-CN/zh-HK/zh-TW) in the shared cache.
    const text = getTranslationForKey(langKey, {
        language: getLanguageWithBrowserFallback() || 'en',
        fallback: COPY[key]?.[index] || COPY.saveFailed[index], countUsage: false,
    });
    return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, value), text);
}
