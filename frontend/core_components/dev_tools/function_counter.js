// function_counter.js
// Tracks frontend function execution counts in localStorage for debugging.
// Bridges instrumented frontend functions with lightweight local execution analytics.
// Exists to help inspect usage hotspots without introducing heavier profiling infrastructure.

export function count_this_function(nykyisen_funktion_nimi) {
    // 1. Lataa aiemmat laskurit (tyhjä objekti, jos puuttuu)
    const jsonMuodossaTallennetutLaskurit = localStorage.getItem('function_counts');
    const funktioidenSuorituskerrat = jsonMuodossaTallennetutLaskurit
        ? JSON.parse(jsonMuodossaTallennetutLaskurit)
        : {};

    // 2. Päivitä tämän funktion laskuri
    const nykyinenArvo = Number(funktioidenSuorituskerrat[nykyisen_funktion_nimi] || 0);
    funktioidenSuorituskerrat[nykyisen_funktion_nimi] = nykyinenArvo + 1;

    // 3. Lajittele objektin avain-arvo-parit laskevaan järjestykseen suorituskertojen mukaan
    const lajitellutParit = Object.entries(funktioidenSuorituskerrat).sort(
        ([, aLaskuri], [, bLaskuri]) => bLaskuri - aLaskuri
    );
    const lajiteltuObjekti = Object.fromEntries(lajitellutParit);

    // 4. Tallenna takaisin localStorageen jo valmiiksi lajiteltuna
    localStorage.setItem('function_counts', JSON.stringify(lajiteltuObjekti));
}

/**
 * Palauttaa localStoragessa olevan laskuridatan lajiteltuna
 * suurimmasta pienimpään.
 *
 * @returns {Array<{ functionName: string, count: number }>}
 */
export function get_sorted_function_counts() {
    const tallenne = localStorage.getItem('function_counts');
    if (!tallenne) return [];

    try {
        const obj = JSON.parse(tallenne);
        return Object.entries(obj).map(([functionName, count]) => ({
            functionName,
            count,
        }));
    } catch (err) {
        console.warn('virhe: localStorage-tietojen jäsennys epäonnistui –', err);
        return [];
    }
}
