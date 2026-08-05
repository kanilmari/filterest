// translation_handler.js
// Fetches and caches translations from the backend and applies them to all translatable DOM nodes.
// Bridges the lang endpoint and browser-tab retry cache with the page's data-lang-key elements.
// Exists to centralise all frontend localisation so every component can call translatePage without owning fetch logic.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { renderAllowedHtml } from '../../reusable_components/dom_container_builder.js';
import { refreshCardLanguages } from '../table_views/card_view/card_view_printer.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { initDevLangKeyEditor } from './dev_lang_key_editor.js';
import {
    appendAltContext,
    splitTranslationKey,
    formatMissingKey,
    applyTranslationVariable,
    resolveTranslation,
} from './translation_handler_helpers.js';
import { getDatasetViewLocalTranslationFallbacks } from '../table_views/dataset_view_registry.js';
import {
    getSuppressedAITranslationKeys,
    suppressUnresolvedAITranslationKeys,
} from './ai_translation_retry_cache.js';

// Globaalisti tallennetaan englanninkieliset käännökset
let defaultTranslations = {};

const LOCAL_TRANSLATION_FALLBACKS = {
    ...getDatasetViewLocalTranslationFallbacks(),
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

function getLocalTranslationFallback(baseKey, chosen_language) {
    const fallback = LOCAL_TRANSLATION_FALLBACKS[baseKey];
    if (!fallback) return "";
    const language = String(chosen_language || currentChosenLang || "")
        .trim()
        .toLowerCase();
    if (language.startsWith("fi")) return fallback.fi;
    if (language.startsWith("ch") || language.startsWith("zh")) return fallback.ch;
    return fallback.en;
}

// Näytetäänkö debug-viestejä konsolissa
var debug = false;

// Ympäristön tunnistus: dev-tilassa näytetään verbose-ilmoituksia AI-käännöksistä
const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

// Dev-tilan ilmoitukset käyttävät nyt yhteistä toast-järjestelmää.
// Tuotannossa ei kutsuta (IS_DEV_MODE-tarkistus kutsukohdissa).
function _showDevTranslationNotice(message, isError = false) {
    showToast({
        message: `🔤 ${message}`,
        level: isError ? 'error' : 'info',
        duration: 4000,
    });
}

// Pidämme kirjaa kaikista puuttuvista avaimista, myös DOM-muutoksissa
let globalMissingKeys = [];

// Avain → lähdetieto: mistä DOM-elementistä puuttuva avain löytyi.
// Lähetetään backendille system_lang_key_sources -taulun populointia varten.
let globalMissingKeySources = {};

// DEV-tila: orvoksi merkityt kieliavaimet (backend lähettää DEV_MODE:ssa).
// Jos orpo-avainta käytetään sivulla, kehittäjä saa console.warn()-varoituksen.
let globalOrphanKeys = new Set();
const _warnedOrphanKeys = new Set();

// Guard: ensure only one MutationObserver is created
let _domObserverActive = false;

// Debounce timer for AI translation fetch (prevents duplicate requests
// when multiple DOM mutations add the same missing keys in rapid succession)
let _aiFetchDebounceTimer = null;
const _AI_FETCH_DEBOUNCE_MS = 300;
// Track keys already sent to AI to avoid re-fetching within the same page load
const _aiRequestedKeys = new Set();

function _isSyntheticE2ETranslationKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    return normalized.startsWith('e2e_') || normalized.startsWith('e2e-');
}

/**
 * Purkaa translations-vastauksen. DEV_MODE:ssa backend palauttaa
 * {translations: {...}, orphan_keys: [...]} — tuotannossa pelkkä flat map.
 * Tallentaa orphan-avaimet globaaliin settiin varoituksia varten.
 */
function _unwrapTranslationResponse(data) {
    if (data && data.translations && typeof data.translations === 'object' && !Array.isArray(data.translations)) {
        if (Array.isArray(data.orphan_keys)) {
            globalOrphanKeys = new Set(data.orphan_keys);
        }
        return data.translations;
    }
    return data; // tuotanto: flat map sellaisenaan
}

