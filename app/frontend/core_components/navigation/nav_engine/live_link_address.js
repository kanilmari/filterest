// live_link_address.js
// Keeps the address of an application link current while the link stays on the page.
// Bridges the dataset catalogue (public names and aliases) and the page's address language.
// Used by the menu's dataset links, the dataset tabs above lists and the cards' row links.
//
// An application link is followed by search engines, opened in a new tab and
// copied, so its address must be the one that page has now: a dataset's public
// name can change while the page is open (an alias renamed or removed), and a
// page opened in an explicit language (?lang=en) keeps that language in the
// links it writes. A link registered here is rewritten when the catalogue
// changes and whenever a person is about to use it. Registered links are found
// through their data-live-href mark, so a link removed from the page is not
// kept in memory.

import { hasDatasetAccessSnapshot, subscribeDatasetAccessRegistry } from "./dataset_access_registry.js";
import { getAddressLanguageParameter } from "../../state_stores/lang_preference_reader.js";

const LIVE_LINK_SELECTOR = "a[data-live-href]";
const addressReaders = new WeakMap();
const REFRESH_EVENTS = ["focus", "pointerdown", "contextmenu", "click"];

/**
 * Adds the page's address language to an application path, when the page was
 * opened with one of the site's enabled languages. An existing lang is kept.
 * @param {string} path - a path, optionally with a query and a fragment
 * @returns {string}
 */
export function withAddressLanguage(path) {
    const language = getAddressLanguageParameter();
    if (!language) return path;
    const address = new URL(path, location.origin);
    if (!address.searchParams.has("lang")) address.searchParams.set("lang", language);
    return address.pathname + address.search + address.hash;
}

/**
 * Tells whether a press on an application link asks the browser to open it
 * elsewhere: Ctrl, Cmd, Shift or Alt opens a new tab or window, or downloads.
 * The browser does that itself, so the application must not also open the
 * destination in place. A middle-button press fires no click at all.
 * @param {Event} event
 * @param {Element} [link] - the pressed control; by default the listener's element
 * @returns {boolean}
 */
export function asksBrowserToOpenElsewhere(event, link = event?.currentTarget) {
    return link instanceof HTMLAnchorElement && link.hasAttribute("href")
        && Boolean(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
}

function refreshLink(link) {
    const readAddress = addressReaders.get(link);
    if (!readAddress) return;
    // Without a catalogue a dataset has no known public name, and its internal
    // name must not reach an address: a link keeps the address it has, and a
    // new link waits without one (an ordinary click still opens it in place),
    // until the catalogue arrives and rewrites every registered link.
    if (!hasDatasetAccessSnapshot()) return;
    const address = readAddress();
    if (address && link.getAttribute("href") !== address) link.setAttribute("href", address);
}

/**
 * Gives a link its address now and keeps it current.
 * @param {HTMLAnchorElement} link
 * @param {() => string} readAddress - returns the link's address as of now
 */
export function bindLiveLinkAddress(link, readAddress) {
    if (!(link instanceof HTMLAnchorElement)) return;
    const firstBinding = !addressReaders.has(link);
    addressReaders.set(link, readAddress);
    link.dataset.liveHref = "";
    refreshLink(link);
    if (!firstBinding) return;
    const refresh = () => refreshLink(link);
    for (const type of REFRESH_EVENTS) link.addEventListener(type, refresh);
}

/** Rewrites every registered link on the page. */
export function refreshLiveLinkAddresses(root = globalThis.document) {
    // The catalogue module also runs where there is no page (server-side tests).
    if (!root?.querySelectorAll) return;
    for (const link of root.querySelectorAll(LIVE_LINK_SELECTOR)) refreshLink(link);
}

subscribeDatasetAccessRegistry(() => refreshLiveLinkAddresses());
