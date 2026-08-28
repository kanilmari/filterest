// card_detail_icon_builder.js
// Resolves field metadata and semantic column names into safe filesystem symbol keys.
// Bridges system_column_details.card_detail_icon_key with the shared symbol asset resolver.
// Exists so field icons remain metadata-driven without storing or generating raw SVG markup.

import { isSafeSymbolKey } from "../../../reusable_components/symbol_asset_resolver.js";

const LEGACY_FIELD_ICON_KEYS = Object.freeze([
    "alert-circle", "bolt-pattern", "calendar", "calendar-clock", "car",
    "check-circle", "clock", "database", "euro", "file-text", "folder",
    "hash", "hourglass", "image", "info", "layers", "link", "map-pin",
    "palette", "ruler", "shopping-bag", "table", "tag", "user", "wrench",
]);

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
    const rawKey = String(iconKey || "").trim().toLowerCase();
    return isSafeSymbolKey(rawKey) ? rawKey : "";
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

// Compatibility options remain for the older card-visibility editor. The new
// Symbols tool obtains the authoritative list from the filesystem registry API.
export function getCardDetailIconOptions() {
    return [
        { value: "", label: "none" },
        ...LEGACY_FIELD_ICON_KEYS.map((key) => ({ value: key, label: key })),
    ];
}
