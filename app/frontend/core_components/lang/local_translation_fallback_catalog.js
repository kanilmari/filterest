// local_translation_fallback_catalog.js
// Collects bootstrap interface copy while reviewed site translations are missing.
// Connects the page translator to feature-owned, renderer-free fallback catalogues.
// Keeps copy registration out of the legacy handler and navigation copy out of view metadata.

import { getDatasetViewLocalTranslationFallbacks } from '../table_views/dataset_view_registry.js';
import { getCardRoleTranslationFallbacks } from '../table_views/card_view/card_role_catalog.js';
import { DATASET_FORM_TRANSLATION_FALLBACKS } from '../general_tables/dataset_form/dataset_form_translation_fallbacks.js';
import { getDatasetColumnTypeTranslationFallbacks } from '../general_tables/dataset_form/dataset_column_type_catalog.js';
import { FAILURE_NOTICE_TRANSLATION_FALLBACKS } from '../error_and_status_handling/error_monitor_handler_helpers.js';
import { EMBEDDING_STATUS_TRANSLATION_FALLBACKS } from '../../custom_views/embedding_status_translation_fallbacks.js';
import { CONFIRM_PROMPT_TRANSLATION_FALLBACKS } from '../../reusable_components/modal/confirm_prompt_translation_fallbacks.js';
import { FOREIGN_KEYS_TRANSLATION_FALLBACKS } from '../admin_tools/foreign_keys_translation_fallbacks.js';
import { DATASET_HEADER_CONFIG_TRANSLATION_FALLBACKS } from '../admin_tools/dataset_header_config_translation_fallbacks.js';
import { AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS } from '../auth/auth_session_notice_copy.js';
import { MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS } from '../admin_tools/missing_media_check_translation_fallbacks.js';
import { DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS } from '../navigation/dataset_redirect_notice_copy.js';
import { MAINTENANCE_ACTION_TRANSLATION_FALLBACKS } from '../admin_tools/maintenance_action_copy.js';
import { HOME_SEARCH_TRANSLATION_FALLBACKS } from '../front_page/front_page_search_copy.js';

import { SECOND_STEP_TRANSLATION_FALLBACKS } from '../auth/second_step_translation_fallbacks.js';

