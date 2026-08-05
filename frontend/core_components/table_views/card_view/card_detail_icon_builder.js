// card_detail_icon_builder.js
// Resolves curated card-detail icon keys into safe SVG strings for card views.
// Bridges system_column_details.card_detail_icon_key metadata and DOM renderers.
// Exists so card icon choices stay metadata-driven without adding a framework dependency.

import TAB_ICON_PATHS from "../../navigation/main_tabs/tab_icon_library.js";

function materialCardDetailIconSvg(tabIconKey) {
    const pathData = TAB_ICON_PATHS[tabIconKey];
    if (!pathData) {
        return "";
    }

    return `<svg viewBox="0 -960 960 960" fill="currentColor"><path d="${pathData}" /></svg>`;
}

const CARD_DETAIL_ICON_SVG_BY_KEY = Object.freeze({
    "alert-circle": materialCardDetailIconSvg("warning"),
    "bolt-pattern": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.35" /><circle cx="12" cy="6.7" r="1.1" /><circle cx="17.1" cy="10.3" r="1.1" /><circle cx="15.1" cy="16.1" r="1.1" /><circle cx="8.9" cy="16.1" r="1.1" /><circle cx="6.9" cy="10.3" r="1.1" /></svg>',
    "calendar": materialCardDetailIconSvg("calendar"),
    "calendar-clock": materialCardDetailIconSvg("schedule"),
    "car": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 5.5A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.8 1.1L3.5 11.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M5 11h14" /></svg>',
    "check-circle": materialCardDetailIconSvg("check_circle"),
    "clock": materialCardDetailIconSvg("schedule"),
    "database": materialCardDetailIconSvg("database"),
    "euro": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6.4A7.2 7.2 0 0 0 12.3 4C8.3 4 5 7.6 5 12s3.3 8 7.3 8c2.2 0 4.2-.9 5.7-2.4" /><path d="M4 10h10.8" /><path d="M4 14h10" /></svg>',
    "file-text": materialCardDetailIconSvg("description"),
    "folder": materialCardDetailIconSvg("folder"),
    "hash": '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M280-160l40-160H160l20-80h160l40-160H220l20-80h160l40-160h80l-40 160h160l40-160h80l-40 160h160l-20 80H700l-40 160h160l-20 80H640l-40 160h-80l40-160H400l-40 160h-80Zm140-240h160l40-160H460l-40 160Z" /></svg>',
    "hourglass": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.2a4 4 0 0 0-1.2-2.8L12 12l-3.8 3A4 4 0 0 0 7 17.8V22" /><path d="M7 2v4.2A4 4 0 0 0 8.2 9L12 12l3.8-3A4 4 0 0 0 17 6.2V2" /></svg>',
    "image": materialCardDetailIconSvg("image"),
    "info": materialCardDetailIconSvg("info"),
    "layers": materialCardDetailIconSvg("category"),
    "link": materialCardDetailIconSvg("link"),
    "map-pin": materialCardDetailIconSvg("location"),
    "palette": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2a10 10 0 0 0 0 20h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h2a8 8 0 0 0 0-11z" /></svg>',
    "ruler": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 2 6 6L8 22l-6-6L16 2z" /><path d="m7.5 10.5 2 2" /><path d="m10.5 7.5 2 2" /><path d="m13.5 4.5 2 2" /><path d="m4.5 13.5 2 2" /></svg>',
    "shopping-bag": materialCardDetailIconSvg("store"),
    "tag": materialCardDetailIconSvg("label"),
    "table": materialCardDetailIconSvg("table"),
    "user": materialCardDetailIconSvg("person"),
    "wrench": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-2.6 2-2.8z" /></svg>',
});

const CARD_DETAIL_ICON_OPTIONS = Object.freeze(
    Object.keys(CARD_DETAIL_ICON_SVG_BY_KEY)
        .sort()
        .map((key) => ({ value: key, label: key }))
);

const CARD_DETAIL_ICON_KEY_PATTERNS = Object.freeze([
    { pattern: /(^id$|_id$|tunnus|numero)/i, iconKey: "hash" },
    { pattern: /(created|created_at|luotu|date|päivä|paiva)/i, iconKey: "calendar" },
    { pattern: /(updated|modified|päivitetty|paivitetty|time|aika)/i, iconKey: "calendar-clock" },
    { pattern: /(user|owner|assignee|assigned|käyttäjä|kayttaja)/i, iconKey: "user" },
    { pattern: /(status|state|tila|valmis)/i, iconKey: "check-circle" },
    { pattern: /(priority|error|warning|risk|tärkeys|tarkeys)/i, iconKey: "alert-circle" },
    { pattern: /(pulttijako|bolt|lug)/i, iconKey: "bolt-pattern" },
    { pattern: /(tuumakoko|inch|inches|diameter|koko|size)/i, iconKey: "ruler" },
    { pattern: /(image|photo|kuva|avatar|logo)/i, iconKey: "image" },
    { pattern: /(price|cost|hinta|euro|eur)/i, iconKey: "euro" },
    { pattern: /(color|colour|väri|vari)/i, iconKey: "palette" },
    { pattern: /(material|type|category|laji|tyyppi)/i, iconKey: "layers" },
    { pattern: /(tag|keyword|label|tunniste)/i, iconKey: "tag" },
    { pattern: /(folder|parent|kansio|yläkansio|ylakansio)/i, iconKey: "folder" },
    { pattern: /(link|url|website|www)/i, iconKey: "link" },
    { pattern: /(address|location|city|country|osoite|sijainti|kaupunki|maa)/i, iconKey: "map-pin" },
    { pattern: /(car|auto|vehicle|ajoneuvo)/i, iconKey: "car" },
    { pattern: /(tool|setting|admin|työkalu|tyokalu|asetus)/i, iconKey: "wrench" },
    { pattern: /(content|description|body|kuvaus|sisältö|sisalto)/i, iconKey: "file-text" },
]);

export function normalizeClientCardDetailIconKey(iconKey) {
    const normalized = String(iconKey || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(CARD_DETAIL_ICON_SVG_BY_KEY, normalized)
        ? normalized
        : "";
}

export function resolveCardDetailIconKey(iconKey, columnName = "") {
    const directKey = normalizeClientCardDetailIconKey(iconKey);
    if (directKey) {
        return directKey;
    }

    const normalizedColumnName = String(columnName || "").trim();
    const matchedPattern = CARD_DETAIL_ICON_KEY_PATTERNS.find(({ pattern }) =>
        pattern.test(normalizedColumnName)
    );
    return matchedPattern?.iconKey || "";
}

export function getCardDetailIconSvgMarkup(iconKey, columnName = "") {
    const resolvedIconKey = resolveCardDetailIconKey(iconKey, columnName);
    return CARD_DETAIL_ICON_SVG_BY_KEY[resolvedIconKey] || "";
}

export function getCardDetailIconOptions() {
    return [
        { value: "", label: "none" },
        ...CARD_DETAIL_ICON_OPTIONS,
    ];
}
