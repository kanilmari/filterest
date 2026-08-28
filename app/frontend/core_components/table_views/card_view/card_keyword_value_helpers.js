// Resolves values used specifically by card keyword roles.
// Bridges narrowly detected language-map payloads with comma-separated keyword chips.
// Exists so malformed keyword metadata cannot expose JSON without changing generic JSON display.

import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";

export function resolveKeywordRoleValue(rawValue, preferredLang = "en") {
    return extractLangValue(rawValue, preferredLang, null);
}

export function splitKeywordRoleValue(rawValue, preferredLang = "en") {
    return resolveKeywordRoleValue(rawValue, preferredLang)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}
