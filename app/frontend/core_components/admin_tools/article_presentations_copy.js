// article_presentations_copy.js
// Supplies translated language-key copy to the article-family adapter.
// Connects preserved site translations with complete FI/EN/ZH fallbacks.
// Keep the matching seed migration in step when adding a key.
import { getTranslationForKey } from "../lang/component_language_dictionary.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
const COPY = {
  "title": [
    "Artikkelin esitystavat",
    "Article presentations",
    "文章展示方式",
    "文章展示方式"
  ],
  "article": [
    "Artikkeli",
    "Article",
    "文章",
    "文章"
  ],
  "image": [
    "Kuvapainotteinen artikkeli (IFAV)",
    "Image-first article (IFAV)",
    "图片优先文章 (IFAV)",
    "圖片優先文章 (IFAV)"
  ],
  "page": [
    "Sivukokoinen kuvapainotteinen artikkeli",
    "Page-sized image-first article",
    "页面大小的图片优先文章",
    "頁面大小嘅圖片優先文章"
  ],
  "select_all": [
    "Valitse kaikki",
    "Select all",
    "全选",
    "全選"
  ],
  "visible": [
    "Näkyvissä",
    "Visible",
    "可见",
    "顯示"
  ],
  "open": [
    "Auki aluksi",
    "Open at start",
    "初始展开",
    "初始展開"
  ],
  "fields": [
    "Kentät",
    "Fields",
    "字段",
    "欄位"
  ],
  "blocks": [
    "Avauslohkot",
    "Opening blocks",
    "开篇区块",
    "開篇區塊"
  ],
  "identity": [
    "Kentän nimi ja UID",
    "Field name and UID",
    "字段名称和 UID",
    "欄位名稱同 UID"
  ],
  "dash": [
    "—",
    "—",
    "—",
    "—"
  ],
  "unsupported": [
    "Ei tuettu tässä esitystavassa",
    "Not supported in this presentation",
    "此展示方式不支持",
    "呢個展示方式唔支援"
  ],
  "read_only": [
    "Aineiston yhteiset avauslohkot. Vain luku ryhmä- ja henkilökohtaisissa asetuksissa.",
    "Dataset-wide opening blocks. Read-only in group and personal settings.",
    "数据集共用的开篇区块。在组和个人设置中只读。",
    "資料集共用嘅開篇區塊。喺群組同個人設定中唯讀。"
  ],
  "mixed": [
    "Valituilla kohteilla on eri arvot. Viiva säilyttää nykyiset arvot.",
    "Selected targets have different values. A dash preserves each current value.",
    "所选目标的值不同。横线保留每个当前值。",
    "所選目標嘅值唔同。橫線會保留每個而家嘅值。"
  ],
  "orders": [
    "Kohteilla on eri järjestykset. Vain kentän siirtäminen ottaa käyttöön yhteisen järjestyksen.",
    "Targets have different orders. Only an explicit move adopts one shared order.",
    "目标顺序不同。只有明确移动才会采用统一顺序。",
    "目標嘅次序唔同。只有明確移動先會採用統一次序。"
  ],
  "unchanged": [
    "Ei muutosta",
    "Unchanged",
    "不变",
    "唔更改"
  ],
  "position": [
    "{name}: sijainti {position}/{count}",
    "{name}: position {position} of {count}",
    "{name}：第 {position} 项，共 {count} 项",
    "{name}：第 {position} 項，共 {count} 項"
  ],
  "cell": [
    "{group}, {name}, {presentation}, {target}: {meaning}",
    "{group}, {name}, {presentation}, {target}: {meaning}",
    "{group}，{name}，{presentation}，{target}：{meaning}",
    "{group}，{name}，{presentation}，{target}：{meaning}"
  ],
  "up": [
    "Siirrä ylös",
    "Move up",
    "上移",
    "上移"
  ],
  "down": [
    "Siirrä alas",
    "Move down",
    "下移",
    "下移"
  ],
  "filtered": [
    "Tyhjennä haku ennen siirtämistä",
    "Clear the search before moving fields",
    "移动字段前请清除搜索",
    "移動欄位前請清除搜尋"
  ],
  "save": [
    "Tallenna",
    "Save",
    "保存",
    "儲存"
  ],
  "cancel": [
    "Peruuta",
    "Cancel",
    "取消",
    "取消"
  ],
  "defaults": [
    "Palauta oletukset",
    "Restore defaults",
    "恢复默认值",
    "還原預設值"
  ],
  "saved": [
    "Artikkelin esitystavat tallennettu ja varmistettu.",
    "Article presentations saved and verified.",
    "文章展示方式已保存并验证。",
    "文章展示方式已儲存並驗證。"
  ],
  "failed": [
    "Tallennus epäonnistui. Luonnos säilytettiin.",
    "Save failed. The draft was kept.",
    "保存失败。草稿已保留。",
    "儲存失敗。草稿已保留。"
  ],
  "verification": [
    "Tallennuksen tulosta ei voitu varmistaa. Luonnos säilytettiin. Lataa nykyinen tila uudelleen ennen uutta tallennusta.",
    "The save result could not be verified. The draft was kept. Reload the current state before saving again.",
    "无法验证保存结果。草稿已保留。请重新加载当前状态后再保存。",
    "未能驗證儲存結果。草稿已保留。請重新載入而家嘅狀態再儲存。"
  ],
  "conflict": [
    "Asetukset ovat muuttuneet. Luonnosta ei toistettu. Lataa nykyinen tila uudelleen ja tarkista muutokset.",
    "Settings changed. The draft was not replayed. Reload the current state and review the changes.",
    "设置已更改。未重放草稿。请重新加载当前状态并检查更改。",
    "設定已更改。草稿冇重播。請重新載入而家嘅狀態並檢查更改。"
  ],
  "recovered": [
    "Luonnos palautettu. Tarkista muutokset ennen tallentamista.",
    "Draft recovered. Review the changes before saving.",
    "草稿已恢复。保存前请检查更改。",
    "草稿已還原。儲存前請檢查更改。"
  ],
  "recovery": [
    "Luonnosta ei voitu palauttaa tähän kohteeseen. Peruuta hylätäksesi luonnoksen.",
    "The draft could not be recovered for this target. Cancel to discard it.",
    "无法为此目标恢复草稿。取消以丢弃草稿。",
    "未能為呢個目標還原草稿。取消以捨棄草稿。"
  ],
  "loading": [
    "Ladataan artikkelin esitystapoja…",
    "Loading article presentations…",
    "正在加载文章展示方式…",
    "載入緊文章展示方式…"
  ],
  "details": [
    "Tiedot",
    "Details",
    "详情",
    "詳情"
  ],
  "images": [
    "Kuvat",
    "Images",
    "图片",
    "圖片"
  ],
  "attachments": [
    "Liitteet",
    "Attachments",
    "附件",
    "附件"
  ],
  "related_rows": [
    "Liittyvät kohteet",
    "Related items",
    "相关项目",
    "相關項目"
  ],
  "task_progress": [
    "Tehtävän eteneminen",
    "Task progress",
    "任务进度",
    "工作進度"
  ],
  "target_site": [
    "Sivusto",
    "Site",
    "站点",
    "網站"
  ],
  "target_group": [
    "Ryhmä",
    "Group",
    "用户组",
    "用戶群組"
  ],
  "target_personal": [
    "Henkilökohtainen",
    "Personal",
    "个人",
    "個人"
  ]
};
export function getArticlePresentationsCopy(language = getLanguageWithBrowserFallback()) {
    const normalized = String(language).toLowerCase();
    const index = normalized.startsWith("fi") ? 0 : /^(yue|zh-hk)/.test(normalized) ? 3 : /^(zh|ch)/.test(normalized) ? 2 : 1;
    const result = Object.fromEntries(Object.entries(COPY).map(([name, values]) => [name, getTranslationForKey(
        `article_presentations_${name}`, { language, fallback: values[index] }
    )]));
    result.fieldName = name => getTranslationForKey(name, { language, fallback:name });
    return result;
}
export function articleCopyFormat(template, values) {
    return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}
