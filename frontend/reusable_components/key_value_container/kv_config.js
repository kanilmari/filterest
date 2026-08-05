// kv_config.js
// Centralized configuration defaults for key-value pair display used by kv_container.js.
// Bridges per-call rendering overrides and the kv_container component's default behavior.
// Exists to provide a single place to tune layout mode, column count, and breakpoints across kv_container usages.

/**
 * Oletusasetukset renderKeyValuePairs-funktiolle.
 * Näitä käytetään, ellei kutsukohtaisesti ylikirjoiteta.
 * 
 * @property {'inline'|'stacked'|'conditional'} layoutMode
 *   - 'inline': (DEPRECATED) avain ja arvo vierekkäin 50/50 gridissä
 *   - 'stacked': avain ja arvo allekkain
 *   - 'conditional': älykäs rivitys - arvo avaimen viereen jos mahtuu, muuten omalle rivilleen
 */
export const kvDefaultOptions = {
    maxColumns: 2,
    minPairWidth: 200,
    layoutMode: "conditional",  // Vaihda tästä: "stacked", "conditional", tai "inline"
    singleColumnBreakpoint: 650,
};
