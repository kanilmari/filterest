// disclosure_palette_controls.js
// Builds the shared and dataset disclosure defaults inside the existing appearance palette.
// The caller owns scope, inheritance/reset, draft preview and explicit Save.
import definition from '../../shared/dataset_appearance/definition.json';
import contract from '../../shared/article_presentations/contract.json';
import { getPaletteCopy } from './presentation_palette_shell.js';

const COPY = {
  "en": {
    "heading": "Disclosure defaults",
    "hint": "Your choices in this browser tab take precedence. Save changes the initial defaults.",
    "open": "Initially open",
    "surfaces": {
      "filterbar": "Palette",
      "article_view": "Article",
      "image_first_view": "Image first",
      "image_first_page_view": "Image-first page"
    },
    "blocks": {
      "filters": "Filters",
      "search_overview": "Search and overview",
      "search_controls": "Search controls",
      "tools": "Tools",
      "views": "Views",
      "field_sets": "Visible fields",
      "style": "Display settings",
      "chat": "Chat",
      "details": "Details",
      "images": "Images",
      "attachments": "Attachments",
      "related_rows": "Related rows",
      "task_progress": "Progress"
    }
  },
  "fi": {
    "heading": "Avattavien lohkojen oletukset",
    "hint": "Omat valintasi tässä selainvälilehdessä ovat ensisijaisia. Tallenna muuttaa lohkojen alkutilan oletuksia.",
    "open": "Aluksi auki",
    "surfaces": {
      "filterbar": "Paletti",
      "article_view": "Artikkeli",
      "image_first_view": "Kuva ensin",
      "image_first_page_view": "Kuva ensin -sivu"
    },
    "blocks": {
      "filters": "Suodattimet",
      "search_overview": "Haku ja yleiskuva",
      "search_controls": "Hakutyökalut",
      "tools": "Työkalut",
      "views": "Näkymät",
      "field_sets": "Näkyvät kentät",
      "style": "Näyttöasetukset",
      "chat": "Keskustelu",
      "details": "Tiedot",
      "images": "Kuvat",
      "attachments": "Liitteet",
      "related_rows": "Liittyvät rivit",
      "task_progress": "Työvaiheet"
    }
  },
  "ch": {
    "heading": "可展开区块的默认状态",
    "hint": "当前浏览器标签页中的个人选择优先。保存会更改区块的初始默认状态。",
    "open": "初始展开",
    "surfaces": {
      "filterbar": "工具面板",
      "article_view": "文章",
      "image_first_view": "图片优先",
      "image_first_page_view": "图片优先页面"
    },
    "blocks": {
      "filters": "筛选",
      "search_overview": "搜索与概览",
      "search_controls": "搜索工具",
      "tools": "工具",
      "views": "视图",
      "field_sets": "可见字段",
      "style": "显示设置",
      "chat": "聊天",
      "details": "详情",
      "images": "图片",
      "attachments": "附件",
      "related_rows": "相关记录",
      "task_progress": "进度"
    }
  },
  "yue": {
    "heading": "可展開區塊嘅預設狀態",
    "hint": "你喺呢個瀏覽器分頁嘅選擇優先。儲存會更改區塊嘅初始預設狀態。",
    "open": "開始時展開",
    "surfaces": {
      "filterbar": "工具面板",
      "article_view": "文章",
      "image_first_view": "圖片優先",
      "image_first_page_view": "圖片優先頁面"
    },
    "blocks": {
      "filters": "篩選",
      "search_overview": "搜尋同概覽",
      "search_controls": "搜尋工具",
      "tools": "工具",
      "views": "檢視",
      "field_sets": "可見欄位",
      "style": "顯示設定",
      "chat": "對話",
      "details": "詳情",
      "images": "圖片",
      "attachments": "附件",
      "related_rows": "相關記錄",
      "task_progress": "進度"
    }
  },
  "zh-cn": {
    "heading": "可展开区块的默认状态",
    "hint": "当前浏览器标签页中的个人选择优先。保存会更改区块的初始默认状态。",
    "open": "初始展开",
    "surfaces": {
      "filterbar": "工具面板",
      "article_view": "文章",
      "image_first_view": "图片优先",
      "image_first_page_view": "图片优先页面"
    },
    "blocks": {
      "filters": "筛选",
      "search_overview": "搜索与概览",
      "search_controls": "搜索工具",
      "tools": "工具",
      "views": "视图",
      "field_sets": "可见字段",
      "style": "显示设置",
      "chat": "聊天",
      "details": "详情",
      "images": "图片",
      "attachments": "附件",
      "related_rows": "相关记录",
      "task_progress": "进度"
    }
  },
  "zh-hk": {
    "heading": "可展開區塊嘅預設狀態",
    "hint": "你喺呢個瀏覽器分頁嘅選擇優先。儲存會更改區塊嘅初始預設狀態。",
    "open": "開始時展開",
    "surfaces": {
      "filterbar": "工具面板",
      "article_view": "文章",
      "image_first_view": "圖片優先",
      "image_first_page_view": "圖片優先頁面"
    },
    "blocks": {
      "filters": "篩選",
      "search_overview": "搜尋同概覽",
      "search_controls": "搜尋工具",
      "tools": "工具",
      "views": "檢視",
      "field_sets": "可見欄位",
      "style": "顯示設定",
      "chat": "對話",
      "details": "詳情",
      "images": "圖片",
      "attachments": "附件",
      "related_rows": "相關記錄",
      "task_progress": "進度"
    }
  },
  "zh-tw": {
    "heading": "可展開區塊的預設狀態",
    "hint": "此瀏覽器分頁中的個人選擇優先。儲存會變更區塊的初始預設狀態。",
    "open": "初始展開",
    "surfaces": {
      "filterbar": "工具面板",
      "article_view": "文章",
      "image_first_view": "圖片優先",
      "image_first_page_view": "圖片優先頁面"
    },
    "blocks": {
      "filters": "篩選",
      "search_overview": "搜尋與概覽",
      "search_controls": "搜尋工具",
      "tools": "工具",
      "views": "檢視",
      "field_sets": "可見欄位",
      "style": "顯示設定",
      "chat": "對話",
      "details": "詳細資料",
      "images": "圖片",
      "attachments": "附件",
      "related_rows": "相關記錄",
      "task_progress": "進度"
    }
  }
};
export function getDisclosurePaletteCopy() { return getPaletteCopy(COPY); }

const paletteBlocks = ['filters', 'search_overview', 'search_controls', 'tools', 'views', 'field_sets', 'style', 'chat'];
const groups = { filterbar: paletteBlocks,
    ...Object.fromEntries(Object.entries(contract.presentations).map(([key, value]) => [key, value.blocks])) };

export function buildDisclosureDefaultControls(parent, addRow, change) {
    for (const [surface, blocks] of Object.entries(groups)) {
        for (const block of blocks) {
            const key = `${surface}_${block}_initial_open`;
            if (!definition.shared_fields[key]) continue;
            const element = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
            element.className = 'dataset-cover-test-palette__toggle'; input.type = 'checkbox';
            input.dataset.testid = `disclosure-default-${surface}-${block}`;
            input.addEventListener('change', () => change(key, input.checked)); element.append(input, text);
            addRow({ element, setValue: value => { input.checked = value === true; }, setCopy() {
                const copy = getDisclosurePaletteCopy();
                text.textContent = `${copy.surfaces[surface]} · ${copy.blocks[block]}: ${copy.open}`;
            } }, key, parent);
        }
    }
}
