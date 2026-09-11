// Canonical immutable card renderer protocol, shared by native ES modules and Go.
// JSON-shaped export only: the colocated Go package embeds and validates this data.
// Mutable column assignments live in system_column_details.card_element.
export default {
  "description": "Immutable renderer protocol. Dataset column assignments remain in system_column_details.card_element; translated labels are display copy, never role identifiers.",
  "roles": [
    {
      "id": "details",
      "label_key": "card_role_additional_information",
      "numbered": true,
      "labels": {
        "fi": "Lisätieto",
        "en": "Additional information",
        "ch": "补充信息",
        "yue": "補充資料"
      },
      "initial_show_key": true
    },
    {
      "id": "header",
      "label_key": "card_role_title",
      "numbered": false,
      "labels": {
        "fi": "Otsikko",
        "en": "Title",
        "ch": "标题",
        "yue": "標題"
      },
      "initial_show_key": false
    },
    {
      "id": "description",
      "label_key": "card_role_description",
      "numbered": true,
      "labels": {
        "fi": "Kuvaus",
        "en": "Description",
        "ch": "描述",
        "yue": "描述"
      },
      "initial_show_key": false
    },
    {
      "id": "image",
      "label_key": "card_role_image",
      "numbered": false,
      "labels": {
        "fi": "Kuva",
        "en": "Image",
        "ch": "图片",
        "yue": "圖片"
      }
    },
    {
      "id": "details_link",
      "label_key": "card_role_link",
      "numbered": true,
      "labels": {
        "fi": "Linkki",
        "en": "Link",
        "ch": "链接",
        "yue": "連結"
      },
      "initial_show_key": true
    },
    {
      "id": "keywords",
      "label_key": "card_role_keywords",
      "numbered": false,
      "labels": {
        "fi": "Avainsanat",
        "en": "Keywords",
        "ch": "关键词",
        "yue": "關鍵詞"
      },
      "initial_show_key": false
    },
    {
      "id": "username",
      "label_key": "card_role_username",
      "numbered": false,
      "labels": {
        "fi": "Käyttäjänimi",
        "en": "Username",
        "ch": "用户名",
        "yue": "用戶名稱"
      }
    },
    {
      "id": "hidden",
      "label_key": "card_role_hidden",
      "numbered": true,
      "labels": {
        "fi": "Piilotettu kortilta",
        "en": "Hidden on cards",
        "ch": "在卡片中隐藏",
        "yue": "喺卡片隱藏"
      }
    },
    {
      "id": "creation_spec",
      "label_key": "card_role_creation_information",
      "numbered": false,
      "labels": {
        "fi": "Luontitieto",
        "en": "Creation information",
        "ch": "创建信息",
        "yue": "建立資料"
      }
    }
  ],
  "modifiers": [
    "lang_key",
    "lang-key"
  ],
  "legacy_authoring_values": [
    "header+lang_key",
    "description1",
    "description1+lang_key",
    "description2",
    "description2+lang_key"
  ]
};