/**
 * Selvittää DOM-elementin lähdekontekstin (lähin tunniste) lähdeseurantaa varten.
 * Palauttaa merkkijonon muodossa "source_high::source_low", esim.
 * "#users_filterBar::div.dataset-search-panel" tai "url:/admin::body"
 */
function _extractElementSourceContext(el) {
    if (!el || !el.closest) return 'unknown';
    // Etsi lähin nimetty yläelementti: id, data-component, data-table
    const namedParent = el.closest('[id]') || el.closest('[data-component]') || el.closest('[data-table]');
    const sourceHigh = namedParent
        ? (namedParent.id ? `#${namedParent.id}` : namedParent.dataset.component || namedParent.dataset.table || 'unknown')
        : `url:${location.pathname}`;
    const sourceLow = el.tagName?.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : '');
    return `${sourceHigh}::${sourceLow}`;
}

// Tallennetaan viimeisin ladattu käännössanakirja ja kieli laajempaan scopeen
let currentTranslations = {};
let currentChosenLang = "";
let translationRequestSequence = 0;
let translationRenderQueue = Promise.resolve();

const TRANSLATABLE_SELECTOR = '[data-lang-key], [data-html-lang-key], [data-title-lang-key], [data-aria-label-lang-key]';
const TRANSLATABLE_ATTRIBUTE_FILTER = [
    'data-lang-key',
    'data-lang-variable-key',
    'data-html-lang-key',
    'data-html-lang-variable-key',
    'data-title-lang-key',
    'data-aria-label-lang-key',
];


/**
 * Kääntää sivun valitun kielen mukaisesti.
 * Lukee käännökset /api/translations?lang=xxx -endpointista.
 */
export async function translatePage(chosen_language) {

    const requestSequence = ++translationRequestSequence;
    const requestIsCurrent = () => requestSequence === translationRequestSequence;

    if (IS_DEV_MODE) console.log('translatePage called with language:', chosen_language);

    try {
        let nextDefaultTranslations = defaultTranslations;

        // Jos valittu kieli ei ole englanti, haetaan englanninkieliset käännökset fallbackia varten.
        if (chosen_language !== 'en') {
            try {
                if (window.translationPromises && window.translationPromises['en']) {
                    nextDefaultTranslations = _unwrapTranslationResponse(await window.translationPromises['en']);
                } else {
                    nextDefaultTranslations = _unwrapTranslationResponse(await endpoint_router('translations', { url_params: '?lang=en' }));
                }
                if (!requestIsCurrent()) return;
                if (IS_DEV_MODE && debug) console.log('Default English translations loaded', nextDefaultTranslations);
            } catch (error) {
                if (!requestIsCurrent()) return;
                console.warn('Error fetching default English translations:', error);
                nextDefaultTranslations = {}; // tyhjä fallback ettei kaadu
            }
        }

        // Haetaan varsinaiset käännökset valitulla kielellä
        let nextTranslations;
        try {
            if (window.translationPromises && window.translationPromises[chosen_language]) {
                nextTranslations = _unwrapTranslationResponse(await window.translationPromises[chosen_language]);
            } else {
                nextTranslations = _unwrapTranslationResponse(await endpoint_router('translations', { url_params: `?lang=${chosen_language}` }));
            }
            if (!requestIsCurrent()) return;
        } catch (errResponse) {
            if (!requestIsCurrent()) return;
            if (errResponse && errResponse.status === 404) {
                if (IS_DEV_MODE) console.log('Translations not found for language:', chosen_language);
                const fallbackLang = 'en';
                if (chosen_language !== fallbackLang) {
                    await translatePage(fallbackLang); // yritetään englannilla
                } else {
                    throw new Error('Fallback translations also not found: ' + fallbackLang);
                }
                return; // lopetetaan käsittely tässä vaiheessa
            }
            throw errResponse; // muu virhe, annetaan mennä ulompaan catchiin
        }

        // DOM-renderöinnit ajetaan jonossa. Näin vanha, hitaampi kielipyyntö ei voi
        // valmistua uudemman jälkeen ja palauttaa näkymää vahingossa väärälle kielelle.
        const renderTranslation = translationRenderQueue.catch(() => undefined).then(async () => {
            if (!requestIsCurrent()) return;

            defaultTranslations = nextDefaultTranslations;
            currentTranslations = nextTranslations;
            currentChosenLang = chosen_language;
            document.documentElement.setAttribute('lang', chosen_language);

            // Tyhjennetään globaalien puuttuvien avainten lista, koska aloitamme "puhtaalta pöydältä"
            globalMissingKeys = [];
            globalMissingKeySources = {};

            translateElements(currentTranslations, chosen_language);
            observeDomChanges();

            await refreshCardLanguages(chosen_language);
            await refreshLocalizedDatasetValues(chosen_language);

            if (!requestIsCurrent()) return;
            if (IS_DEV_MODE) {
                window._devLangEditorCurrentTranslations = currentTranslations;
                window._devLangEditorDefaultTranslations = defaultTranslations;
                initDevLangKeyEditor();
            }

            document.body.classList.remove('loading');
        });
        translationRenderQueue = renderTranslation;
        await renderTranslation;
    } catch (error) {
        if (!requestIsCurrent()) return;
        console.warn('translatePage – unhandled error:', error);
        // Virhetilanteessakin poistetaan loading, jotta sivu ei jää jumiin
        document.body.classList.remove('loading');
    }
}
/**
 * Tarkkailee DOM-muutoksia, jotta uudet/lisätyt elementit saadaan käännettyä lennossa.
 * Samalla kerää globaalit puuttuvat avaimet (globalMissingKeys) ja tekee tarvittaessa AI-hakuja.
 */
