// tree_node_rename_copy.js
// Owns the rename dialog's notice that a new name kept its existing, shared translations.
// Connects the rename dialog to the shared fallback dictionary in every bootstrap language.
// Keeps the notice readable without a database migration, like other feature-owned copy.
export const TREE_NODE_RENAME_TRANSLATION_FALLBACKS = Object.freeze({
    rename_tree_node_kept_existing_translations: {
        fi: 'Nimellä ”$key” on jo käännökset, joten se käyttää niitä. Kirjoittamaasi tekstiä ei tallennettu kielille: $languages. Muuta tekstiä kieliavainten ylläpidossa.',
        en: 'The name “$key” already has translations, so it uses them. Your text was not saved for: $languages. Change the text in language-key maintenance.',
        ch: '名称“$key”已有翻译，因此使用现有翻译。以下语言中您输入的文字未保存：$languages。请在语言键维护中修改文字。',
        yue: '名稱「$key」已經有翻譯，所以會用現有翻譯。以下語言你輸入嘅文字冇儲存：$languages。請喺語言鍵維護入面修改文字。',
    },
});

/** Picks the bootstrap copy for an interface language, in the shared fallback dictionary's order. */
export function treeNodeRenameFallback(key, uiLanguage) {
    const copy = TREE_NODE_RENAME_TRANSLATION_FALLBACKS[key];
    const language = String(uiLanguage || '').trim().toLowerCase();
    if (language.startsWith('fi')) return copy.fi;
    if (language.startsWith('yue') || language.startsWith('zh-hk')) return copy.yue || copy.ch || copy.en;
    if (language.startsWith('ch') || language.startsWith('zh')) return copy.ch;
    return copy.en;
}
