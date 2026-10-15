// contract_reader.js
// Reads the source-owned article presentation vocabulary used by Go and the browser.
// Connects legacy sections and current permission gates to the approved next-version keys.
// Keeps reserved keys and opener defaults descriptive until their implementation batch.
import source from './contract.json' with { type: 'json' };

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

export const ARTICLE_PRESENTATION_CONTRACT = freeze(source);
export const ARTICLE_PRESENTATION_ALIASES = ARTICLE_PRESENTATION_CONTRACT.aliases;
export const LEGACY_ARTICLE_BLOCKS = Object.freeze(Object.fromEntries(
    Object.values(source.presentations).filter(value => value.legacy_section_key)
        .map(value => [value.legacy_section_key, value.blocks]),
));
