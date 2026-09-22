// confirm_prompt_translation_fallbacks.js
// Bootstrap copy for the shared confirm and input dialogs: their default
// buttons and the messages their callers show in the navigation tree, the
// admin tools, the article view and the user profile.
// Bridges those dialogs with an installation whose language keys are still
// missing: the site's own reviewed translations always take precedence.
// Exists so no confirmation falls back to a key name or to one hardcoded
// language. $count and $table_name are filled by the page translator from the
// key's "+value" suffix; a name the dialog lists below the message is never
// part of these texts.

// Each entry reads [Finnish, English, Chinese, Cantonese].
const COPY = {
    // --- The dialogs' own defaults ---
    confirm: ["Vahvista", "Confirm", "确认", "確認"],
    continue: ["Jatka", "Continue", "继续", "繼續"],

    // --- User profile: current-password prompt ---
    confirm_current_password_message: [
        "Vahvista muutos antamalla nykyinen salasanasi.",
        "Enter your current password to confirm this change.",
        "请输入当前密码以确认此更改。",
        "請輸入而家嘅密碼確認呢個更改。",
    ],

    // --- Navigation tree ---
    confirm_delete_folder: [
        "Poistetaanko tämä kansio? Vain tyhjän kansion voi poistaa.",
        "Delete this folder? Only empty folders can be deleted.",
        "要删除此文件夹吗？只能删除空文件夹。",
        "要刪除呢個資料夾嗎？只可以刪除空資料夾。",
    ],
    tree_move_project_title: [
        "Siirretäänkö toiseen projektiin?", "Move to another project?", "移动到另一个项目？", "移去另一個項目？",
    ],
    tree_move_folder_to_project: [
        "Siirretäänkö tämä kansio toiseen projektiin? Kaikki kansion taulut siirtyvät sen mukana.",
        "Move this folder to another project? All tables inside it move with it.",
        "要将此文件夹移动到另一个项目吗？其中的所有表都会一起移动。",
        "要將呢個資料夾移去另一個項目嗎？入面所有表都會一齊移動。",
    ],
    tree_move_table_to_project: [
        "Siirretäänkö tämä taulu toiseen projektiin? Taulun projekti vaihtuu.",
        "Move this table to another project? This changes which project includes the table.",
        "要将此表移动到另一个项目吗？这会改变包含该表的项目。",
        "要將呢個表移去另一個項目嗎？咁會改變包含呢個表嘅項目。",
    ],
    tree_move_tab_visibility_title: [
        "Muutetaanko välilehtien näkyvyyttä?", "Change tab visibility?", "更改标签页可见性？", "更改分頁可見性？",
    ],
    tree_move_table_to_root: [
        "Siirretäänkö tämä taulu projektin juureen? Se näkyy projektin päävälilehdissä.",
        "Move this table to the project root? It will appear in the project's main tabs.",
        "要将此表移动到项目根目录吗？它将显示在项目的主标签页中。",
        "要將呢個表移去項目根目錄嗎？佢會喺項目嘅主分頁度顯示。",
    ],
    tree_move_table_to_subfolder: [
        "Siirretäänkö tämä taulu alikansioon? Se pysyy projektissa, mutta poistuu projektin päävälilehdistä.",
        "Move this table into a subfolder? It stays in the project but leaves the project's main tabs.",
        "要将此表移动到子文件夹吗？它仍在项目中，但会从项目的主标签页中移除。",
        "要將呢個表移入子資料夾嗎？佢仍然喺項目入面，但會喺項目嘅主分頁度消失。",
    ],
    tree_move_confirm: ["Siirrä", "Move", "移动", "移動"],

    // --- Admin tools ---
    confirm_delete_rows: [
        "Poistetaanko $count riviä?", "Delete $count rows?", "要删除 $count 行吗？", "要刪除 $count 行嗎？",
    ],
    confirm_archive_unknown_storage_roots: [
        "Arkistoidaanko kaikki tuntemattomat tallennustilan juurikansiot storage_deleted-kansioon?",
        "Archive all unknown storage root folders into the storage_deleted folder?",
        "要将所有未知的存储根文件夹归档到 storage_deleted 文件夹吗？",
        "要將所有未知嘅儲存根資料夾封存去 storage_deleted 資料夾嗎？",
    ],
    confirm_purge_archived_storage_roots: [
        "Poistetaanko pysyvästi kaikki arkistoidut storage_deleted-juurikansiot, joilla ei enää ole käytössä olevaa aineistoa?",
        "Permanently delete all archived storage_deleted root folders that no longer have a live dataset?",
        "要永久删除所有不再对应在用数据集的已归档 storage_deleted 根文件夹吗？",
        "要永久刪除所有已經冇對應在用資料集嘅已封存 storage_deleted 根資料夾嗎？",
    ],
    confirm_save_child_tab_config: [
        "Tallennetaanko muutokset ennen taulun vaihtoa?", "Save changes before switching tables?",
        "切换表之前保存更改吗？", "切換表之前要唔要儲存變更？",
    ],
    confirm_save_child_tab_config_on_exit: [
        "Tallennetaanko muutokset ennen muokkauksen lopettamista?", "Save changes before you stop editing?",
        "停止编辑前保存更改吗？", "停止編輯之前要唔要儲存變更？",
    ],
    confirm_save_card_visibility: [
        "Tallennetaanko muutokset ennen taulun vaihtoa?", "Save changes before switching tables?",
        "切换表之前保存更改吗？", "切換表之前要唔要儲存變更？",
    ],
    confirm_delete_foreign_key: [
        "Poistetaanko valittu viiteavain?", "Delete the selected foreign key?", "要删除所选外键吗？", "要刪除所選外鍵嗎？",
    ],
    confirm_fix_all_issues: [
        "Korjataanko kaikki korjattavissa olevat ongelmat? Tätä ei voi perua.",
        "Fix all fixable issues? This cannot be undone.",
        "要修复所有可修复的问题吗？此操作无法撤销。",
        "要修復所有可以修復嘅問題嗎？呢個操作無法撤銷。",
    ],
    asset_linking_remove_images_confirm: [
        "Poistetaanko taulun \"$table_name\" kuvaliitokset pysyvästi? Alla näkyvä kuvataulu ja KAIKKI ladatut kuvat poistetaan.",
        "Permanently remove image assets for \"$table_name\"? The image table below and ALL uploaded images are deleted.",
        "要永久移除“$table_name”的图片资源吗？下方的图片表和所有已上传的图片都会被删除。",
        "要永久移除「$table_name」嘅圖片資源嗎？下面嘅圖片表同所有已上載嘅圖片都會被刪除。",
    ],
    asset_linking_remove_attachments_confirm: [
        "Poistetaanko taulun \"$table_name\" liitekytkentä pysyvästi? Alla näkyvä jaettu liitetaulu poistetaan, jos mikään muu liiteprofiili ei enää käytä sitä.",
        "Permanently remove attachment linking for \"$table_name\"? The shared asset table below is deleted if no other asset profile still uses it.",
        "要永久移除“$table_name”的附件关联吗？如果没有其他资源配置仍在使用，下方的共享资源表将被删除。",
        "要永久移除「$table_name」嘅附件關聯嗎？如果冇其他資源設定仲用緊，下面嘅共用資源表會被刪除。",
    ],

    // --- Article view ---
    confirm_delete_image: ["Poistetaanko tämä kuva?", "Delete this image?", "要删除此图片吗？", "要刪除呢張圖片嗎？"],
    confirm_delete_attachment: [
        "Poistetaanko tämä liite?", "Delete this attachment?", "要删除此附件吗？", "要刪除呢個附件嗎？",
    ],
};

const LANGUAGES = ["fi", "en", "ch", "yue"];

/** The copy in the { fi, en, ch, yue } shape the page translator's fallbacks use. */
export const CONFIRM_PROMPT_TRANSLATION_FALLBACKS = Object.freeze(Object.fromEntries(
    Object.entries(COPY).map(([key, texts]) => [
        key,
        Object.freeze(Object.fromEntries(LANGUAGES.map((language, index) => [language, texts[index]]))),
    ])
));
