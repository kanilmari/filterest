// view_field_assignments_copy.js
// Provides complete local fallback copy for the view-field assignment administrator.
// Bridges the active browser language with Finnish, English, Chinese, and Cantonese text.
// Exists so the workflow remains usable when the database translation service is unavailable.

import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";

const VIEW_FIELD_ASSIGNMENTS_COPY = Object.freeze({
    en: Object.freeze({
        title: "View field settings",
        description: "Choose a dataset and view, then set the shared field order for the site or selected user groups.",
        instructions: "Select a dataset from the tree to load its view fields.",
        view: "View",
        groups: "User groups",
        groupPlaceholder: "Select user groups",
        groupSearch: "Search user groups",
        groupsSelected: "groups selected",
        noResults: "No matching groups",
        targetSite: "Applies to the whole site",
        targetGroups: "Applies only to the selected groups",
        noGroups: "Select at least one user group before saving or restoring inheritance.",
        noVisible: "Keep at least one visible field for every selected group before saving.",
        name: "Field collection name",
        priority: "Group priority",
        priorityHelpLabel: "Explain group priority",
        priorityHelp: "A larger number wins when a user belongs to several groups with different field assignments. A personal choice still wins over every group, and every group wins over the site default. If group priorities are equal, the group with the smaller numeric ID wins deterministically. Keep 0 for ordinary assignments and change it only when group memberships overlap intentionally.",
        fields: "Fields",
        fieldSearch: "Search fields",
        field: "Field",
        visible: "Visible",
        order: "Order",
        moveUp: "Move up",
        moveDown: "Move down",
        drag: "Drag to reorder",
        mixed: "The selected groups use different assignments. A dash keeps that field's current value for each group; checked or empty applies one value to every selected group.",
        mixedConfirm: "Save the shared changes while preserving each group's current value for fields that still show a dash?",
        mixedValue: "Different values",
        save: "Save assignment",
        restore: "Restore inheritance",
        restoreConfirm: "Remove the selected assignment and restore inherited fields?",
        loading: "Loading field assignments…",
        loadError: "Field assignments could not be loaded. Nothing was changed.",
        readbackError: "The saved assignment could not be verified. Review the server state before trying again.",
        saved: "Field assignment saved and verified",
        restored: "Inheritance restored and verified",
    }),
    fi: Object.freeze({
        title: "Näkymien kenttäasetukset",
        description: "Valitse datasetti ja näkymä, ja määritä sitten yhteinen kenttäjärjestys koko sivustolle tai valituille käyttäjäryhmille.",
        instructions: "Valitse datasetti puurakenteesta ladataksesi sen näkymäkentät.",
        view: "Näkymä",
        groups: "Käyttäjäryhmät",
        groupPlaceholder: "Valitse käyttäjäryhmät",
        groupSearch: "Etsi käyttäjäryhmiä",
        groupsSelected: "ryhmää valittu",
        noResults: "Ei vastaavia ryhmiä",
        targetSite: "Koskee koko sivustoa",
        targetGroups: "Koskee vain valittuja ryhmiä",
        noGroups: "Valitse vähintään yksi käyttäjäryhmä ennen tallennusta tai perinnän palautusta.",
        noVisible: "Jätä jokaiselle valitulle ryhmälle vähintään yksi näkyvä kenttä ennen tallennusta.",
        name: "Kenttäjoukon nimi",
        priority: "Ryhmäprioriteetti",
        priorityHelpLabel: "Selitä ryhmäprioriteetti",
        priorityHelp: "Suurempi numero voittaa, kun käyttäjä kuuluu useaan ryhmään, joilla on eri kenttäkohdistukset. Käyttäjän oma valinta ohittaa silti kaikki ryhmät, ja ryhmäkohtainen kohdistus ohittaa koko sivuston oletuksen. Jos ryhmäprioriteetit ovat samat, pienemmän numerotunnisteen ryhmä voittaa aina samalla tavalla. Käytä tavallisesti arvoa 0 ja muuta sitä vain, kun ryhmäjäsenyydet menevät tarkoituksella päällekkäin.",
        fields: "Kentät",
        fieldSearch: "Etsi kenttiä",
        field: "Kenttä",
        visible: "Näkyvissä",
        order: "Järjestys",
        moveUp: "Siirrä ylös",
        moveDown: "Siirrä alas",
        drag: "Vedä järjestääksesi",
        mixed: "Valituilla ryhmillä on eri kohdistukset. Viiva säilyttää kentän nykyisen arvon kullakin ryhmällä; valittu tai tyhjä asettaa yhden arvon kaikille valituille ryhmille.",
        mixedConfirm: "Tallennetaanko yhteiset muutokset ja säilytetäänkö viivalla näkyvien kenttien nykyiset ryhmäkohtaiset arvot?",
        mixedValue: "Eri arvot",
        save: "Tallenna kohdistus",
        restore: "Palauta perintä",
        restoreConfirm: "Poistetaanko valittu kohdistus ja palautetaanko perityt kentät?",
        loading: "Ladataan kenttäkohdistuksia…",
        loadError: "Kenttäkohdistuksia ei voitu ladata. Mitään ei muutettu.",
        readbackError: "Tallennettua kohdistusta ei voitu varmistaa. Tarkista palvelimen tila ennen uutta yritystä.",
        saved: "Kenttäkohdistus tallennettu ja varmistettu",
        restored: "Perintä palautettu ja varmistettu",
    }),
    ch: Object.freeze({
        title: "视图字段设置",
        description: "选择数据集和视图，然后为整个站点或所选用户组设置共享字段顺序。",
        instructions: "从树中选择数据集以加载其视图字段。",
        view: "视图", groups: "用户组", groupPlaceholder: "选择用户组", groupSearch: "搜索用户组",
        groupsSelected: "个组已选择", noResults: "没有匹配的组", targetSite: "应用于整个站点",
        targetGroups: "仅应用于所选组", noGroups: "保存或恢复继承前，请至少选择一个用户组。",
        noVisible: "保存前，请为每个所选组保留至少一个可见字段。",
        name: "字段集合名称", priority: "组优先级", priorityHelpLabel: "说明组优先级",
        priorityHelp: "当用户属于多个且字段分配不同的组时，较大的数字优先。用户个人选择仍优先于所有组，任何组分配都优先于站点默认值。若组优先级相同，则数字 ID 较小的组以确定方式胜出。普通分配请保留 0，仅在组成员关系有意重叠时更改。",
        fields: "字段", fieldSearch: "搜索字段",
        field: "字段", visible: "可见", order: "顺序", moveUp: "上移", moveDown: "下移", drag: "拖动排序",
        mixed: "所选组使用不同的分配。横线会为每个组保留该字段的当前值；选中或清空会对所有所选组应用同一值。",
        mixedConfirm: "是否保存共享更改，并保留仍显示横线的字段在各组中的当前值？",
        mixedValue: "不同的值",
        save: "保存分配", restore: "恢复继承", restoreConfirm: "移除所选分配并恢复继承字段？",
        loading: "正在加载字段分配…", loadError: "无法加载字段分配。未进行任何更改。",
        readbackError: "无法验证已保存的分配。重试前请检查服务器状态。",
        saved: "字段分配已保存并验证", restored: "继承已恢复并验证",
    }),
    yue: Object.freeze({
        title: "檢視欄位設定",
        description: "揀選資料集同檢視，然後為全站或所選用戶群組設定共用欄位次序。",
        instructions: "請喺樹狀清單揀選資料集，以載入檢視欄位。",
        view: "檢視", groups: "用戶群組", groupPlaceholder: "揀選用戶群組", groupSearch: "搜尋用戶群組",
        groupsSelected: "個群組已揀選", noResults: "搵唔到相符群組", targetSite: "套用到全站",
        targetGroups: "只套用到所選群組", noGroups: "儲存或還原繼承之前，請至少揀一個用戶群組。",
        noVisible: "儲存之前，請為每個所選群組保留至少一個顯示欄位。",
        name: "欄位集合名稱", priority: "群組優先次序", priorityHelpLabel: "說明群組優先次序",
        priorityHelp: "當用戶屬於多個而且欄位分配唔同嘅群組時，較大數字優先。用戶個人選擇仍然優先過所有群組，而任何群組分配都優先過全站預設。如果群組優先次序相同，數字 ID 較細嘅群組會穩定勝出。一般分配請保留 0，只喺群組成員關係有意重疊時先更改。",
        fields: "欄位", fieldSearch: "搜尋欄位",
        field: "欄位", visible: "顯示", order: "次序", moveUp: "上移", moveDown: "下移", drag: "拖動排序",
        mixed: "所選群組使用唔同分配。橫線會為每個群組保留該欄位而家嘅值；剔選或清空就會向所有所選群組套用同一個值。",
        mixedConfirm: "要唔要儲存共用變更，同時保留仍然顯示橫線嘅欄位喺各群組而家嘅值？",
        mixedValue: "唔同值",
        save: "儲存分配", restore: "還原繼承", restoreConfirm: "移除所選分配並還原繼承欄位？",
        loading: "載入緊欄位分配…", loadError: "未能載入欄位分配。冇作出任何更改。",
        readbackError: "未能驗證已儲存嘅分配。重試前請檢查伺服器狀態。",
        saved: "欄位分配已儲存並驗證", restored: "繼承已還原並驗證",
    }),
});

function normalizeViewFieldAssignmentsLanguage(language) {
    const normalized = String(language || "en").toLowerCase();
    if (normalized.startsWith("fi")) return "fi";
    if (normalized.startsWith("yue") || normalized.startsWith("zh-hk")) return "yue";
    if (normalized.startsWith("ch") || normalized.startsWith("zh")) return "ch";
    return "en";
}

/** Resolve the complete local copy bundle for the active supported language. */
export function getViewFieldAssignmentsCopy(
    language = getLanguageWithBrowserFallback()
) {
    return VIEW_FIELD_ASSIGNMENTS_COPY[normalizeViewFieldAssignmentsLanguage(language)];
}

/** Resolve modal cancellation copy at click time, matching the active language. */
export function getViewFieldAssignmentsCancelText() {
    return normalizeViewFieldAssignmentsLanguage(getLanguageWithBrowserFallback()) === "fi"
        ? "Peruuta"
        : "Cancel";
}
