// table_creation_translation_fallbacks.js
// Bootstrap copy for the existing multilingual dataset creation form.
// Runtime translations remain authoritative; stable role IDs are not display text.
export const TABLE_CREATION_TRANSLATION_FALLBACKS = {
  "table_name": {
    "fi": "Aineiston nimi",
    "en": "Dataset name",
    "ch": "数据集名称",
    "yue": "資料集名稱"
  },
  "column_name": {
    "fi": "Sarakkeen nimi",
    "en": "Column name",
    "ch": "列名",
    "yue": "欄位名稱"
  },
  "data_type": {
    "fi": "Tietotyyppi",
    "en": "Data type",
    "ch": "数据类型",
    "yue": "資料類型"
  },
  "length": {
    "fi": "Pituus",
    "en": "Length",
    "ch": "长度",
    "yue": "長度"
  },
  "card_role": {
    "fi": "Rooli kortissa",
    "en": "Card role",
    "ch": "卡片角色",
    "yue": "卡片角色"
  },
  "select_data_type": {
    "fi": "Valitse tietotyyppi",
    "en": "Choose a data type",
    "ch": "选择数据类型",
    "yue": "選擇資料類型"
  },
  "folder": {
    "fi": "Kansio",
    "en": "Folder",
    "ch": "文件夹",
    "yue": "資料夾"
  },
  "select_folder": {
    "fi": "Valitse kansio",
    "en": "Choose a folder",
    "ch": "选择文件夹",
    "yue": "選擇資料夾"
  },
  "table_folder_hint": {
    "fi": "Valitse olemassa oleva kansio tai luo uusi. Oletuskansio on database / other_tables.",
    "en": "Choose an existing folder or create one. The default folder is database / other_tables.",
    "ch": "选择现有文件夹或创建新文件夹。默认文件夹为 database / other_tables。",
    "yue": "選擇現有資料夾或建立新資料夾。預設資料夾係 database / other_tables。"
  },
  "new_folder_name": {
    "fi": "Uuden kansion nimi",
    "en": "New folder name",
    "ch": "新文件夹名称",
    "yue": "新資料夾名稱"
  },
  "parent_folder": {
    "fi": "Yläkansio",
    "en": "Parent folder",
    "ch": "父文件夹",
    "yue": "上層資料夾"
  },
  "root_folder": {
    "fi": "Juurikansio",
    "en": "Root folder",
    "ch": "根文件夹",
    "yue": "根資料夾"
  },
  "add_column": {
    "fi": "Lisää sarake",
    "en": "Add column",
    "ch": "添加列",
    "yue": "新增欄位"
  },
  "add_foreign_key": {
    "fi": "Lisää viite toiseen aineistoon",
    "en": "Add dataset reference",
    "ch": "添加数据集引用",
    "yue": "新增資料集參照"
  },
  "default_permissions": {
    "fi": "Oletusoikeudet",
    "en": "Default permissions",
    "ch": "默认权限",
    "yue": "預設權限"
  },
  "grant_users_read": {
    "fi": "Anna käyttäjille lukuoikeus",
    "en": "Allow users to read",
    "ch": "允许用户读取",
    "yue": "允許用戶讀取"
  },
  "grant_guests_read": {
    "fi": "Anna vieraille lukuoikeus",
    "en": "Allow guests to read",
    "ch": "允许访客读取",
    "yue": "允許訪客讀取"
  },
  "prevent_table_deletion_hosting_request": {
    "fi": "Salli poistaminen vain ylläpidon kautta",
    "en": "Allow deletion only through hosting support",
    "ch": "仅允许托管支持删除",
    "yue": "只容許託管支援刪除"
  },
  "create_table_enable_images": {
    "fi": "Salli kuvien lataaminen aineistoon",
    "en": "Enable image uploads for this dataset",
    "ch": "允许向此数据集上传图片",
    "yue": "容許上載圖片到呢個資料集"
  },
  "create_table": {
    "fi": "Luo aineisto",
    "en": "Create dataset",
    "ch": "创建数据集",
    "yue": "建立資料集"
  },
  "delete": {
    "fi": "Poista",
    "en": "Remove",
    "ch": "移除",
    "yue": "移除"
  },
  "referencing_column": {
    "fi": "Viittaava sarake",
    "en": "Referencing column",
    "ch": "引用列",
    "yue": "參照欄位"
  },
  "referenced_table": {
    "fi": "Viitattava aineisto",
    "en": "Referenced dataset",
    "ch": "被引用的数据集",
    "yue": "被參照資料集"
  },
  "referenced_column": {
    "fi": "Viitattava sarake",
    "en": "Referenced column",
    "ch": "被引用的列",
    "yue": "被參照欄位"
  },
  "select_column": {
    "fi": "Valitse sarake",
    "en": "Choose a column",
    "ch": "选择列",
    "yue": "選擇欄位"
  },
  "create_dataset_route_hint": {
    "fi": "Aineiston nimi varaa myös URL-osoitteen. Käytä yksilöllistä nimeä; app_-alkuiset nimet varaavat myös osoitteen ilman app_-etuliitettä.",
    "en": "The dataset name also reserves its URL. Use a unique name; app_ names also reserve the URL without the app_ prefix.",
    "ch": "数据集名称也用于保留其网址。请使用唯一名称；app_ 开头的名称还会保留不含 app_ 前缀的网址。",
    "yue": "資料集名稱亦會保留網址。請用唯一名稱；app_ 開頭嘅名稱亦會保留冇 app_ 前綴嘅網址。"
  },
  "card_role_hint": {
    "fi": "Rooli ohjaa sarakkeen käyttöä korteissa ja artikkeleissa. Voit muuttaa sitä myöhemmin korttien kenttäasetuksista.",
    "en": "The role controls how a column is used in cards and articles. You can change it later in card field settings.",
    "ch": "角色控制列在卡片和文章中的用途。稍后可在卡片字段设置中更改。",
    "yue": "角色控制欄位喺卡片同文章入面嘅用途。之後可以喺卡片欄位設定更改。"
  },
  "invalid_card_role": {
    "fi": "Valitse tuettu korttirooli.",
    "en": "Choose a supported card role.",
    "ch": "请选择受支持的卡片角色。",
    "yue": "請選擇支援嘅卡片角色。"
  },
  "duplicate_column_name": {
    "fi": "Sarakkeiden nimien on oltava yksilöllisiä.",
    "en": "Column names must be unique.",
    "ch": "列名必须唯一。",
    "yue": "欄位名稱必須唯一。"
  },
  "table_name_required": {
    "fi": "Aineiston nimi on pakollinen.",
    "en": "A dataset name is required.",
    "ch": "必须填写数据集名称。",
    "yue": "必須填寫資料集名稱。"
  },
  "invalid_table_name_chars": {
    "fi": "Nimessä saa käyttää kirjaimia A–Z, numeroita ja alaviivaa.",
    "en": "Use letters A–Z, numbers and underscores in the name.",
    "ch": "名称中请使用字母 A–Z、数字和下划线。",
    "yue": "名稱請用字母 A–Z、數字同底線。"
  },
  "invalid_column_name": {
    "fi": "Sarakkeen nimessä saa käyttää kirjaimia A–Z, numeroita ja alaviivaa.",
    "en": "Use letters A–Z, numbers and underscores in column names.",
    "ch": "列名中请使用字母 A–Z、数字和下划线。",
    "yue": "欄位名稱請用字母 A–Z、數字同底線。"
  },
  "missing_data_type": {
    "fi": "Valitse sarakkeen tietotyyppi.",
    "en": "Choose a data type for the column.",
    "ch": "请选择列的数据类型。",
    "yue": "請選擇欄位嘅資料類型。"
  },
  "add_at_least_one_column": {
    "fi": "Lisää vähintään yksi sarake.",
    "en": "Add at least one column.",
    "ch": "请至少添加一列。",
    "yue": "請最少新增一個欄位。"
  },
  "table_created_successfully": {
    "fi": "Aineisto luotiin.",
    "en": "Dataset created.",
    "ch": "数据集已创建。",
    "yue": "已建立資料集。"
  },
  "table_created_image_setup_failed": {
    "fi": "Aineisto luotiin, mutta kuvien käyttöönotto epäonnistui. Voit yrittää uudelleen liitteiden asetuksista.",
    "en": "The dataset was created, but images could not be enabled. Retry from asset linking.",
    "ch": "数据集已创建，但无法启用图片。请在附件关联设置中重试。",
    "yue": "已建立資料集，但啟用圖片失敗。請喺附件連結設定重試。"
  },
  "data_type_auto_timestamp": {
    "fi": "Automaattinen aikaleima (TIMESTAMPTZ)",
    "en": "Automatic timestamp (TIMESTAMPTZ)",
    "ch": "自动时间戳 (TIMESTAMPTZ)",
    "yue": "自動時間戳 (TIMESTAMPTZ)"
  }
};
