// confirm_prompt_translation_fallbacks.test.js
// Verifies the confirm and input dialogs' bootstrap copy.
// Bridges the fallback table with the page translator's placeholder filling.
// Exists so every prompt reads correctly in all four languages before its keys are seeded.

import { describe, expect, test } from "vitest";
import { CONFIRM_PROMPT_TRANSLATION_FALLBACKS } from "./confirm_prompt_translation_fallbacks.js";

const LANGUAGES = ["fi", "en", "ch", "yue"];
const PLACEHOLDERS = ["$count", "$table_name"];

describe("confirm prompt translation fallbacks", () => {
    test("every prompt has Finnish, English, Chinese and Cantonese copy", () => {
        for (const [key, copy] of Object.entries(CONFIRM_PROMPT_TRANSLATION_FALLBACKS)) {
            for (const language of LANGUAGES) {
                expect(String(copy[language] || "").trim(), `${key}.${language}`).not.toBe("");
            }
        }
    });

    test("a placeholder the translator fills appears in every language or in none", () => {
        for (const [key, copy] of Object.entries(CONFIRM_PROMPT_TRANSLATION_FALLBACKS)) {
            for (const placeholder of PLACEHOLDERS) {
                const present = LANGUAGES.map((language) => copy[language].includes(placeholder));
                expect(new Set(present).size, `${key} ${placeholder}`).toBe(1);
            }
        }
    });
});
