// embedding_status_translation_fallbacks.js
// Readable fi/en/ch/yue copy for the embedding admin page (status view and refresh controls) until its keys are seeded.
// Bridges the page's data-lang-key elements and toasts with the shared local fallback table.
// Exists so the page reads correctly in every interface language before the migration lands.

export const EMBEDDING_STATUS_TRANSLATION_FALLBACKS = Object.freeze({
    embedding_status_title: {
        fi: "Upotusten tila",
        en: "Embedding status",
        ch: "嵌入状态",
        yue: "嵌入狀態",
    },
    embedding_status_intro: {
        fi: "Tästä näet, mitkä aineistot on upotettu, kuinka kattavasti ja millä mallilla. Näkymä vain lukee tietoja.",
        en: "See which datasets are embedded, how completely and with which model. This view only reads.",
        ch: "查看哪些数据集已嵌入、覆盖程度以及使用的模型。此视图只读取数据。",
        yue: "睇吓邊啲資料集已經嵌入、覆蓋幾多，同埋用咗邊個模型。呢個畫面只會讀取資料。",
    },
    embedding_status_loading: {
        fi: "Luetaan upotusten tilaa…",
        en: "Reading the embedding status…",
        ch: "正在读取嵌入状态…",
        yue: "讀緊嵌入狀態…",
    },
    embedding_status_unavailable: {
        fi: "Upotusten tilaa ei voitu lukea.",
        en: "The embedding status could not be read.",
        ch: "无法读取嵌入状态。",
        yue: "讀取唔到嵌入狀態。",
    },
    embedding_status_empty: {
        fi: "Yhtään aineistoa ei löytynyt.",
        en: "No datasets found.",
        ch: "未找到数据集。",
        yue: "搵唔到資料集。",
    },
    embedding_status_provider: {
        fi: "Palvelu",
        en: "Provider",
        ch: "服务商",
        yue: "服務供應商",
    },
    embedding_status_model: {
        fi: "Malli",
        en: "Model",
        ch: "模型",
        yue: "模型",
    },
    embedding_status_dimensions: {
        fi: "$count ulottuvuutta",
        en: "$count dimensions",
        ch: "$count 维",
        yue: "$count 維",
    },
    embedding_status_key_configured: {
        fi: "API-avain asetettu",
        en: "API key configured",
        ch: "已配置 API 密钥",
        yue: "已設定 API 金鑰",
    },
    embedding_status_key_missing: {
        fi: "API-avain puuttuu",
        en: "API key missing",
        ch: "缺少 API 密钥",
        yue: "欠缺 API 金鑰",
    },
    embedding_status_column_dataset: {
        fi: "Aineisto",
        en: "Dataset",
        ch: "数据集",
        yue: "資料集",
    },
    embedding_status_column_state: {
        fi: "Tila",
        en: "State",
        ch: "状态",
        yue: "狀態",
    },
    embedding_status_column_rows: {
        fi: "Upotetut rivit",
        en: "Embedded rows",
        ch: "已嵌入的行",
        yue: "已嵌入嘅行",
    },
    embedding_status_column_changed: {
        fi: "Muuttunut upotuksen jälkeen",
        en: "Changed since embedding",
        ch: "嵌入后已更改",
        yue: "嵌入之後有改動",
    },
    embedding_status_changed_hint: {
        fi: "Rivit, joita on muokattu kieliupotuksen luomisen jälkeen. Upotus ei ehkä enää vastaa niiden sisältöä.",
        en: "Rows edited after their language embedding was made. The embedding may no longer match them.",
        ch: "在语言嵌入生成后被编辑的行。嵌入可能已不再与其内容相符。",
        yue: "語言嵌入整好之後再被改過嘅行。嵌入可能已經唔再啱佢哋嘅內容。",
    },
    embedding_status_column_languages: {
        fi: "Kielet",
        en: "Languages",
        ch: "语言",
        yue: "語言",
    },
    embedding_status_column_refreshed: {
        fi: "Viimeksi päivitetty",
        en: "Last refreshed",
        ch: "上次刷新",
        yue: "上次更新",
    },
    embedding_status_column_automatic: {
        fi: "Päivittyy rivin muuttuessa",
        en: "Updates when a row changes",
        ch: "行更改时自动更新",
        yue: "行有改動時自動更新",
    },
    embedding_status_state_embedded: {
        fi: "Upotettu",
        en: "Embedded",
        ch: "已嵌入",
        yue: "已嵌入",
    },
    embedding_status_state_partial: {
        fi: "Osittain upotettu",
        en: "Partly embedded",
        ch: "部分嵌入",
        yue: "部分嵌入",
    },
    embedding_status_state_none: {
        fi: "Ei upotettu",
        en: "Not embedded",
        ch: "未嵌入",
        yue: "未嵌入",
    },
    embedding_status_state_unavailable: {
        fi: "Tila ei saatavilla",
        en: "Status unavailable",
        ch: "状态不可用",
        yue: "狀態唔可用",
    },
    embedding_status_rows_without: {
        fi: "$count ilman upotusta",
        en: "$count without an embedding",
        ch: "$count 行没有嵌入",
        yue: "$count 行未有嵌入",
    },
    embedding_status_not_tracked: {
        fi: "Ei seurata",
        en: "Not tracked",
        ch: "未跟踪",
        yue: "冇追蹤",
    },
    embedding_status_not_tracked_hint: {
        fi: "Yleiselle upotukselle ei tallenneta aikaa, joten sen ikää tai rivin myöhempiä muutoksia ei tiedetä.",
        en: "The general embedding stores no time, so its age and later row changes are unknown.",
        ch: "通用嵌入不记录时间，因此无法得知其生成时间以及之后的行更改。",
        yue: "通用嵌入冇記錄時間，所以唔知佢幾時整，亦唔知之後行有冇改動。",
    },
    embedding_status_general_embedding: {
        fi: "Yleinen, kaikki kielet yhdessä",
        en: "General, all languages together",
        ch: "通用，所有语言合并",
        yue: "通用，所有語言合埋",
    },
    embedding_status_current_model: {
        fi: "Nykyinen malli",
        en: "Current model",
        ch: "当前模型",
        yue: "而家嘅模型",
    },
    embedding_status_other_model: {
        fi: "$count tehty toisella mallilla",
        en: "$count made with another model",
        ch: "$count 个由其他模型生成",
        yue: "$count 個由其他模型整",
    },
    embedding_status_other_model_hint: {
        fi: "Nämä upotukset eivät vastaa nykyistä mallia, joten haku ei voi verrata niitä. Luo ne uudelleen.",
        en: "These embeddings do not match the current model, so search cannot compare them. Create them again.",
        ch: "这些嵌入与当前模型不匹配，搜索无法比较它们。请重新生成。",
        yue: "呢啲嵌入同而家嘅模型唔夾，搜尋冇辦法比較。請重新整過。",
    },
    embedding_status_orphans: {
        fi: "$count poistettujen rivien upotusta",
        en: "$count embeddings of deleted rows",
        ch: "$count 个已删除行的嵌入",
        yue: "$count 個已刪除行嘅嵌入",
    },
    embedding_status_automatic_on: {
        fi: "Kyllä",
        en: "Yes",
        ch: "是",
        yue: "係",
    },
    embedding_status_blocker_no_embedding_storage: {
        fi: "Ei – aineistolla ei ole upotuksia",
        en: "No – the dataset has no embeddings",
        ch: "否 – 数据集没有嵌入",
        yue: "唔會 – 資料集冇嵌入",
    },
    embedding_status_blocker_provider_sending_disabled: {
        fi: "Ei – ulkoiset upotukset eivät ole käytössä tälle taululle",
        en: "No – external embeddings are not enabled for this table",
        ch: "否 – 此表未启用外部嵌入",
        yue: "唔會 – 呢個資料表未啟用外部嵌入",
    },
    embedding_status_blocker_no_approved_fields: {
        fi: "Ei – yhtään kenttää ei ole sallittu lähetettäväksi",
        en: "No – no fields are approved for sending",
        ch: "否 – 没有允许发送的字段",
        yue: "唔會 – 冇批准傳送嘅欄位",
    },
    embedding_status_blocker_queue_unavailable: {
        fi: "Ei – päivitysjono puuttuu",
        en: "No – the refresh queue is missing",
        ch: "否 – 缺少刷新队列",
        yue: "唔會 – 欠缺更新隊列",
    },
    embedding_status_pending: {
        fi: "$count odottaa",
        en: "$count waiting",
        ch: "$count 个等待中",
        yue: "$count 個等緊",
    },
    embedding_status_failing: {
        fi: "$count epäonnistunut",
        en: "$count failing",
        ch: "$count 个失败",
        yue: "$count 個失敗",
    },

    // The administrator's own key form, shown only when no key is configured.
    embedding_key_setup_title: {
        fi: "Lisää palvelun API-avain",
        en: "Add the provider's API key",
        ch: "添加服务商的 API 密钥",
        yue: "加入服務供應商嘅 API 金鑰",
    },
    embedding_key_setup_explanation: {
        fi: "Upotus tarvitsee yllä näkyvän palvelun avaimen. Liitä avain tähän, niin tämä asennus ottaa sen heti käyttöön.",
        en: "Embedding needs a key from the provider named above. Paste one here and this installation starts using it at once.",
        ch: "嵌入需要上面所示服务商的密钥。把密钥粘贴到这里，本安装会立即开始使用。",
        yue: "嵌入需要上面嗰個服務供應商嘅金鑰。將金鑰貼喺呢度，呢個安裝就會即刻開始用。",
    },
    embedding_key_setup_privacy: {
        fi: "Palvelulle lähetetään vain alla hyväksytyt aineiston kentät tekstinä, jotta niistä saadaan hakuvektorit. Avain tallennetaan tämän asennuksen suojattuihin asetuksiin eikä sitä koskaan lähetetä selaimeen.",
        en: "Only the dataset fields approved below are sent to the provider, as text, to be turned into search vectors. The key itself is stored in this installation's protected settings and is never sent to a browser.",
        ch: "只有下方已批准的数据集字段会以文本形式发送给服务商，用于生成搜索向量。密钥保存在本安装的受保护设置中，绝不会发送到浏览器。",
        yue: "只有下面已批准嘅資料集欄位會以文字形式傳畀服務供應商，用嚟整搜尋向量。金鑰會存喺呢個安裝嘅受保護設定，永遠唔會傳去瀏覽器。",
    },
    embedding_key_setup_field_label: {
        fi: "API-avain",
        en: "API key",
        ch: "API 密钥",
        yue: "API 金鑰",
    },
    embedding_key_setup_where: {
        fi: "Mistä avain haetaan",
        en: "Where to get a key",
        ch: "在哪里获取密钥",
        yue: "去邊度攞金鑰",
    },
    embedding_key_setup_save: {
        fi: "Tallenna avain",
        en: "Save key",
        ch: "保存密钥",
        yue: "儲存金鑰",
    },
    embedding_key_setup_saving: {
        fi: "Tallennetaan…",
        en: "Saving…",
        ch: "正在保存…",
        yue: "儲存緊…",
    },
    embedding_key_setup_saved: {
        fi: "Avain tallennettu. Sivusto käyttää sitä nyt.",
        en: "Key saved. This site now uses it.",
        ch: "密钥已保存，本站点现已使用。",
        yue: "金鑰已儲存，網站而家開始用緊。",
    },
    embedding_key_setup_required: {
        fi: "Liitä API-avain ensin.",
        en: "Paste the API key first.",
        ch: "请先粘贴 API 密钥。",
        yue: "請先貼上 API 金鑰。",
    },
    embedding_key_setup_rejected: {
        fi: "Arvo hylättiin eikä mitään muutettu. Tarkista, että liitit koko avaimen yhdelle riville.",
        en: "The value was refused and nothing was changed. Check that you pasted the whole key on one line.",
        ch: "该值被拒绝，未作任何更改。请检查是否把整个密钥粘贴在同一行。",
        yue: "個值俾拒絕咗，冇改過任何嘢。請檢查係咪成條金鑰貼晒喺同一行。",
    },
    embedding_key_setup_not_writable: {
        fi: "Tämä asennus säilyttää asetuksensa sovelluksen ulkopuolella, joten avainta ei voitu tallentaa täältä. Mitään ei muutettu. Lisää avain sinne, missä sivuston asetuksia säilytetään, ja käynnistä sovellus uudelleen.",
        en: "This installation keeps its settings outside the application, so the key could not be saved from here. Nothing was changed. Add the key where the site's settings are kept, then restart the application.",
        ch: "本安装的设置保存在应用之外，因此无法从这里保存密钥。未作任何更改。请在站点设置所在之处添加密钥，然后重启应用。",
        yue: "呢個安裝嘅設定擺喺應用程式外面，所以喺呢度儲存唔到金鑰。冇改過任何嘢。請喺網站設定嗰度加入金鑰，然後重新啟動應用程式。",
    },
    embedding_key_setup_failed: {
        fi: "Avainta ei voitu tallentaa. Mitään ei muutettu.",
        en: "The key could not be saved. Nothing was changed.",
        ch: "无法保存密钥。未作任何更改。",
        yue: "儲存唔到金鑰。冇改過任何嘢。",
    },
    embedding_key_setup_never_shown: {
        fi: "Tallennettua avainta ei koskaan näytetä tässä. Sivu kertoo vain, onko avain olemassa.",
        en: "A saved key is never shown here. This page only says whether one exists.",
        ch: "已保存的密钥绝不会在此显示。本页面只说明是否存在密钥。",
        yue: "已儲存嘅金鑰永遠唔會喺呢度顯示。呢版只會話你知有冇金鑰。",
    },

    // The refresh controls below the status view.
    embedding_refresh_rows_to_process: {
        fi: "Käsiteltäviä rivejä: $count",
        en: "Rows to process: $count",
        ch: "待处理行数：$count",
        yue: "待處理行數：$count",
    },
    embedding_refresh_loading: {
        fi: "Ladataan…",
        en: "Loading…",
        ch: "正在加载…",
        yue: "載入緊…",
    },
    embedding_refresh_field_policy_unavailable: {
        fi: "Kenttävalintaa ei voitu lukea",
        en: "The field selection could not be read",
        ch: "无法读取字段选择",
        yue: "讀取唔到欄位選擇",
    },
    embedding_refresh_no_eligible_fields: {
        fi: "Ei sopivia tekstikenttiä",
        en: "No eligible text fields",
        ch: "没有符合条件的文本字段",
        yue: "冇合資格嘅文字欄位",
    },
    embedding_refresh_start: {
        fi: "Aloita upotus",
        en: "Start embedding",
        ch: "开始嵌入",
        yue: "開始嵌入",
    },
    embedding_refresh_done: {
        fi: "Upotukset päivitetty",
        en: "Embeddings refreshed",
        ch: "嵌入已刷新",
        yue: "嵌入已更新",
    },
});

/**
 * The English copy for a key, with `$count` filled in. It is only the first
 * paint: the page's translator replaces it with the reader's language as soon
 * as the element carrying the key is added.
 *
 * @param {string} langKey
 * @param {string|number|null} [variable=null]
 * @returns {string}
 */
export function englishEmbeddingAdminCopy(langKey, variable = null) {
    const copy = EMBEDDING_STATUS_TRANSLATION_FALLBACKS[langKey]?.en ?? langKey;
    return variable === null ? copy : copy.split("$count").join(String(variable));
}

/**
 * Creates an element whose text comes from a language key, `$count` filled from
 * variable. Every surface of the embedding admin page builds its words this
 * way, so the shared fallback table above is the only English on the page.
 *
 * @param {string} tagName
 * @param {string} langKey
 * @param {string|number|null} [variable=null]
 * @returns {HTMLElement}
 */
export function keyedElement(tagName, langKey, variable = null) {
    const element = document.createElement(tagName);
    element.dataset.langKey = variable === null ? langKey : `${langKey}+${variable}`;
    element.textContent = englishEmbeddingAdminCopy(langKey, variable);
    return element;
}