function observeDomChanges() {
    if (_domObserverActive) return; // Singleton: only one observer
    _domObserverActive = true;

    const observer = new MutationObserver(mutations => {
        // Pidetään listaa lisätyistä nodelista
        let freshlyAddedNodes = [];

        mutations.forEach(mutation => {
            // Lisätyt solmut
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // elementti
                    freshlyAddedNodes.push(node);
                    node.querySelectorAll(TRANSLATABLE_SELECTOR).forEach(childNode => {
                        freshlyAddedNodes.push(childNode);
                    });
                }
            });

            // data-lang-key -attribuutin muutokset
            if (
                mutation.type === 'attributes' &&
                TRANSLATABLE_ATTRIBUTE_FILTER.includes(mutation.attributeName)
            ) {
                freshlyAddedNodes.push(mutation.target);
            }
        });

        // Käännetään nyt kertyneet uudet solmut
        if (freshlyAddedNodes.length > 0) {
            freshlyAddedNodes.forEach(node => {
                translateElement(node, currentTranslations, currentChosenLang, globalMissingKeys);
            });

            // Jos tuli uusia puuttuvia avaimia, yritetään hakea niille käännökset
            if (globalMissingKeys.length > 0) {
                // AI translation writes are a development-only maintenance aid.
                // Production pages, including anonymous login, must keep their
                // local fallback copy without calling the protected write route.
                if (!IS_DEV_MODE) {
                    globalMissingKeys = [];
                    globalMissingKeySources = {};
                    return;
                }

                // Debounce: kootaan kaikki puuttuvat avaimet yhteen ja haetaan kerran
                if (_aiFetchDebounceTimer) clearTimeout(_aiFetchDebounceTimer);
                _aiFetchDebounceTimer = setTimeout(() => {
                    _aiFetchDebounceTimer = null;

                    // Poistetaan duplikaatit, tällä latauksella jo haetut sekä
                    // saman välilehden tuoreen tyhjän vastauksen saaneet avaimet.
                    const retrySuppressedKeys = getSuppressedAITranslationKeys(currentChosenLang);
                    const uniqueMissing = [...new Set(globalMissingKeys)].filter(
                        (key) => !_aiRequestedKeys.has(key) && !retrySuppressedKeys.has(key)
                    );
                    const sourcesSnapshot = { ...globalMissingKeySources };
                    globalMissingKeys = [];
                    globalMissingKeySources = {};

                    if (uniqueMissing.length === 0) return;

                    const skippedSyntheticKeys = uniqueMissing.filter(_isSyntheticE2ETranslationKey);
                    const aiEligibleMissing = uniqueMissing.filter((key) => !_isSyntheticE2ETranslationKey(key));

                    // Merkitään haetuksi ettei haeta uudestaan
                    uniqueMissing.forEach(k => _aiRequestedKeys.add(k));

                    if (IS_DEV_MODE && skippedSyntheticKeys.length > 0) console.log('[AI Translation] Skipping synthetic E2E key(s):', skippedSyntheticKeys);

                    if (aiEligibleMissing.length === 0) {
                        return;
                    }

                    // Verbose-lokitus: dev-tilassa konsoliin + visuaalinen ilmoitus
                    if (IS_DEV_MODE) console.log(`[AI Translation] Fetching ${aiEligibleMissing.length} missing key(s) for lang="${currentChosenLang}":`, aiEligibleMissing);
                    if (IS_DEV_MODE) {
                        _showDevTranslationNotice(`AI: Fetching ${aiEligibleMissing.length} missing key(s): ${aiEligibleMissing.slice(0, 5).join(', ')}${aiEligibleMissing.length > 5 ? '...' : ''}`);
                    }

                    endpoint_router('generateTranslations', {
                        method: 'POST',
                        body_data: {
                            missing_keys: aiEligibleMissing,
                            chosen_language: currentChosenLang,
                            sources: sourcesSnapshot,
                        },
                    })
                    .then(aiTranslations => {
                        // Sulautetaan uudet avaimet nykyiseen käännössanakirjaan
                        let receivedCount = 0;
                        const receivedKeys = new Set();
                        if (Array.isArray(aiTranslations)) {
                            aiTranslations.forEach(item => {
                                if (item[currentChosenLang]) {
                                    currentTranslations[item.lang_key] = item[currentChosenLang];
                                    receivedCount++;
                                    receivedKeys.add(item.lang_key);
                                } else if (item['en']) {
                                    currentTranslations[item.lang_key] = item['en'];
                                    receivedCount++;
                                    receivedKeys.add(item.lang_key);
                                }
                            });
                        } else if (aiTranslations && typeof aiTranslations === 'object') {
                            Object.keys(aiTranslations).forEach(key => {
                                currentTranslations[key] = aiTranslations[key];
                                receivedCount++;
                                receivedKeys.add(key);
                            });
                        }

                        const unresolvedKeys = aiEligibleMissing.filter(
                            (key) => !receivedKeys.has(key)
                        );
                        suppressUnresolvedAITranslationKeys(
                            currentChosenLang,
                            unresolvedKeys
                        );

                        if (IS_DEV_MODE) console.log(`[AI Translation] Received ${receivedCount} translation(s) for lang="${currentChosenLang}"`);
                        if (IS_DEV_MODE) {
                            _showDevTranslationNotice(`AI: Received ${receivedCount}/${aiEligibleMissing.length} translation(s)`);
                        }

                        // Käännetään kaikki puuttuvat elementit uudestaan
                        document.querySelectorAll(TRANSLATABLE_SELECTOR).forEach(node => {
                            translateElement(node, currentTranslations, currentChosenLang);
                        });
                    })
                    .catch(error => {
                        console.warn("[AI Translation] Error fetching translations:", error);
                        if (IS_DEV_MODE) {
                            _showDevTranslationNotice(`AI Translation ERROR: ${error.message}`, true);
                        }
                    });
                }, _AI_FETCH_DEBOUNCE_MS);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: TRANSLATABLE_ATTRIBUTE_FILTER
    });
}

