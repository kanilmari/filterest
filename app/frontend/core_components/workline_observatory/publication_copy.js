// publication_copy.js
// Resolves publication labels through the application language-key dictionary.
// Connects the release panel with authored fallback copy for bundled languages.
// Keeps the existing Observatory copy mechanism while respecting site translations.

import { getTranslationForKey } from '../lang/translation_handler.js';

const PUBLICATION_COPY = {
    "goal": [
        "Julkaisut",
        "Publications",
        "发布",
        "發佈"
    ],
    "noGoal": [
        "Julkaisuja ei vielä ole",
        "No publications yet",
        "尚无发布",
        "未有發佈"
    ],
    "releaseTarget": [
        "Julkaisut",
        "Publications",
        "发布",
        "發佈"
    ],
    "newGoal": [
        "Suunnittele seuraava julkaisu",
        "Plan the next publication",
        "规划下一次发布",
        "計劃下一次發佈"
    ],
    "goalKey": [
        "Julkaisun tunniste",
        "Publication identity",
        "发布标识",
        "發佈識別"
    ],
    "goalRevision": [
        "Sopimuksen versio",
        "Contract revision",
        "契约修订",
        "契約修訂"
    ],
    "goalTitle": [
        "Julkaisun nimi",
        "Publication name",
        "发布名称",
        "發佈名稱"
    ],
    "goalOutcome": [
        "Tavoite ja suunnitelma",
        "Outcome and plan",
        "目标与计划",
        "目標同計劃"
    ],
    "createGoal": [
        "Luo julkaisu",
        "Create publication",
        "创建发布",
        "建立發佈"
    ],
    "lockGoal": [
        "Lukitse julkaisusopimus",
        "Lock publication contract",
        "锁定发布契约",
        "鎖定發佈契約"
    ],
    "publicationVersion": [
        "Julkaistava versio",
        "Publication version",
        "发布版本",
        "發佈版本"
    ],
    "targetDate": [
        "Tavoitepäivä",
        "Target date",
        "目标日期",
        "目標日期"
    ],
    "readerDescription": [
        "Mitä julkaisu tuo lukijalle (desktop ja mobiili)",
        "What readers gain (desktop and mobile)",
        "读者获得的功能（桌面和移动端）",
        "讀者得到嘅功能（桌面同手機）"
    ],
    "published": [
        "Julkaistu",
        "Published",
        "已发布",
        "已發佈"
    ],
    "unpublished": [
        "Julkaisematon",
        "Unpublished",
        "未发布",
        "未發佈"
    ],
    "publishedAt": [
        "Julkaisuhetki",
        "Publication time",
        "发布时间",
        "發佈時間"
    ],
    "currentPublication": [
        "Uusin julkaisematon",
        "Newest unpublished",
        "最新未发布计划",
        "最新未發佈計劃"
    ],
    "publicationHistory": [
        "Valitse julkaisu",
        "Choose publication",
        "选择发布",
        "揀選發佈"
    ],
    "savePublication": [
        "Tallenna julkaisu",
        "Save publication",
        "保存发布",
        "儲存發佈"
    ],
    "publicationConflict": [
        "Julkaisu muuttui. Tarkista päivitetty tila ja yritä uudelleen.",
        "This publication changed. Review the refreshed state and try again.",
        "此发布已更改。请检查刷新后的状态并重试。",
        "呢次發佈已經改咗。請檢查更新後嘅狀態再試。"
    ]
};

export function resolvePublicationCopy(language) {
    const index = language.startsWith('fi') ? 0
        : ['yue', 'zh-hk', 'zh-tw'].includes(language) ? 3
            : language === 'ch' || language.startsWith('zh') ? 2 : 1;
    return Object.fromEntries(Object.entries(PUBLICATION_COPY).map(([name, translations]) => [
        name, getTranslationForKey(publicationLanguageKey(name), { fallback: translations[index], countUsage: false }),
    ]));
}

function publicationLanguageKey(name) {
    return `workline_publication_${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}
