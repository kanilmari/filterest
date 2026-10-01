// foreign_keys_translation_fallbacks.js
// Bootstrap copy for the foreign-keys admin page and its Add dialog.
// Bridges the page with an installation whose language keys are still missing:
// the site's own reviewed translations always take precedence over these.
// Exists so the page reads in Finnish, English, Chinese (ch) and Cantonese (yue).
// The Finnish and English texts of keys the database already holds match that
// copy exactly, so a new and an upgraded installation read the same.
// The dataset form names the same act and its columns in the person's own words
// ("Connect two fields") under keys of its own, so the technical keys of this
// page, add_foreign_key and the column labels among them, belong here alone.
// select_column is shared with the notification rules page, which reads it
// through the same page translator.

// Each entry reads [Finnish, English, Chinese, Cantonese].
const COPY = {
    add_foreign_key: ["Lisää viiteavain", "Add foreign key", "添加外键", "新增外鍵"],
    referencing_table: ["Viittaava taulu", "Referencing table", "引用表", "引用表"],
    referencing_column: ["Viittaava sarake", "Referencing column", "引用列", "引用欄位"],
    referenced_table: ["Viitattu taulu", "Referenced table", "被引用的表", "被引用表"],
    referenced_column: ["Viitattu sarake", "Referenced column", "被引用的列", "被引用欄位"],
    select_column: ["Valitse sarake", "Select column", "选择列", "選擇欄位"],
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