/**
 * Käy läpi kaikki data-lang-key-elementit ja kääntää ne.
 * Jos avaimia puuttuu, pyytää AI-käännöksiä Go-reitiltä /api/generateTranslations (kutsun jälkeen).
 */
function translateElements(translation_data, chosen_language) {
    var all_lang_elements = document.querySelectorAll(TRANSLATABLE_SELECTOR);
    var missing_keys_local = [];

    all_lang_elements.forEach(function (one_element) {
        translateElement(one_element, translation_data, chosen_language, missing_keys_local);
    });

    if (missing_keys_local.length > 0) {
        if (IS_DEV_MODE) console.log("Warning: Missing data-lang-keys:", missing_keys_local);

        // Lisätään puuttuvat globaaliin listaan, observer hoitaa AI-haun seuraavassa vaiheessa
        globalMissingKeys.push(...missing_keys_local);
    }
}

/**
 * Kääntää yhden elementin annetun translation_data:n perusteella.
 * Tukee placeholderien, submit-valuejen ym. asettamista.
 */
function translateElement(one_element, translation_data, chosen_language, missing_keys) {
    const isText = one_element.hasAttribute('data-lang-key');
    const isHtml = one_element.hasAttribute('data-html-lang-key');
    const hasTitleLangKey = one_element.hasAttribute('data-title-lang-key');
    const hasAriaLabelLangKey = one_element.hasAttribute('data-aria-label-lang-key');

    if (!isText && !isHtml && !hasTitleLangKey && !hasAriaLabelLangKey) {
        return; // Ei ole käännettävä elementti
    }

    if (isText || isHtml) {
        const keyAttr = isHtml ? 'data-html-lang-key' : 'data-lang-key';
        const variableOverride = resolveElementTranslationVariable(
            one_element,
            isHtml,
            translation_data,
            chosen_language,
            missing_keys,
        );

        // Haetaan ensin käännös data-lang-key:n perusteella
        let finalTranslation = getTranslation(
            one_element.getAttribute(keyAttr),
            translation_data,
            chosen_language,
            missing_keys,
            variableOverride
        );

        // Jos avain oli puuttuva, kerätään lähdetieto
        const langKeyValue = one_element.getAttribute(keyAttr);
        const baseKeyForSource = langKeyValue?.split('+')[0];

        // DEV-tila: varoitus jos orpo-avainta käytetään sivulla.
        // Tämä EI de-orphanoi automaattisesti — kehittäjän tulee tutkia sovelluslogiikka.
        if (IS_DEV_MODE && baseKeyForSource && globalOrphanKeys.has(baseKeyForSource) && !_warnedOrphanKeys.has(baseKeyForSource)) {
            _warnedOrphanKeys.add(baseKeyForSource);
            console.warn(`[ORPHAN KEY] ⚠️ '${baseKeyForSource}' on merkitty orvoksi, mutta sitä käytetään sivulla. Tarkista sovelluslogiikka.`);
            _showDevTranslationNotice(`⚠️ Orpo avain käytössä: ${baseKeyForSource}`, true);
        }

        if (baseKeyForSource && missing_keys?.includes(baseKeyForSource) && !globalMissingKeySources[baseKeyForSource]) {
            globalMissingKeySources[baseKeyForSource] = _extractElementSourceContext(one_element);
        }

        // Jos data-lang-key ei tuottanut mitään (tai toi itse avaimen),
        // ja elementillä on data-lang-key-fallback, koitetaan sitä samoilla säännöillä
        if (
            finalTranslation === one_element.getAttribute(keyAttr)
            && one_element.hasAttribute('data-lang-key-fallback')
        ) {
            let fallbackKey = one_element.getAttribute('data-lang-key-fallback');
            let fallbackTranslation = getTranslation(
                fallbackKey,
                translation_data,
                chosen_language,
                missing_keys,
                variableOverride
            );
            if (fallbackTranslation !== fallbackKey) {
                finalTranslation = fallbackTranslation;
            }
        }

        // Päivitetään elementin sisältö sen tyypin mukaisesti
        if (isHtml) {
            one_element.innerHTML = '';
            one_element.appendChild(renderAllowedHtml(finalTranslation));
            if (IS_DEV_MODE && debug) console.log('html element:', finalTranslation);
        } else if (one_element.tagName.toLowerCase() === 'input') {
            if (one_element.hasAttribute('placeholder')) {
                one_element.setAttribute('placeholder', finalTranslation);
                if (IS_DEV_MODE && debug) console.log("input placeholder:", finalTranslation);
            } else if (one_element.getAttribute('type') === 'submit') {
                one_element.setAttribute('value', finalTranslation);
                if (IS_DEV_MODE && debug) console.log("input submit:", finalTranslation);
            }
        } else if (one_element.tagName.toLowerCase() === 'img') {
            one_element.setAttribute(
                'alt',
                appendAltContext(finalTranslation, one_element.dataset.langAltContext)
            );
            if (IS_DEV_MODE && debug) console.log('img alt:', finalTranslation);
        } else if (
            one_element.tagName.toLowerCase() === 'option' ||
            one_element.querySelector('span') ||
            one_element.querySelector('i')
        ) {
            // Option-, span- tai i-sisällöt: laitetaan teksti lastChildiin
            if (one_element.lastChild) {
                one_element.lastChild.textContent = finalTranslation;
            } else {
                // Jos jostain syystä ei ole lastChildia, luodaan sellainen
                one_element.textContent = finalTranslation;
            }
            if (IS_DEV_MODE && debug) console.log("option/span/i:", finalTranslation);
        } else {
            one_element.textContent = finalTranslation;
            if (IS_DEV_MODE && debug) console.log("general element:", finalTranslation);
        }
    }

    translateAttributeFromLangKey(one_element, 'title', 'data-title-lang-key', translation_data, chosen_language, missing_keys);
    translateAttributeFromLangKey(one_element, 'aria-label', 'data-aria-label-lang-key', translation_data, chosen_language, missing_keys);
}

