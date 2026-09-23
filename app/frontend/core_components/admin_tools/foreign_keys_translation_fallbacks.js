// foreign_keys_translation_fallbacks.js
// Bootstrap copy for the foreign-keys admin page and its Add dialog.
// Bridges the page with an installation whose language keys are still missing:
// the site's own reviewed translations always take precedence over these.
// Exists so the page reads in Finnish, English, Chinese (ch) and Cantonese (yue).
// The Finnish and English texts of keys the database already holds match that
// copy exactly, so a new and an upgraded installation read the same.
// referencing_column, referenced_table, referenced_column and select_column come
// from the dataset form's fallbacks, which the page shares. This page owns
// add_foreign_key, because the dataset form now names the same act in the
// person's own words ("Connect two fields") and no longer shares this key.

// Each entry reads [Finnish, English, Chinese, Cantonese].
const COPY = {
    add_foreign_key: ["Lisää viiteavain", "Add foreign key", "添加外键", "新增外鍵"],
    referencing_table: ["Viittaava taulu", "Referencing table", "引用表", "引用表"],
    select_table: ["Valitse taulu", "Select table", "选择表", "選擇表"],
    fill_all_fields: ["Täytä kaikki kentät", "Fill all fields", "请填写所有字段", "請填寫所有欄位"],
    foreign_key_added_successfully: [
        "Viiteavain lisätty onnistuneesti", "Foreign key added successfully", "外键添加成功", "外鍵已成功加入",
    ],
    foreign_key_deleted_successfully: [
        "Viiteavain poistettu onnistuneesti", "Foreign key deleted successfully", "外键删除成功", "外鍵已成功刪除",
    ],
    select_foreign_key_to_delete: [
        "Valitse poistettava viiteavain", "Select foreign key to delete", "请选择要删除的外键", "請選擇要刪除嘅外鍵",
    ],
    delete_selected_foreign_key: [
        "Poista valittu viiteavain", "Delete selected foreign key", "删除所选外键", "刪除所選外鍵",
    ],
};

const LANGUAGES = ["fi", "en", "ch", "yue"];

/** The copy in the { fi, en, ch, yue } shape the page translator's fallbacks use. */
export const FOREIGN_KEYS_TRANSLATION_FALLBACKS = Object.freeze(Object.fromEntries(
    Object.entries(COPY).map(([key, texts]) => [
        key,
        Object.freeze(Object.fromEntries(LANGUAGES.map((language, index) => [language, texts[index]]))),
    ])
));
