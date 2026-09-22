// dataset_header_config_translation_fallbacks.js
// Bootstrap copy for the dataset header settings screen, opened from a
// dataset's hero or from the admin tools.
// Bridges the screen with an installation whose language keys are still
// missing: the site's own reviewed translations always take precedence.
// Exists so every text on the screen has Finnish, English, Chinese (ch) and
// Cantonese (yue) copy. Shared keys the screen reuses carry the fresh-install
// copy of public_bootstrap/seed_data.sql, so both read the same. The
// `key: { fi: ... }` shape is one the startup language-key scan recognises.

const COPY = {
    // --- Keys shared with the rest of the application ---
    dataset_header_config: {
        fi: "Tietojoukko-otsikoiden asetukset",
        en: "Dataset header configuration",
        ch: "数据集标题配置",
        yue: "資料集標題設定",
    },
    close: { fi: "Sulje", en: "Close", ch: "关闭", yue: "關閉" },
    dataset: { fi: "Aineisto", en: "Dataset", ch: "数据集", yue: "資料集" },
    dataset_select_target: { fi: "Valitse aineisto", en: "Choose a dataset", ch: "选择数据集", yue: "選擇資料集" },
    search: { fi: "Haku", en: "Search", ch: "搜索", yue: "搜尋" },
    title: { fi: "Otsikko", en: "Title", ch: "标题", yue: "標題" },
    search_placeholder: { fi: "Hakupaikkamerkki", en: "Search placeholder", ch: "搜索占位文本", yue: "搜尋預留位置文字" },
    lang_key: { fi: "Avain", en: "Key", ch: "语言键", yue: "語言鍵" },
    usage_explanation: { fi: "Käyttöselite", en: "Usage explanation", ch: "使用说明", yue: "使用說明" },
    fi: { fi: "Suomi", en: "Finnish", ch: "芬兰语", yue: "芬蘭文" },
    en: { fi: "Englanti", en: "English", ch: "英语", yue: "英文" },
    ch: { fi: "Kiina", en: "Chinese", ch: "简体中文", yue: "簡體中文" },
    unsaved_changes: { fi: "Tallentamattomat muutokset", en: "Unsaved changes", ch: "未保存的更改", yue: "未儲存嘅變更" },
    save: { fi: "Tallenna", en: "Save", ch: "保存", yue: "儲存" },
    saved: { fi: "Tallennettu", en: "Saved", ch: "已保存", yue: "已儲存" },
    save_failed: { fi: "Tallennus epäonnistui.", en: "Save failed.", ch: "保存失败。", yue: "儲存失敗。" },

    // --- This screen's own keys ---
    dataset_header_config_intro: {
        fi: "Muokkaa tässä aineiston omia tekstejä: otsikkoa, iskulausetta ja hakukentän vihjetekstiä.",
        en: "Edit the dataset's own texts here: its title, slogan and search placeholder.",
        ch: "在此编辑数据集自己的文本：标题、标语和搜索占位文本。",
        yue: "喺度編輯資料集自己嘅文字：標題、標語同搜尋預留位置文字。",
    },
    dataset_header_config_text_keys: { fi: "Aineiston tekstit", en: "Dataset texts", ch: "数据集文本", yue: "資料集文字" },
    dataset_header_config_text_keys_hint: {
        fi: "Jokaisella tekstillä on valmis kieliavain, joka näkyy alla. Tallenna tänne käännökset ja tekoälylle tarkoitettu käyttöselite; aineistonäkymä käyttää näitä avaimia.",
        en: "Each text has a ready-made language key, shown below. Save its translations and the usage explanation for AI translation here; the dataset view keeps using these keys.",
        ch: "每段文本都有现成的语言键，显示在下方。请在此保存其翻译以及供 AI 翻译使用的使用说明；数据集视图会继续使用这些键。",
        yue: "每段文字都有現成嘅語言鍵，顯示喺下面。請喺度儲存佢嘅翻譯同埋畀 AI 翻譯用嘅使用說明；資料集檢視會繼續用呢啲鍵。",
    },
    dataset_header_config_slogan: { fi: "Iskulause", en: "Slogan", ch: "标语", yue: "標語" },
    dataset_header_config_usage_placeholder: {
        fi: "Kerro, mitä avain tarkoittaa ja missä sitä käytetään, jotta tekoäly osaa kääntää sen.",
        en: "Explain what this key means and where it is used, so AI translation gets it right.",
        ch: "说明此键的含义和用途，以便 AI 正确翻译。",
        yue: "講解呢個鍵嘅意思同用途，等 AI 翻譯得準確。",
    },
    dataset_header_config_cover_title: {
        fi: "Aineiston kansikuva",
        en: "Dataset cover image",
        ch: "数据集封面图片",
        yue: "資料集封面圖片",
    },
    dataset_header_config_cover_hint: {
        fi: "Näkyy aineiston otsikkoalueen taustalla. Kuva kuuluu vain valitulle aineistolle.",
        en: "Shown behind the dataset hero. The image belongs only to the selected dataset.",
        ch: "显示在数据集标题区域的背景中。图片只属于所选数据集。",
        yue: "顯示喺資料集標題區嘅背景。圖片只屬於所選資料集。",
    },
    dataset_header_config_background_title: {
        fi: "Aineiston sisällön tausta",
        en: "Dataset content background",
        ch: "数据集内容背景",
        yue: "資料集內容背景",
    },
    dataset_header_config_background_hint: {
        fi: "Näkyy hienovaraisesti tulosmäärän ja aineiston sisällön takana, kansikuvasta riippumatta.",
        en: "Shown subtly behind the result count and dataset content, independently of the hero cover.",
        ch: "淡淡地显示在结果数量和数据集内容后面，与封面图片无关。",
        yue: "淡淡咁顯示喺結果數目同資料集內容後面，同封面圖片無關。",
    },
    dataset_header_config_replace_image: { fi: "Vaihda kuva", en: "Replace image", ch: "更换图片", yue: "更換圖片" },
    dataset_header_config_remove_image: {
        fi: "Poista nykyinen kuva tallennettaessa",
        en: "Remove current image on save",
        ch: "保存时删除当前图片",
        yue: "儲存時刪除目前圖片",
    },
    dataset_header_config_no_image: {
        fi: "Kuvaa ei ole vielä ladattu.",
        en: "No image uploaded yet.",
        ch: "尚未上传图片。",
        yue: "仲未上載圖片。",
    },
    dataset_header_config_no_datasets: {
        fi: "Asetettavia aineistoja ei ole.",
        en: "No datasets available for header configuration.",
        ch: "没有可配置标题的数据集。",
        yue: "冇可以設定標題嘅資料集。",
    },
    dataset_header_config_not_loaded: {
        fi: "Tämän aineiston asetuksia ei saatu ladattua, joten tallennus on estetty, ettei toisen aineiston tekstejä tallennu sen päälle. Valitse aineisto uudelleen yrittääksesi uudestaan.",
        en: "This dataset's settings did not load, so saving is off to keep another dataset's texts from overwriting them. Choose the dataset again to retry.",
        ch: "此数据集的设置未能加载，因此已停用保存，以免其他数据集的文本覆盖它们。请重新选择该数据集以重试。",
        yue: "呢個資料集嘅設定載入唔到，所以已停用儲存，免得其他資料集嘅文字覆蓋佢哋。請重新揀選呢個資料集再試。",
    },
};

/** The copy in the { fi, en, ch, yue } shape the page translator's fallbacks use. */
export const DATASET_HEADER_CONFIG_TRANSLATION_FALLBACKS = Object.freeze(COPY);