function resolveElementTranslationVariable(
    element,
    isHtml,
    translationData,
    chosenLanguage,
    missingKeys,
) {
    const variableAttribute = isHtml ? 'data-html-lang-variable' : 'data-lang-variable';
    const variableKeyAttribute = isHtml
        ? 'data-html-lang-variable-key'
        : 'data-lang-variable-key';
    const literalFallback = element.getAttribute(variableAttribute);
    const variableKey = element.getAttribute(variableKeyAttribute);
    if (!variableKey) {
        return literalFallback;
    }

    const { baseKey, variablePart } = splitTranslationKey(variableKey);
    const resolved = resolveTranslation(baseKey, translationData, defaultTranslations);
    if (resolved) {
        return applyTranslationVariable(resolved, variablePart);
    }

    const localFallback = getLocalTranslationFallback(baseKey, chosenLanguage);
    if (localFallback) {
        return applyTranslationVariable(localFallback, variablePart);
    }

    if (missingKeys && !missingKeys.includes(baseKey)) {
        missingKeys.push(baseKey);
    }
    return literalFallback || formatMissingKey(baseKey, variablePart);
}

function translateAttributeFromLangKey(one_element, attributeName, keyAttributeName, translation_data, chosen_language, missing_keys) {
    if (!one_element.hasAttribute(keyAttributeName)) {
        return;
    }

    const translationKey = one_element.getAttribute(keyAttributeName);
    const variableAttributeName = keyAttributeName.replace('-lang-key', '-lang-variable');
    const variableOverride = one_element.getAttribute(variableAttributeName);
    let translatedValue = getTranslation(
        translationKey,
        translation_data,
        chosen_language,
        missing_keys,
        variableOverride
    );

    const baseKeyForSource = translationKey?.split('+')[0];
    if (baseKeyForSource && missing_keys?.includes(baseKeyForSource) && !globalMissingKeySources[baseKeyForSource]) {
        globalMissingKeySources[baseKeyForSource] = _extractElementSourceContext(one_element);
    }

    const fallbackKeyAttributeName = `${keyAttributeName}-fallback`;
    if (
        translatedValue === translationKey &&
        one_element.hasAttribute(fallbackKeyAttributeName)
    ) {
        const fallbackKey = one_element.getAttribute(fallbackKeyAttributeName);
        const fallbackTranslation = getTranslation(
            fallbackKey,
            translation_data,
            chosen_language,
            missing_keys,
            variableOverride
        );
        if (fallbackTranslation !== fallbackKey) {
            translatedValue = fallbackTranslation;
        }
    }

    one_element.setAttribute(attributeName, translatedValue);
}

