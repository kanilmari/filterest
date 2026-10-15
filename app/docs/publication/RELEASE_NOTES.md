# Filterest 9.4.2

This patch explains missing article-view access, completes Home's article buttons
and their administrator editor, and keeps site identity and phone navigation
consistent. It includes the changes since 9.4.1 and requires database 9.11.2,
upgraded from 9.11.1.

## Before you update

- **Database 9.11.2 is a text-only patch.** The migration seeds article-view
  explanations and group field-setting warnings in Finnish, English, Chinese
  and Cantonese, followed by the database release record. It fills only missing
  or blank translations and preserves existing nonblank wording. It changes no
  database structure or dataset row values; no right is granted or removed.
  Application 9.4.2 requires the completed 9.11.2 target and minimum. Back up
  and rehearse the normal startup migration path before production rollout.
- **Runner operators must check attachments and sign-in.** The coding-agent
  runner used by the site assistant and Code workspace accepts image attachments
  only from its explicitly configured upload directory. Keep the web server's
  and runner's upload directory the same, with identical canonical spelling.
  Without a configured directory, images are refused; text questions still work.
  Readiness requires a ChatGPT subscription sign-in. API-key logins remain
  unavailable, as do engines without a supported subscription check.
- **The optional operator Home page stays off by default.** To use it, place
  `index.html` in the site's persistent `data/storage/site_root/` directory and
  enable the switch in Home settings. The requirement to sign in before browsing
  (`login_to_browse`) still decides access to the page and its files.

## Article access and presentation

Without the article-view right, card titles, images and other article openers
no longer look clickable. An attempted opening explains why access is unavailable
and retains the current view, address, scroll and selection. Classic and
image-first articles use the same right, including for guests. View field
settings warn for selected groups without the corresponding view right and
link to Permissions without changing how settings are saved. Live updates stop
retrying after a 401 or 403 until authentication or permissions refresh.

Image-first article panels have rounded corners and space above and below,
with smaller gaps on phones. The photo gains matching rounded corners after
scrolling; empty space around the photo still closes the article.

The view menu keeps the product's view names on every site after startup.
The development layout lock appears only in Cards and Article.

## Home and navigation

Administrators can choose, preview, enable, order and remove Home article
buttons through Home settings. Visitors see authorised buttons in the saved
order, either below the text or as outlined pills at the right of the top row.
Phone pills use their own row. Labels follow language and session changes;
unavailable targets are identified in the editor and can be removed.

Home keeps the menu button in the open menu bar and shows its own opener when
the bar is closed. Phone menus fit the viewport, scroll internally on long
pages and retain a reachable close control. Language menus open toward the
available space, scroll within the screen and keep the menu bar open after a
selection. These controls and the article buttons support light and dark themes.

An operator-provided Home page is served at `/`, with its static assets under
`/.site_root/`, when both its file and the Home switch are present. Missing
files or a disabled switch keep the existing Home. File confinement, size/type
limits, a dedicated content security policy and no-store caching protect this
optional surface. Administrators can see its file status in Home settings.

## Site identity and filters

Every page and `/favicon.ico` use the site's own configured or generated icon,
including sign-in and maintenance pages. Shared links preview with the site
icon and Home slogan in the request language, falling back to the Home
description and site name. Dataset previews retain their existing description
fallbacks and never read row content.

Generated name filters hide with their hidden source column. Old addresses
and saved selections discard those hidden name conditions and remove orphan
selection chips while keeping the remaining query and search options.

## Browser loading and runner boundaries

The browser bundle preloads lazy modules from `/frontend/dist/`, matching its
imports. Browsers, including Firefox where the issue appeared, no longer log
MIME-type errors for missing `/frontend/<chunk>.min.js` addresses. Native source
development retains its existing base.

The runner copies only regular files beneath its configured upload directory;
symlinks and parent traversal are refused before the engine runs. Readiness
checks the selected command and subscription account without a model request.

## Maintenance

Tests remove the generic accounts and rows they create. Reviewed asset
provenance is aligned with its files. Future documentation records proposals for calendar rows coloured by category
and one shared settings table for administrators; neither proposal is a shipped
feature in this patch.
