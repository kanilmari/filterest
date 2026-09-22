// manage_table_translation_fallbacks.js
// Supplies localized management and deletion copy before site translations exist.
// Registered fallbacks keep the open editor usable without database writes.
export const MANAGE_TABLE_TRANSLATION_FALLBACKS = {
  "manage_table_title": {
    "fi": "Hallitse aineistoa",
    "en": "Manage table",
    "ch": "管理数据表",
    "yue": "管理資料表"
  },
  "manage_table_name": {
    "fi": "Taulun nimi",
    "en": "Table name",
    "ch": "数据表名称",
    "yue": "資料表名稱"
  },
  "manage_table_multilingual_default": {
    "fi": "Uudet tekstisarakkeet ovat oletuksena monikielisiä",
    "en": "New text columns are multilingual by default",
    "ch": "新文本列默认支持多语言",
    "yue": "新文字欄位預設支援多語言"
  },
  "manage_table_column_multilingual": {
    "fi": "Monikielinen tekstisarake",
    "en": "Multilingual text column",
    "ch": "多语言文本列",
    "yue": "多語言文字欄位"
  },
  "manage_table_column_name": {
    "fi": "Sarakkeen nimi",
    "en": "Column name",
    "ch": "列名",
    "yue": "欄位名稱"
  },
  "manage_table_data_type": {
    "fi": "Tietotyyppi",
    "en": "Data type",
    "ch": "数据类型",
    "yue": "資料類型"
  },
  "manage_table_select_type": {
    "fi": "Valitse tietotyyppi",
    "en": "Choose a data type",
    "ch": "选择数据类型",
    "yue": "選擇資料類型"
  },
  "manage_table_length": {
    "fi": "Tekstin enimmäispituus (VARCHAR)",
    "en": "Maximum text length (VARCHAR)",
    "ch": "最大文本长度 (VARCHAR)",
    "yue": "文字長度上限 (VARCHAR)"
  },
  "manage_table_type_integer": {
    "fi": "Kokonaisluku (INTEGER)",
    "en": "Integer (INTEGER)",
    "ch": "整数 (INTEGER)",
    "yue": "整數 (INTEGER)"
  },
  "manage_table_type_varchar": {
    "fi": "Rajattu teksti (VARCHAR)",
    "en": "Limited text (VARCHAR)",
    "ch": "有限长度文本 (VARCHAR)",
    "yue": "限長文字 (VARCHAR)"
  },
  "manage_table_type_text": {
    "fi": "Teksti (TEXT)",
    "en": "Text (TEXT)",
    "ch": "文本 (TEXT)",
    "yue": "文字 (TEXT)"
  },
  "manage_table_type_boolean": {
    "fi": "Kyllä/ei (BOOLEAN)",
    "en": "Yes/no (BOOLEAN)",
    "ch": "是/否 (BOOLEAN)",
    "yue": "是／否 (BOOLEAN)"
  },
  "manage_table_type_date": {
    "fi": "Päivämäärä (DATE)",
    "en": "Date (DATE)",
    "ch": "日期 (DATE)",
    "yue": "日期 (DATE)"
  },
  "manage_table_add_column": {
    "fi": "Lisää sarake",
    "en": "Add column",
    "ch": "添加列",
    "yue": "新增欄位"
  },
  "manage_table_cancel": {
    "fi": "Peruuta",
    "en": "Cancel",
    "ch": "取消",
    "yue": "取消"
  },
  "manage_table_delete": {
    "fi": "Poista",
    "en": "Delete",
    "ch": "删除",
    "yue": "刪除"
  },
  "manage_table_save": {
    "fi": "Tallenna",
    "en": "Save",
    "ch": "保存",
    "yue": "儲存"
  },
  "manage_table_saved": {
    "fi": "Muutokset tallennettu.",
    "en": "Changes saved.",
    "ch": "更改已保存。",
    "yue": "變更已儲存。"
  },
  "manage_table_save_failed": {
    "fi": "Muutosten tallentaminen epäonnistui. Tarkista tiedot ja yritä uudelleen.",
    "en": "Could not save changes. Check the values and try again.",
    "ch": "无法保存更改。请检查内容后重试。",
    "yue": "無法儲存變更。請檢查內容後再試。"
  },
  "manage_table_invalid_name": {
    "fi": "Virheellinen sarakenimi. Käytä kirjaimia a–z, numeroita ja alaviivaa.",
    "en": "Invalid column name. Use letters a–z, numbers and underscores.",
    "ch": "列名无效。请使用字母 a–z、数字和下划线。",
    "yue": "欄位名稱無效。請使用字母 a–z、數字同底線。"
  },
  "manage_table_visibility_loading": {
    "fi": "Tarkistetaan näkyvyyttä…",
    "en": "Checking visibility…",
    "ch": "正在检查显示状态…",
    "yue": "正在檢查顯示狀態…"
  },
  "manage_table_visibility_failed": {
    "fi": "Näkyvyyden tarkistaminen epäonnistui. Avaa hallinta uudelleen ja yritä uudelleen.",
    "en": "Could not check visibility. Reopen Manage table and try again.",
    "ch": "无法检查显示状态。请重新打开管理窗口后重试。",
    "yue": "無法檢查顯示狀態。請重新開啟管理視窗後再試。"
  },
  "manage_table_hidden": {
    "fi": "Piilotettu käyttöliittymästä. Tiedot ovat tallessa; ylläpitäjät voivat hallita aineistoa.",
    "en": "Hidden from the interface. Data is preserved; administrators can still manage the table.",
    "ch": "已从界面隐藏。数据已保留，管理员仍可管理此表。",
    "yue": "已喺介面隱藏。資料仍然保留，管理員仍可管理資料表。"
  },
  "manage_table_restore": {
    "fi": "Palauta käyttöliittymään",
    "en": "Restore to interface",
    "ch": "恢复界面显示",
    "yue": "恢復喺介面顯示"
  },
  "manage_table_restored": {
    "fi": "Aineisto palautettu käyttöliittymään.",
    "en": "Table restored to the interface.",
    "ch": "已恢复数据表的界面显示。",
    "yue": "已恢復資料表喺介面顯示。"
  },
  "manage_table_restore_failed": {
    "fi": "Palautus epäonnistui. Yritä uudelleen.",
    "en": "Could not restore the table. Try again.",
    "ch": "无法恢复数据表。请重试。",
    "yue": "無法恢復資料表。請再試。"
  },
  "manage_table_delete_title": {
    "fi": "Poista aineisto",
    "en": "Delete table",
    "ch": "删除数据表",
    "yue": "刪除資料表"
  },
  "manage_table_delete_mode": {
    "fi": "Poistotapa",
    "en": "Deletion mode",
    "ch": "删除方式",
    "yue": "刪除方式"
  },
  "manage_table_hide": {
    "fi": "Poista käyttöliittymästä",
    "en": "Delete from UI",
    "ch": "从界面移除",
    "yue": "喺介面移除"
  },
  "manage_table_hide_help": {
    "fi": "Tiedot säilyvät. Aineisto piilotetaan tavallisilta käyttäjiltä myös suoralla osoitteella. Ylläpitäjä voi palauttaa sen tästä hallinnasta.",
    "en": "Data is preserved. The table is hidden from ordinary users, including direct links. An administrator can restore it in Manage table.",
    "ch": "数据将保留。普通用户无法在界面或通过直接链接访问此表。管理员可在管理窗口中恢复显示。",
    "yue": "資料會保留。一般使用者喺介面或經直接連結都睇唔到資料表。管理員可喺管理視窗恢復顯示。"
  },
  "manage_table_permanent": {
    "fi": "Poista pysyvästi",
    "en": "Delete permanently",
    "ch": "永久删除",
    "yue": "永久刪除"
  },
  "manage_table_permanent_help": {
    "fi": "Taulu ja sen tiedot poistetaan pysyvästi. Tätä toimintoa ei voi perua.",
    "en": "The table and its data will be permanently deleted. This cannot be undone.",
    "ch": "数据表及其数据将被永久删除。此操作无法撤销。",
    "yue": "資料表同當中資料會永久刪除。此操作無法復原。"
  },
  "manage_table_confirm_name": {
    "fi": "Vahvista kirjoittamalla yllä näkyvä taulun nimi täsmälleen.",
    "en": "Type the exact table name shown above to confirm.",
    "ch": "请输入上方显示的完整数据表名称以确认。",
    "yue": "請輸入上方顯示嘅完整資料表名稱確認。"
  },
  "manage_table_delete_failed": {
    "fi": "Poisto epäonnistui. Aineiston poistoa ei vahvistettu. Yritä uudelleen.",
    "en": "Deletion failed. The table deletion was not confirmed. Try again.",
    "ch": "删除失败，未确认数据表已删除。请重试。",
    "yue": "刪除失敗，未確認資料表已刪除。請再試。"
  },
  "manage_table_hidden_success": {
    "fi": "Aineisto poistettu käyttöliittymästä. Tiedot säilyvät.",
    "en": "Table removed from the interface. Data is preserved.",
    "ch": "数据表已从界面移除，数据已保留。",
    "yue": "資料表已喺介面移除，資料仍然保留。"
  },
  "manage_table_deleted_success": {
    "fi": "Aineisto poistettu pysyvästi.",
    "en": "Table permanently deleted.",
    "ch": "数据表已永久删除。",
    "yue": "資料表已永久刪除。"
  },
  "manage_table_settings_need_attention": {
    "fi": "Sarakkeet tallennettiin. Yksi aineiston asetus jäi kesken – katso lomakkeen viesti.",
    "en": "The columns were saved. One dataset setting still needs attention — see the message in the form."
  }
};