export const LOCAL_TRANSLATION_FALLBACKS = {
    ...HOME_SEARCH_TRANSLATION_FALLBACKS,
    delete_confirm_title: {
        fi: "Vahvista poisto",
        en: "Confirm deletion",
        ch: "确认删除",
        yue: "確認刪除",
    },
    delete_confirm_single: {
        fi: "Haluatko poistaa tämän kohteen?",
        en: "Delete this item?",
        ch: "要删除此项目吗？",
        yue: "要刪除呢個項目嗎？",
    },
    delete_confirm_multiple: {
        fi: "Haluatko poistaa nämä kohteet?",
        en: "Delete these items?",
        ch: "要删除这些项目吗？",
        yue: "要刪除呢啲項目嗎？",
    },
    ...getCardRoleTranslationFallbacks(),
    ...getDatasetColumnTypeTranslationFallbacks(),
    ...DATASET_FORM_TRANSLATION_FALLBACKS,
    ...FAILURE_NOTICE_TRANSLATION_FALLBACKS,
    ...EMBEDDING_STATUS_TRANSLATION_FALLBACKS,
    ...CONFIRM_PROMPT_TRANSLATION_FALLBACKS,
    ...FOREIGN_KEYS_TRANSLATION_FALLBACKS,
    ...DATASET_HEADER_CONFIG_TRANSLATION_FALLBACKS,
    ...AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS,
    ...SECOND_STEP_TRANSLATION_FALLBACKS,
    ...MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS,
    ...MAINTENANCE_ACTION_TRANSLATION_FALLBACKS,
    ...DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS,
    ...getDatasetViewLocalTranslationFallbacks(),
    // Older installs or cached responses may lack this bootstrap key; reviewed runtime translations still win.
    row_article_section_details: {
        fi: "Tiedot",
        en: "Details",
        ch: "详细信息",
        yue: "詳細資料",
    },
    field_set_owner_personal: {
        fi: "Henkilökohtainen",
        en: "Personal",
        ch: "个人",
        yue: "個人",
    },
    field_set_source_personal: {
        fi: "Henkilökohtainen ohitus on käytössä",
        en: "Personal override in use",
        ch: "正在使用个人覆盖设置",
        yue: "正在使用個人覆寫設定",
    },
    field_set_source_group: {
        fi: "Ryhmäkohtainen oletus on käytössä",
        en: "Group default in use",
        ch: "正在使用组默认设置",
        yue: "正在使用群組預設設定",
    },
    field_set_source_site: {
        fi: "Sivuston oletus on käytössä",
        en: "Site default in use",
        ch: "正在使用站点默认设置",
        yue: "正在使用網站預設設定",
    },
    field_set_source_metadata: {
        fi: "Metadatan oletus on käytössä",
        en: "Metadata default in use",
        ch: "正在使用元数据默认设置",
        yue: "正在使用中繼資料預設設定",
    },
    field_set_editing_site_default: {
        fi: "Muokataan sivuston oletusta (vain jaetut kenttäjoukot)",
        en: "Editing site default (shared collections only)",
        ch: "正在编辑站点默认设置（仅限共享集合）",
        yue: "正在編輯網站預設設定（只限共用集合）",
    },
    field_set_assignment_unavailable: {
        fi: "Tallennettu kenttäjoukkovalinta ei ole käytettävissä. Palvelimen turvallinen kenttävalinta on edelleen käytössä.",
        en: "The saved field collection is unavailable. The server's safe field selection remains in use.",
        ch: "已保存的字段集合不可用。服务器的安全字段选择仍在使用。",
        yue: "已儲存嘅欄位集合用唔到。伺服器嘅安全欄位選擇仍然使用中。",
    },
    use_site_default: {
        fi: "Käytä sivuston oletusta",
        en: "Use site default",
        ch: "使用站点默认设置",
        yue: "使用網站預設設定",
    },
    use_metadata_default: {
        fi: "Käytä metadatan oletusta",
        en: "Use metadata default",
        ch: "使用元数据默认设置",
        yue: "使用中繼資料預設設定",
    },
    field_set_inheritance_restored: {
        fi: "Oma ohitus poistettiin",
        en: "Personal override removed",
        ch: "已移除个人覆盖设置",
        yue: "已移除個人覆寫設定",
    },
    price_chart_view_title: {
        fi: "Hintagraafi",
        en: "Price chart",
        ch: "价格图表",
    },
    price_chart_zoom_in: {
        fi: "+",
        en: "+",
        ch: "+",
    },
    price_chart_zoom_out: {
        fi: "-",
        en: "-",
        ch: "-",
    },
    price_chart_reset_zoom: {
        fi: "Palauta",
        en: "Reset",
        ch: "重置",
    },
    price_chart_missing_columns_title: {
        fi: "Hintagraafin sarakkeita ei löytynyt",
        en: "No price chart columns found",
        ch: "未找到价格图表列",
    },
    price_chart_missing_columns_body: {
        fi: "Lisää yksi päivämäärä- tai aikaleimasarake ja yksi numeerinen hintasarake.",
        en: "Add one date or timestamp column and one numeric price column.",
        ch: "添加一个日期或时间戳列和一个数字价格列。",
    },
    price_chart_no_data_title: {
        fi: "Hintadataa ei löytynyt",
        en: "No price data found",
        ch: "未找到价格数据",
    },
    price_chart_no_data_body: {
        fi: "Riveillä täytyy olla kelvollinen aika- ja hinta-arvo ennen graafin näyttämistä.",
        en: "Rows need valid time and price values before the chart can render.",
        ch: "行需要有效的时间和价格值后才能呈现图表。",
    },
    price_chart_no_visible_data_title: {
        fi: "Näkyvällä alueella ei ole hintadataa",
        en: "No visible price data",
        ch: "当前范围没有可见价格数据",
    },
    price_chart_no_visible_data_body: {
        fi: "Palauta graafin aikaväli tai loitonna, jotta hintarivit näkyvät.",
        en: "Reset the chart range or zoom out to show price rows.",
        ch: "重置图表范围或缩小以显示价格行。",
    },
};
