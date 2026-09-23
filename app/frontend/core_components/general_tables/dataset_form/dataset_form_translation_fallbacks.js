// dataset_form_translation_fallbacks.js
// Bootstrap copy for the one dataset form, in both of its modes (creating a
// dataset and editing one in its Manage table dialog), its setting controls,
// its column table and the dataset removal dialog it opens.
// Bridges the form with an installation whose language keys are still missing:
// the site's own reviewed translations always take precedence over these.
// Exists so every text the form shows has Finnish, English, Chinese (ch) and
// Cantonese (yue) copy in one place, instead of one file per form.
// A {name} placeholder is filled by the form (datasetFormText), never by a translator.

const COPY = {
    // --- The dataset itself ---
    table_name: { fi: "Aineiston nimi", en: "Dataset name", ch: "数据集名称", yue: "資料集名稱" },
    create_dataset_route_hint: {
        fi: "Aineiston nimi varaa myös URL-osoitteen. Käytä yksilöllistä nimeä; app_-alkuiset nimet varaavat myös osoitteen ilman app_-etuliitettä.",
        en: "The dataset name also reserves its URL. Use a unique name; app_ names also reserve the URL without the app_ prefix.",
        ch: "数据集名称也用于保留其网址。请使用唯一名称；app_ 开头的名称还会保留不含 app_ 前缀的网址。",
        yue: "資料集名稱亦會保留網址。請用唯一名稱；app_ 開頭嘅名稱亦會保留冇 app_ 前綴嘅網址。",
    },
    manage_table_title: { fi: "Hallitse aineistoa", en: "Manage table", ch: "管理数据表", yue: "管理資料表" },

    // --- Folder ---
    folder: { fi: "Kansio", en: "Folder", ch: "文件夹", yue: "資料夾" },
    select_folder: { fi: "Valitse kansio", en: "Choose a folder", ch: "选择文件夹", yue: "選擇資料夾" },
    dataset_folder_for_new_dataset: {
        fi: "Valitse kansio uudelle taululle",
        en: "Choose a folder for the new dataset",
        ch: "为新数据集选择文件夹",
        yue: "為新資料集選擇資料夾",
    },
    dataset_folder_option_current_project: {
        fi: "{folder} (nykyinen projekti)",
        en: "{folder} (current project)",
        ch: "{folder}（当前项目）",
        yue: "{folder}（目前項目）",
    },
    table_folder_hint: {
        fi: "Uusi aineisto tallennetaan oletuksena nykyisen projektin kansioon, jolloin se näkyy sivuston navigaatiossa. Jos projektia ei ole valittu, oletus on database / other_tables. Muiden kansioiden aineistot eivät näy navigaatiossa.",
        en: "By default a new dataset goes into the current project's folder, where it appears in the site navigation. Without a current project the default is database / other_tables. Datasets in other folders do not appear in the navigation.",
        ch: "新数据集默认放入当前项目的文件夹，并显示在网站导航中。如果没有当前项目，默认文件夹为 database / other_tables。其他文件夹中的数据集不会显示在导航中。",
        yue: "新資料集預設會放入目前項目嘅資料夾，並會喺網站導覽顯示。如果冇目前項目，預設資料夾係 database / other_tables。其他資料夾入面嘅資料集唔會喺導覽顯示。",
    },
    dataset_new_folder_open: { fi: "Uusi kansio…", en: "New folder…", ch: "新建文件夹…", yue: "新增資料夾…" },
    dataset_new_folder_cancel: { fi: "Älä luo uutta kansiota", en: "Don't create a new folder", ch: "不新建文件夹", yue: "唔新增資料夾" },
    new_folder_name: { fi: "Uuden kansion nimi", en: "New folder name", ch: "新文件夹名称", yue: "新資料夾名稱" },
    dataset_new_folder_parent: {
        fi: "Uuden kansion yläkansio",
        en: "Parent folder of the new folder",
        ch: "新文件夹的上级文件夹",
        yue: "新資料夾嘅上層資料夾",
    },
    root_folder: { fi: "Juurikansio", en: "Root folder", ch: "根文件夹", yue: "根資料夾" },
    dataset_new_folder_name_required: {
        fi: "Anna uudelle kansiolle nimi tai valitse, ettei uutta kansiota luoda.",
        en: "Name the new folder, or choose not to create one.",
        ch: "请为新文件夹命名，或选择不新建文件夹。",
        yue: "請為新資料夾命名，或者揀唔新增資料夾。",
    },
    dataset_folder_unavailable: {
        fi: "Kansioita ei voitu lukea.",
        en: "The folders could not be read.",
        ch: "无法读取文件夹。",
        yue: "讀取唔到資料夾。",
    },
    dataset_folder_save_failed: {
        fi: "Kansion tallennus epäonnistui.",
        en: "The folder could not be saved.",
        ch: "无法保存文件夹。",
        yue: "儲存唔到資料夾。",
    },
    dataset_folder_move_anyway: { fi: "Siirrä silti", en: "Move anyway", ch: "仍然移动", yue: "照樣移動" },

    // --- Symbol ---
    dataset_symbol_label: { fi: "Symboli", en: "Symbol", ch: "图标", yue: "圖示" },
    dataset_symbol_none: { fi: "Ei symbolia", en: "No symbol", ch: "无图标", yue: "冇圖示" },
    dataset_symbol_choose: { fi: "Valitse symboli", en: "Choose a symbol", ch: "选择图标", yue: "揀一個圖示" },
    dataset_symbol_search: { fi: "Hae symbolia…", en: "Search symbols…", ch: "搜索图标…", yue: "搵圖示…" },
    dataset_symbol_loading: { fi: "Luetaan symboleja…", en: "Reading the symbols…", ch: "正在读取图标…", yue: "正在讀取圖示…" },
    dataset_symbol_unavailable: {
        fi: "Symboleja ei voitu lukea.",
        en: "The symbols could not be read.",
        ch: "无法读取图标。",
        yue: "讀取唔到圖示。",
    },
    dataset_symbol_save_failed: {
        fi: "Symbolin tallennus epäonnistui.",
        en: "The symbol could not be saved.",
        ch: "无法保存图标。",
        yue: "儲存唔到圖示。",
    },

    // --- Dataset settings ---
    create_table_enable_images: {
        fi: "Salli kuvien lataaminen aineistoon",
        en: "Enable image uploads for this dataset",
        ch: "允许向此数据集上传图片",
        yue: "容許上載圖片到呢個資料集",
    },
    dataset_images_unavailable: {
        fi: "Kuva-asetusta ei voitu lukea.",
        en: "The picture setting could not be read.",
        ch: "无法读取图片设置。",
        yue: "讀取唔到圖片設定。",
    },
    dataset_images_save_failed: {
        fi: "Kuva-asetuksen tallennus epäonnistui.",
        en: "The picture setting could not be saved.",
        ch: "无法保存图片设置。",
        yue: "儲存唔到圖片設定。",
    },
    prevent_table_deletion_hosting_request: {
        fi: "Salli poistaminen vain ylläpidon kautta",
        en: "Allow deletion only through hosting support",
        ch: "仅允许托管支持删除",
        yue: "只容許託管支援刪除",
    },
    dataset_deletion_protection_unavailable: {
        fi: "Poistosuojausta ei voitu lukea.",
        en: "The deletion protection could not be read.",
        ch: "无法读取删除保护。",
        yue: "讀取唔到刪除保護。",
    },
    manage_table_multilingual_default: {
        fi: "Uudet tekstisarakkeet ovat oletuksena monikielisiä",
        en: "New text columns are multilingual by default",
        ch: "新文本列默认支持多语言",
        yue: "新文字欄位預設支援多語言",
    },

    // --- Reading rights ---
    default_permissions: { fi: "Oletusoikeudet", en: "Default permissions", ch: "默认权限", yue: "預設權限" },
    grant_users_read: { fi: "Anna käyttäjille lukuoikeus", en: "Allow users to read", ch: "允许用户读取", yue: "允許用戶讀取" },
    grant_guests_read: { fi: "Anna vieraille lukuoikeus", en: "Allow guests to read", ch: "允许访客读取", yue: "允許訪客讀取" },
    dataset_permissions_loading: { fi: "Luetaan lukuoikeuksia…", en: "Reading the rights…", ch: "正在读取权限…", yue: "正在讀取權限…" },
    dataset_permissions_unavailable: {
        fi: "Lukuoikeuksia ei voitu lukea.",
        en: "The rights could not be read.",
        ch: "无法读取权限。",
        yue: "讀取唔到權限。",
    },
    dataset_permissions_save_failed: {
        fi: "Lukuoikeuksien tallennus epäonnistui.",
        en: "The rights could not be saved.",
        ch: "无法保存权限。",
        yue: "儲存唔到權限。",
    },

    // --- Columns ---
    card_role_hint: {
        fi: "Rooli ohjaa sarakkeen käyttöä korteissa ja artikkeleissa. Voit muuttaa sitä myöhemmin korttien kenttäasetuksista.",
        en: "The role controls how a column is used in cards and articles. You can change it later in card field settings.",
        ch: "角色控制列在卡片和文章中的用途。稍后可在卡片字段设置中更改。",
        yue: "角色控制欄位喺卡片同文章入面嘅用途。之後可以喺卡片欄位設定更改。",
    },
    column_name: { fi: "Sarakkeen nimi", en: "Column name", ch: "列名", yue: "欄位名稱" },
    data_type: { fi: "Tietotyyppi", en: "Data type", ch: "数据类型", yue: "資料類型" },
    length: { fi: "Pituus", en: "Length", ch: "长度", yue: "長度" },
    dataset_column_type_parameters: { fi: "Pituus / tarkkuus", en: "Length / precision", ch: "长度 / 精度", yue: "長度 / 精度" },
    card_role: { fi: "Rooli kortissa", en: "Card role", ch: "卡片角色", yue: "卡片角色" },
    manage_table_column_multilingual: {
        fi: "Monikielinen tekstisarake",
        en: "Multilingual text column",
        ch: "多语言文本列",
        yue: "多語言文字欄位",
    },
    actions: { fi: "Toiminnot", en: "Actions", ch: "操作", yue: "操作" },
    select_data_type: { fi: "Valitse tietotyyppi", en: "Choose a data type", ch: "选择数据类型", yue: "選擇資料類型" },
    add_column: { fi: "Lisää sarake", en: "Add column", ch: "添加列", yue: "新增欄位" },
    delete: { fi: "Poista", en: "Remove", ch: "移除", yue: "移除" },

    // --- Links to other datasets ---
    dataset_foreign_keys_title: {
        fi: "Linkit toisiin aineistoihin",
        en: "Links to other datasets",
        ch: "与其他数据集的链接",
        yue: "同其他資料集嘅連結",
    },
    dataset_foreign_keys_none: {
        fi: "Tällä aineistolla ei ole vielä linkkejä.",
        en: "This dataset has no links yet.",
        ch: "此数据集还没有链接。",
        yue: "呢個資料集仲未有連結。",
    },
    dataset_foreign_keys_unavailable: {
        fi: "Linkkejä ei voitu lukea.",
        en: "The links could not be read.",
        ch: "无法读取链接。",
        yue: "讀取唔到連結。",
    },
    dataset_foreign_key_save_failed: {
        fi: "Linkin lisääminen epäonnistui.",
        en: "The link could not be added.",
        ch: "无法添加链接。",
        yue: "加唔到連結。",
    },
    connect_two_fields: { fi: "Yhdistä kaksi kenttää", en: "Connect two fields", ch: "连接两个字段", yue: "連接兩個欄位" },
    connect_two_fields_explain: {
        fi: "Mitä kahden kentän yhdistäminen tarkoittaa?",
        en: "What does connecting two fields mean?",
        ch: "连接两个字段是什么意思？",
        yue: "連接兩個欄位係咩意思？",
    },
    connect_two_fields_explanation: {
        fi: "Tämän aineiston rivi osoittaa toisen aineiston riviin, jolloin toisen rivin tiedot voidaan näyttää tässä ja arvo pysyy kelvollisena (viiteavain).",
        en: "A row of this dataset points at a row of another dataset, so the other row's information can be shown here and the value stays valid (foreign key).",
        ch: "本数据集中的一行指向另一个数据集中的一行，这样就能在这里显示另一行的信息，并且该值始终有效（外键）。",
        yue: "呢個資料集嘅一行會指向另一個資料集嘅一行，噉就可以喺呢度顯示嗰行嘅資料，個值亦會一直有效（外鍵）。",
    },
    referencing_column: { fi: "Viittaava sarake", en: "Referencing column", ch: "引用列", yue: "參照欄位" },
    referenced_table: { fi: "Viitattava aineisto", en: "Referenced dataset", ch: "被引用的数据集", yue: "被參照資料集" },
    referenced_column: { fi: "Viitattava sarake", en: "Referenced column", ch: "被引用的列", yue: "被參照欄位" },
    select_column: { fi: "Valitse sarake", en: "Choose a column", ch: "选择列", yue: "選擇欄位" },
    dataset_select_target: { fi: "Valitse aineisto", en: "Choose a dataset", ch: "选择数据集", yue: "選擇資料集" },

    // --- Checks before a new dataset is sent ---
    table_name_required: {
        fi: "Aineiston nimi on pakollinen.",
        en: "A dataset name is required.",
        ch: "必须填写数据集名称。",
        yue: "必須填寫資料集名稱。",
    },
    invalid_table_name_chars: {
        fi: "Nimessä saa käyttää kirjaimia A–Z, numeroita ja alaviivaa.",
        en: "Use letters A–Z, numbers and underscores in the name.",
        ch: "名称中请使用字母 A–Z、数字和下划线。",
        yue: "名稱請用字母 A–Z、數字同底線。",
    },
    invalid_column_name: {
        fi: "Sarakkeen nimessä saa käyttää kirjaimia A–Z, numeroita ja alaviivaa.",
        en: "Use letters A–Z, numbers and underscores in column names.",
        ch: "列名中请使用字母 A–Z、数字和下划线。",
        yue: "欄位名稱請用字母 A–Z、數字同底線。",
    },
    missing_data_type: {
        fi: "Valitse sarakkeen tietotyyppi.",
        en: "Choose a data type for the column.",
        ch: "请选择列的数据类型。",
        yue: "請選擇欄位嘅資料類型。",
    },
    duplicate_column_name: {
        fi: "Sarakkeiden nimien on oltava yksilöllisiä.",
        en: "Column names must be unique.",
        ch: "列名必须唯一。",
        yue: "欄位名稱必須唯一。",
    },
    invalid_card_role: {
        fi: "Valitse tuettu korttirooli.",
        en: "Choose a supported card role.",
        ch: "请选择受支持的卡片角色。",
        yue: "請選擇支援嘅卡片角色。",
    },
    add_at_least_one_column: {
        fi: "Lisää vähintään yksi sarake.",
        en: "Add at least one column.",
        ch: "请至少添加一列。",
        yue: "請最少新增一個欄位。",
    },

    // --- Creating ---
    create_table: { fi: "Luo aineisto", en: "Create dataset", ch: "创建数据集", yue: "建立資料集" },
    dataset_created_in_folder: {
        fi: "Aineisto {dataset} luotiin kansioon {folder}.",
        en: "Dataset {dataset} was created in the folder {folder}.",
        ch: "数据集 {dataset} 已创建在文件夹 {folder} 中。",
        yue: "資料集 {dataset} 已經建立喺資料夾 {folder}。",
    },
    dataset_created_outside_navigation: {
        fi: "Se ei näy sivuston navigaatiossa, koska navigaatio näyttää vain nykyisen projektin kansiossa suoraan olevat aineistot. Voit siirtää sen aineiston hallinnasta.",
        en: "It will not appear in the site navigation, which lists only the datasets directly in the current project's folder. You can move it in the dataset's Manage table dialog.",
        ch: "它不会显示在网站导航中，因为导航只列出直接位于当前项目文件夹中的数据集。您可以在数据集的管理窗口中移动它。",
        yue: "佢唔會喺網站導覽顯示，因為導覽只會列出直接喺目前項目資料夾入面嘅資料集。你可以喺資料集嘅管理視窗移動佢。",
    },
    dataset_created_settings_need_attention: {
        fi: "Aineisto luotiin, mutta yksi sen asetuksista jäi tallentamatta – katso lomakkeen viesti. Voit tallentaa asetuksen aineiston hallinnasta.",
        en: "The dataset was created, but one of its settings was not saved — see the message in the form. You can save it in the dataset's Manage table dialog.",
        ch: "数据集已创建，但其中一项设置未能保存——请查看表单中的提示。您可以在数据集的管理窗口中保存该设置。",
        yue: "資料集已經建立，但其中一項設定儲存唔到——請睇表單入面嘅訊息。你可以喺資料集嘅管理視窗儲存呢項設定。",
    },
    dataset_open: { fi: "Avaa aineisto", en: "Open dataset", ch: "打开数据集", yue: "開啟資料集" },
    table_created_image_setup_failed: {
        fi: "Aineisto luotiin, mutta kuvien käyttöönotto epäonnistui. Voit yrittää uudelleen liitteiden asetuksista.",
        en: "The dataset was created, but images could not be enabled. Retry from asset linking.",
        ch: "数据集已创建，但无法启用图片。请在附件关联设置中重试。",
        yue: "已建立資料集，但啟用圖片失敗。請喺附件連結設定重試。",
    },

    // --- Editing ---
    manage_table_cancel: { fi: "Peruuta", en: "Cancel", ch: "取消", yue: "取消" },
    manage_table_delete: { fi: "Poista", en: "Delete", ch: "删除", yue: "刪除" },
    manage_table_save: { fi: "Tallenna", en: "Save", ch: "保存", yue: "儲存" },
    manage_table_saved: { fi: "Muutokset tallennettu.", en: "Changes saved.", ch: "更改已保存。", yue: "變更已儲存。" },
    manage_table_save_failed: {
        fi: "Muutosten tallentaminen epäonnistui. Tarkista tiedot ja yritä uudelleen.",
        en: "Could not save changes. Check the values and try again.",
        ch: "无法保存更改。请检查内容后重试。",
        yue: "無法儲存變更。請檢查內容後再試。",
    },
    manage_table_settings_need_attention: {
        fi: "Sarakkeet tallennettiin. Yksi aineiston asetus jäi kesken – katso lomakkeen viesti.",
        en: "The columns were saved. One dataset setting still needs attention — see the message in the form.",
        ch: "列已保存。还有一项数据集设置需要处理，请查看表单中的提示。",
        yue: "欄位已經儲存。仲有一項資料集設定要處理，請睇表單入面嘅訊息。",
    },
    manage_table_visibility_loading: {
        fi: "Tarkistetaan näkyvyyttä…",
        en: "Checking visibility…",
        ch: "正在检查显示状态…",
        yue: "正在檢查顯示狀態…",
    },
    manage_table_visibility_failed: {
        fi: "Näkyvyyden tarkistaminen epäonnistui. Avaa hallinta uudelleen ja yritä uudelleen.",
        en: "Could not check visibility. Reopen Manage table and try again.",
        ch: "无法检查显示状态。请重新打开管理窗口后重试。",
        yue: "無法檢查顯示狀態。請重新開啟管理視窗後再試。",
    },
    manage_table_hidden: {
        fi: "Piilotettu käyttöliittymästä. Tiedot ovat tallessa; ylläpitäjät voivat hallita aineistoa.",
        en: "Hidden from the interface. Data is preserved; administrators can still manage the table.",
        ch: "已从界面隐藏。数据已保留，管理员仍可管理此表。",
        yue: "已喺介面隱藏。資料仍然保留，管理員仍可管理資料表。",
    },
    manage_table_restore: { fi: "Palauta käyttöliittymään", en: "Restore to interface", ch: "恢复界面显示", yue: "恢復喺介面顯示" },
    manage_table_restored: {
        fi: "Aineisto palautettu käyttöliittymään.",
        en: "Table restored to the interface.",
        ch: "已恢复数据表的界面显示。",
        yue: "已恢復資料表喺介面顯示。",
    },
    manage_table_restore_failed: {
        fi: "Palautus epäonnistui. Yritä uudelleen.",
        en: "Could not restore the table. Try again.",
        ch: "无法恢复数据表。请重试。",
        yue: "無法恢復資料表。請再試。",
    },

    // --- Removing the dataset (the removal dialog the form opens) ---
    manage_table_delete_title: { fi: "Poista aineisto", en: "Delete table", ch: "删除数据表", yue: "刪除資料表" },
    manage_table_delete_mode: { fi: "Poistotapa", en: "Deletion mode", ch: "删除方式", yue: "刪除方式" },
    manage_table_hide: { fi: "Poista käyttöliittymästä", en: "Delete from UI", ch: "从界面移除", yue: "喺介面移除" },
    manage_table_hide_help: {
        fi: "Tiedot säilyvät. Aineisto piilotetaan tavallisilta käyttäjiltä myös suoralla osoitteella. Ylläpitäjä voi palauttaa sen tästä hallinnasta.",
        en: "Data is preserved. The table is hidden from ordinary users, including direct links. An administrator can restore it in Manage table.",
        ch: "数据将保留。普通用户无法在界面或通过直接链接访问此表。管理员可在管理窗口中恢复显示。",
        yue: "資料會保留。一般使用者喺介面或經直接連結都睇唔到資料表。管理員可喺管理視窗恢復顯示。",
    },
    manage_table_permanent: { fi: "Poista pysyvästi", en: "Delete permanently", ch: "永久删除", yue: "永久刪除" },
    manage_table_permanent_help: {
        fi: "Taulu ja sen tiedot poistetaan pysyvästi. Tätä toimintoa ei voi perua.",
        en: "The table and its data will be permanently deleted. This cannot be undone.",
        ch: "数据表及其数据将被永久删除。此操作无法撤销。",
        yue: "資料表同當中資料會永久刪除。此操作無法復原。",
    },
    manage_table_confirm_name: {
        fi: "Vahvista kirjoittamalla yllä näkyvä taulun nimi täsmälleen.",
        en: "Type the exact table name shown above to confirm.",
        ch: "请输入上方显示的完整数据表名称以确认。",
        yue: "請輸入上方顯示嘅完整資料表名稱確認。",
    },
    manage_table_delete_failed: {
        fi: "Poisto epäonnistui. Aineiston poistoa ei vahvistettu. Yritä uudelleen.",
        en: "Deletion failed. The table deletion was not confirmed. Try again.",
        ch: "删除失败，未确认数据表已删除。请重试。",
        yue: "刪除失敗，未確認資料表已刪除。請再試。",
    },
    manage_table_hidden_success: {
        fi: "Aineisto poistettu käyttöliittymästä. Tiedot säilyvät.",
        en: "Table removed from the interface. Data is preserved.",
        ch: "数据表已从界面移除，数据已保留。",
        yue: "資料表已喺介面移除，資料仍然保留。",
    },
    manage_table_deleted_success: {
        fi: "Aineisto poistettu pysyvästi.",
        en: "Table permanently deleted.",
        ch: "数据表已永久删除。",
        yue: "資料表已永久刪除。",
    },
};

/** The copy in the { fi, en, ch, yue } shape the page translator's fallbacks use. */
export const DATASET_FORM_TRANSLATION_FALLBACKS = Object.freeze(COPY);