/**
 * Yrittää hakea annettua avainta translation_data:sta.
 * Jos ei löydy, tarkistaa defaultTranslations.
 * Jos vieläkään ei löydy, palauttaa avaimen sellaisenaan.
 */
function getTranslation(translationKey, translation_data, chosen_language, missing_keys, variableOverride = null) {
    if (!translationKey) return "";

    const { baseKey, variablePart } = splitTranslationKey(translationKey);
    const translationVariable = variableOverride || variablePart;

    const resolved = resolveTranslation(baseKey, translation_data, defaultTranslations);

    if (IS_DEV_MODE && debug && resolved && !translation_data[baseKey]) console.log("Using fallback English translation for key:", baseKey, resolved);

    if (!resolved) {
        const localFallback = getLocalTranslationFallback(baseKey, chosen_language);
        if (localFallback) {
            return applyTranslationVariable(localFallback, translationVariable);
        }
        if (missing_keys) {
            missing_keys.push(baseKey);
        }
        return formatMissingKey(baseKey, translationVariable);
    }

    return applyTranslationVariable(resolved, translationVariable);
}

export function getTranslationForKey(
    key,
    { fallback = "", countUsage = true } = {}
) {
    if (!key) {
        return fallback;
    }

    const translatedValue =
        currentTranslations[key] ?? defaultTranslations[key];

    if (
        (translatedValue === undefined || translatedValue === null || translatedValue === "") &&
        countUsage
    ) {
        if (!globalMissingKeys.includes(key)) {
            globalMissingKeys.push(key);
        }
        // Koodista kutsuttu avain: lähde on 'code'
        if (!globalMissingKeySources[key]) {
            globalMissingKeySources[key] = 'code::getTranslationForKey';
        }
    }

    if (typeof translatedValue === "string" && translatedValue.trim() !== "") {
        return translatedValue;
    }

    if (fallback) {
        return fallback;
    }

    return getTranslation(key, currentTranslations, currentChosenLang);
}

/**
 * Hakee kieliavaimen kaikki käännökset backendistä (fi, en, ch, yue).
 * Palauttaa objektin { fi, en, ch, yue } tai tyhjät arvot virhetilanteessa.
 * Hyödyllinen tilanteissa joissa tarvitaan useamman kielen teksti kerralla
 * (esim. uudelleennimeämisdialogi).
 *
 * @param {string} langKey - Kieliavain (esim. "tables")
 * @returns {Promise<{fi: string, en: string, ch: string, yue: string}>}
 */
export async function getTranslationsForKey(langKey) {
    const empty = { fi: '', en: '', ch: '', yue: '' };
    if (!langKey) return empty;
    try {
        const data = await endpoint_router('getLangKeyTranslations', {
            url_params: `?lang_key=${encodeURIComponent(langKey)}`
        });
        if (data) {
            return {
                fi: data.fi || '',
                en: data.en || '',
                ch: data.ch || '',
                yue: data.yue || '',
            };
        }
        return empty;
    } catch (err) {
        console.warn('[getTranslationsForKey] error for', langKey, err);
        return empty;
    }
}
