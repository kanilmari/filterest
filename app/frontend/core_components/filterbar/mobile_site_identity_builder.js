// mobile_site_identity_builder.js
// Builds the site's existing server-owned name and favicon for a phone toolbar.
// Connects shell metadata to the shared dataset bar without translating a proper name.
// Reserves image geometry while the browser loads its public icon.
import { formatSiteNameForDisplay, getCurrentSiteName } from '../state_stores/site_identity_reader.js';

export function buildMobileSiteIdentity() {
    const element = document.createElement('div');
    element.className = 'dataset-shared-topbar__site-identity';
    element.dataset.testid = 'mobile-site-identity';
    const icon = document.createElement('img');
    icon.width = icon.height = 32;
    icon.alt = '';
    const favicon = document.querySelector('link[rel~="icon"]');
    if (favicon?.href) icon.src = favicon.href;
    else icon.hidden = true;
    const name = document.createElement('span');
    name.textContent = formatSiteNameForDisplay(getCurrentSiteName());
    name.title = name.textContent;
    element.append(icon, name);
    return element;
}
