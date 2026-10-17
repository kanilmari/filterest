<!-- Frontend_Home_Page.md: explains the optional Home page and its presentation. -->
<!-- Connects Home navigation, texts, palette, background media and settings with their APIs. -->
<!-- Exists to keep Home page guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Home Page

Part of the [Frontend Guide](Frontend_Guide.md); this section was formerly part of section 2, UI Configuration.

## Optional Home page

The site-wide `separate_front_page` setting defaults to false, retaining the
existing default-dataset start and root history behavior. When enabled, `/`
opens the hidden `front_page` custom view unless the operator's custom root page
below is active; `/front_page` is never a view address.
The SPA reads the setting and the optional Home-button site name from the
auth-modes response before loading datasets. Explicit dataset/article links
and login/register entry flows retain their existing behavior.

## Operator-provided root page (owner decision K378)

Owner decision K378 (13 October 2026, 18:36Z; owner chat approximately 20:15)
allows a site to place its own static `index.html` at the domain root instead
of the SPA Home. Fintravel's SPA Home therefore needs no further development
for now. The owner's draft is a local static mockup linking to dataset pages
and the contact article. The built-in Home remains in the product and is the
fallback when the custom page is disabled or unavailable. The custom document
covers the **whole page**, including the menu and filter-bar buttons.

K378's authoritative login clarification, verbatim:
“Kirjautumattomille se ei saa näkyä. Pahoittelut että annoin ymmärtää väärin.
Login_to_browsen pitää siitä huolimatta olla määräävä tekijä sovelluksessa.”
When `login_to_browse` is true, signed-out visitors (including retained guest
cookies) cannot read the custom document or any of its files; the existing
root login flow runs first. Signed-in users can see it. When false, guests can
see it too. Explicit `/?login-entry=1` and `/?register-entry=1` keep the existing
authentication shell even when the page is ready. Those query parameters
cannot bypass authentication on the asset prefix.

### Operator steps and persistence

1. Put `index.html` and its assets under the site's **storage root** in a
   `site_root/` directory. Native portable installations use
   `<installation>/data/storage/site_root/index.html`. Docker sees the same
   bind-mounted directory at `/filterest/data/storage/site_root/index.html`
   (`docker/docker-compose.yml` mounts host `data/storage/` there). Legacy flat
   native layouts use `<runtime-root>/storage/site_root/index.html`. The exact
   current path is shown only in Administrator → Site settings → Home settings.
   Do not put these files under maintained `app/`, `runtime/` or `bootstrap/`.
   Source updates and image rebuilds preserve storage. The existing full
   recovery archive's `storage.tar.gz` includes `data/storage/` and therefore
   this directory; a database-only dump does not back up the page. Restore the
   storage archive together with the database containing the setting.
2. Use absolute URLs beginning with `/.site_root/` for assets, for example
   `<link rel="stylesheet" href="/.site_root/styles/site.css">`. CSS may use
   relative paths within that prefix. Use ordinary dataset/article URLs for
   navigation and `/` for Home. A `<base>` element is not permitted. Supply
   multilingual copy, accessibility and theme behavior in the custom document;
   it receives no SPA menu, theme styles or automatic translation.
3. Open Home settings, check the file status, enable **Show the site's own
   index.html at Home**, and save the settings section. The existing
   `system_config` boolean `display_index_html_at_startup` is independent of
   `separate_front_page`. GET and HEAD `/` serve the document when ready. The
   Home/Etusivu link and browser history load `/` as a complete document,
   without rendering the SPA Home first. Dataset pages retain their normal SPA.
4. Disable and save the switch to restore the previous Home/default dataset
   behavior. Removing the file also restores that behavior and makes its asset
   prefix return 404. Missing, unreadable, unsafe or oversized index files
   cannot activate the custom page. Reload Home settings to refresh file status.

The asset prefix `/.site_root/` cannot be a valid dataset alias (aliases start
with a letter or digit and contain no dots), so it needs no database namespace
reservation or alias changes. No migration or new configuration endpoint is needed: a missing setting is
false, and the existing administrator save creates the boolean row. Older
settings clients that omit it preserve its value. The existing auth-modes
response carries **effective readiness** (enabled, safely readable file and
visitor permitted by the login policy), without a filesystem path. Keeping
the flag in tab memory and clearing it on auth bootstrap prevents stale
storage flags; a missing-file fallback learns false instead of repeatedly
reloading itself. History handles custom root before dataset hydration and
article restoration and replaces the landed history entry once.
Home runs the existing unsaved-changes guard before starting a document load.
An accepted departure keeps its latch while the root response is pending.
Recovery observes the browser
Navigation API's event abort signal and rejected navigation results, plus a
finished result that leaves this document alive. Commitment alone does not
release a pending load; neither `beforeunload`, focus nor elapsed time proves
cancellation. Both result promises are observed, and an older attempt's
completion or cancellation cannot release a newer departure.
Chromium can drop HTTP 204/205, Stop or aborted departures without any
page-visible terminal signal; the page cannot distinguish that from a slow
accepted load. The sole recovery for this case is a **new deliberate Home
activation**, by pointer or keyboard, at least ten seconds after the current
attempt started (`HOME_DEPARTURE_RETRY_AFTER_MS = 10000` in
`custom_root_navigation.js`). Earlier activations stay suppressed. No timer
releases the latch, and startup, history and synthetic clicks cannot trigger
this retry. The retry reruns the unsaved-changes guard and starts a fresh attempt
with its own ten-second window. This also works without the Navigation API.
Trade-off: retrying after ten seconds during a genuinely slow accepted load
restarts the same navigation; browsers treat it as a replacement, not a second
page. Browsers without the API cannot report prompt cancellation or an
asynchronous abort for immediate recovery; the deliberate retry remains available.
A SPA document restored from the browser's page cache can navigate to Home
again: its previous departure latch is reset on the persisted `pageshow` event.
After adding files while the SPA is already open, reload the browser to refresh
bootstrap readiness; the recommended setup order places files before enabling.

### Static-file security and browser policy

The dedicated `/.site_root/` route shares the root's session-generation and
browser-binding checks and never falls through to the frontend file server.
No directory listings, hidden files, SQL/configuration/download files or
symlinks are served. Canonical ASCII filenames use letters, digits, `.`, `_`
and `-`, with no leading dot and at most 1024 characters per relative path;
nested directories are allowed. URL escaping
(including encoded and double-encoded separators), backslashes, traversal,
empty segments and directory requests are refused. Go's directory-rooted
handles confine concurrent path replacement; directory/file identity is also
checked. Deploy ordinary readable files, preferably by atomic replacement.

The exact MIME allowlist is HTML, CSS and JavaScript (2 MiB each);
PNG/JPEG/WebP/GIF/AVIF/SVG/ICO images and WOFF/WOFF2/TTF/OTF fonts (10 MiB each);
MP4/WebM video (50 MiB each). Only regular files qualify. Response types are
explicit and `nosniff` prevents browser type guessing. Byte ranges support
video; HEAD has the same policy and headers without a document body. Documents
and assets use `Cache-Control: private, no-store` and `Vary: Cookie`, with no
Last-Modified validator, so changes and login requirements reach the server.
Already downloaded content cannot be recalled from a visitor's device.

The custom document and its files replace the SPA CSP with this policy:

| Directive | Reason |
| --- | --- |
| `default-src 'none'` | Deny resources unless explicitly listed. |
| `script-src 'self'` | Optional local scripts support static-page menus, language and theme controls. Inline scripts, event handlers and evaluation are blocked; move scripts to `/.site_root/*.js`. |
| `style-src 'self' 'unsafe-inline'` | Local CSS and operator-authored mockup style blocks/attributes work without a template nonce or build step. This relaxation applies only to the custom document and files. |
| `img-src 'self' data:` | Local images and embedded static image data work without remote tracking hosts. |
| `font-src 'self'`, `media-src 'self'` | Fonts and videos remain on the same site. |
| `connect-src 'none'` | The static page does not make API, analytics or WebSocket requests. |
| `worker-src 'none'` | Prevent background/service workers from persisting this page's behavior. |
| `object-src 'none'`, `frame-src 'none'` | No plug-ins or embedded frames. |
| `base-uri 'none'` | An HTML base cannot redirect relative links/resources. |
| `form-action 'none'` | No form submissions; contact links open the existing article. |
| `frame-ancestors 'none'` | Prevent framing/clickjacking, alongside `X-Frame-Options: DENY`. |

`Referrer-Policy: no-referrer` also prevents custom-page URLs leaking through
outgoing links. Ordinary links may leave the site; the CSP does not restrict
top-level navigation. The operator's HTML/JS/SVG is **trusted same-origin
code**, not a sandbox for uploads from untrusted users: local scripts retain
the site's origin privileges. Review files before deploying them and keep
secrets outside this directory. CSP restricts external resources and common
injection paths; it does not make a malicious operator-authored page safe.

## Built-in Home presentation

`front_page/front_page_navigation.js` opens Home through the navigation
pipeline, clears dataset selection only after navigation succeeds, writes the
root entry, then retitles it. Repeated clicks on current-session Home do nothing;
bootstrap passes `forceReload` to refresh the current session. The static
`navbarFrontPage` region is rendered by `initTabs`, in the reserved `front-page`
grid area, with a translated label or the configured site name.

The menu and top navigation share `front_page/front_page_link.js`: the same
root address, house symbol, language renderer and Home activation handler.
`front_page_availability.js` owns the effective feature rule (built-in Home
enabled or a server-confirmed custom root). Login-only guests see neither link.
The server supplies a Home-button site name only when the corresponding switch
is enabled; otherwise the existing `front_page` language key supplies the label.

Every dataset owns one top-navigation Home link. The toolbar controller moves
that same node to the beginning of the main dataset tabs while the complete
header row is on screen, or to the compact toolbar otherwise. Phones use the
compact toolbar; its trailing Home icon remains outside the open 300 px menu
at a 375 px viewport. Opening the menu also uses this compact position. Home's
own header marks its link current beside the trailing actions, preserving the
existing menu-to-dataset keyboard order. Compact links hide only the visual label;
their accessible name and native keyboard/link gestures remain available.
The Home activation stops its own click from reaching the menu's outside-click
listener. Menu opening, closing, saved visibility and resize behavior stay with
the existing menu owner; Home navigation writes none of that state.

After the auth-modes response replaces Home and browse policy, it announces
`HOME_AVAILABILITY_CHANGED_EVENT`. Dataset toolbar controllers reconcile the
link immediately and on every toolbar synchronization, including cached-view
reactivation. Disabling removes the old node; enabling creates one link in the
current host without requiring a document reload. Controller teardown releases
the settings listener. Home's own current-page control follows the same event,
including when an administrator disables Home while its page is still open.

`G12_top_nav_home_button.spec.ts` captures all four Home switches and restores
their exact values in independent fixture teardown. It checks the six main
dataset presentations at 1440, 1000 and 375 px in both explicit themes, with
Home enabled/disabled and the menu open/closed. It captures owner screenshots
under the test runtime root's `wo37/before` or `wo37/after` directory, selected
by `WO37_PROBE_PHASE`. The native coordinator runs it serially in card projects;
the before phase captures the old source without requiring a new control.
The after phase also saves disable/enable transitions through the real Home
editor, returns to the same retained dataset node, and checks that the document
was never reloaded. Settings restoration still uses the independent fixture.
Keyboard checks start at the document rather than a pointer-selected table cell,
so their bounded Tab walk measures header reachability rather than table size.

`front_page/front_page_printer.js` makes one `/api/front-page` request per visit,
with cancellation, a render generation and a fifteen-second timeout/retry.
Deactivation empties the view and aborts its request. Navigation's cleanup hook
also removes the visit's listener and session subscription, so returning to a
retained Home container creates a complete new lifecycle. The shared session
generation also clears visible Home on sign-out,
expiry, sign-in and bootstrap before asynchronous work, independently of optional
login synchronization. Resume without a broadcast revalidates identity before
Home loads or reuses blocks; pending opens and responses require the same session
generation, and the response viewer must match the verified identity. The API
pipeline inspects the final response after CSRF recovery, so expiry on a retried
save invalidates Home even when the caller suppresses the sign-in redirect. Compact groups share
`table_views/compact_dataset_group.js` with cross-dataset search (three rows for
search; the server's row cap for Home). Search retains its existing navigation.
Home row links preselect their exact article without adding a dataset entry,
so one Back returns to Home; Show all opens the
card collection newest first (`__newest`). Theme surfaces keep text above a
decorative sized image or original video background, and phones show one column.

The `front_page_show_blocks` boolean defaults to **true even when its row is
absent**, so existing sites and localhost retain their boxes. When false the
public facade resolves no datasets and returns `show_blocks:false, blocks:[]`;
the editor disables and greys its retained box list. The key is registered in
`system_config_checks`, so generic writes also refuse a non-boolean value.
Home's inner `.front-page-scroller` scrolls vertically below a stationary top
row; its background is an absolute sibling, outside that scroller. Row caps
continue to belong to the compact group renderer.

`front_page_top_row_builder.js` composes the existing hero grid/actions and
`createHeroDatasetTabs()` without an active dataset. It borrows the shell's
single menu button into the shared menu slot, restoring its original position
on teardown, and destroys the tab subscription. Site identity uses the actual
server-resolved 128 px favicon at 32 CSS px with browser downsampling (the 16 px
link remains the fallback). Home reserves the complete name before tabs and
actions. Only while the navbar is `collapsed`, Home shows its borrowed menu
opener beside the icon with a fixed 10 px gap. An open menu keeps its own
close control, exactly as on dataset pages; Home's slot is hidden, inert and
`aria-hidden="true"`, with no reserved 44 px width or gap before the icon.
The hidden control leaves the tab order and accessibility tree. Accessibility is
reconciled immediately after the completed row is mounted, and when Home
returns the toggle. During construction the borrowed button is detached from
the document; reconciling then cannot find it. Signed-in and signed-out Home
use the same mount lifecycle, identity and state-dependent menu controls.
Home hides the inactive navbar closer as soon as collapse begins, so its
slide-out never duplicates the newly revealed opener.
Visibility events and resizing reconcile the slot from the mounted navbar,
including when navigation or Back/Forward remounts Home. Focus follows the
visible menu control when opening or closing and survives borrowing and
returning the opener. Dataset corner controls capture menu focus before
releasing ownership on view deactivation, then pass it to the visible shell
opener or the open menu's closer. Activation passes a focused shell opener to
the dataset's visible local control. This also covers retained datasets on
Back/Forward; inactive observers cannot take unrelated focus.
The name scales with the available row width beside an open menu too. At widths through 700 px the name
uses 18 px bold: at 320 px, 200 px remain for the name; only names wider than
that budget use an ellipsis. Fintravel, Easelect and Serlog fit. Home applies
no bottom border or shadow to that row.

Home alone keeps the dataset tabs on phones as a centred vertical stack, at
most 480 px wide inside 16 px side gutters, with the shared icons, labels,
current-page and focus styles and at least 44 px touch height. Administrator
actions occupy the following row. On phones (through 700 px), the open menu is
a fixed drawer starting at the viewport top and bounded by its dynamic height
(`100dvh`, with `100vh` fallback). It overlays Home independently of the number
of destinations or the header height. The menu's existing internal scroll area
reveals lower navigation and account controls; its sticky top row keeps close,
history, theme and language controls reachable while scrolling. The language
panel stays outside that scroll area and fits the viewport separately. Home's
borrowed slot remains hidden without an identity gap while the drawer is open.
Tablets and narrow desktops (above 700 px through 1850 px) retain the menu below
the measured complete header. Raising a toggle's own z-index cannot escape its
ancestor stacking contexts.
The shell retains the full content width in this band; above it, the open menu
reserves its ordinary sidebar width. Dataset pages retain their existing layout
and hidden phone tabs. The fit controller restores every destination only in a
Home vertical stack when crossing the phone breakpoint, including buttons
hidden in the previous horizontal row; dataset projections keep their fit rule.
When a focused destination no longer fits after leaving the phone stack, focus
moves to the navbar's closer while open or Home's borrowed opener while hidden,
before the destination hides. Dataset pages retain their existing menu focus selection.

G11's read-only response fixtures pin the catalogue size for destination geometry.
Its 12-dataset cases cover 320×568, 375×667 and 414×896 in both explicit themes
over the opposite OS theme. They check each menu control's viewport bounds and
pointer target after internal scrolling, the sticky close row, the portalled
language panel, and closing from the drawer. Native Home checks retain menu
ownership and focus coverage without assuming that its destinations fit onscreen.

Home's fitting controller only measures and hides its own hero buttons; it
never moves the navbar's dataset tabs. Draggable navbar tabs navigate on click,
after the drag handler suppresses a drag's trailing click. Their initial mouse
press must not leave Home: deactivation returns the borrowed toggle and removes
Home's navbar offset, moving drag targets before a drop. Tabs without drag
permission retain their immediate mouse-down navigation.

The five maintained 16 px site icons each have a lossless 128 px variant.
`server_tools/site_favicon_variants/main.go` generates exact 8×
pixel replication without dependencies; run it from the repository root with
`go run app/server_tools/site_favicon_variants/main.go`, then update
asset provenance and licence inventory hashes. Go tests verify every source
pixel and alpha against its variant and all three head templates' two sizes.
The variant derives from the already-resolved safe 16 px filename; a missing
or non-regular variant keeps that 16 px file. The phone dataset identity uses
the same head reader as Home, and selectable favicon names remain the 16 px ones.

The browser fallback `/favicon.ico` serves the **exact resolved PNG bytes** with
`image/png`, using the same selection as the shell's 16 px head link. Resolution
chooses an existing safe configured PNG basename first, then available site-name
initials (multiple initials before the first letter), then the generated Filterest
F. Unknown, removed, unsafe and non-regular configured files use that same fallback.
Both GET and HEAD are public, including with sign-in required for browsing and
during maintenance. Both icon addresses share the public frontend assets' rate-limit
exemption, so repeated loads and revalidations from one IP remain available.
`Cache-Control: public, no-cache` and a content-based ETag
require revalidation; an unchanged icon returns 304, while a changed selection or
replaced image returns current bytes even when file modification dates coincide.
The compatibility address `/favicon4S.png` serves the same current site icon.

Shell, login/OTP and first-run documents keep their existing 16/128 px icon links.
Maintenance links `/favicon.ico`; standalone registration, template-recovery and
rate-limit HTML without icon links use that fallback. Markdown API catalogs,
JSON, plain text, XML, images, PDFs and non-HTML errors also use the browser's
origin fallback when it requests an icon. A custom root document such as K378's
does the same when its own HTML has no icon link. Browser tab/cache behavior still
needs native browser verification. Social previews use the site's resolved
128 px icon, as described below.

Fixed language keys `site_front_page_title`, `site_front_page_slogan` and
`site_front_page_description` store three independent Finnish/English texts.
The title falls back to the site name (or Home); empty slogan/description are
hidden independently. The slogan appears first under the title at a larger size,
and the description appears last at normal size. Both support multiple lines:
blank lines separate plain-text paragraphs and single line breaks remain. Text
never flows into columns. Home settings uses the shared language-key editor,
with a single-line title and full-width slogan/description textareas, saving both
legacy language columns and served translations. Fixed `front_page_hero` sources
retain intentional empty keys through catalog cleanup. The description key and
three-field guidance are seeded by DB 9.11.0's migration, also used by bootstrap.
Saving settings sections refreshes visible Home without changing navigation/history.

### Shared-link metadata

The generic application document (Home, administrator pages and sign-in entry
shells without an authorized dataset) describes the site using the public Home
keys above: slogan first, then description, then the site name. Both slogans and
description fallbacks collapse whitespace to one line and limit the excerpt to
200 Unicode characters, including an ellipsis when shortened. It ends at a word
boundary when one is available; a single overlong word is cut at a safe character
boundary. Generic metadata uses the shell's enabled request language negotiation,
including its configured default.

`router/seo_meta_builder.go` shares the translation map already read for shell
recovery; the Home keys add no per-request query and need no Home dataset or row
authorization bypass. The Open Graph and Twitter image is the absolute URL of
the same resolved `Favicon128Path` as the document's 128 px icon link, with the
same configured-file, initials and default fallback. Open Graph includes the
site name as image alternative text and reports 128×128 only for that variant;
a missing variant keeps the resolver's original icon without invented dimensions.
All copy remains plain strings escaped by Go's `html/template`.

Authorized dataset documents retain their own language resolver and description
order: `search_slogan_<dataset>`, the accepted dataset UID's description, then
its title (or site name if no title exists). Row addresses keep dataset metadata
and never read row content for previews (WL140). Standalone `/login` has no
preview tags; a custom project's page owns its metadata separately. Search
indexing and authentication rules remain in force.

Home's server response also supplies `article_buttons: [{href,label}]` and
`article_buttons_placement` (`below_text` or `top_row`), independently of boxes.
The optional `system_config.front_page_article_buttons` JSON setting (value type 5)
stores `{schema_version:1,placement,items:[{table_uid,row_id,enabled}]}`. No row
means an empty list with `below_text`; at most ten unique targets with positive
dataset UIDs and canonical numeric row IDs are accepted. Labels are never stored.
Each request checks the current viewer’s article-view grant, dataset visibility/read grant and canonical
`article_view` results under that session, including row policies and SELECT
projection. The first usable header-role value in the returned article field
order supplies the label; development permission recovery never supplies a
missing article/read grant for these links. The title is
localized like dataset values; language-key headers
use the same public translation reader as the interface. Denied, deleted and
unlabelled targets disappear completely. Only authorized links carry their
ordinary `/<dataset-or-alias>/<id>?view=article_view` address; private target
identities, revisions, diagnostics and configured totals never leave this facade.
Boxes finish under their existing three-second elapsed budget before article
configuration or resolution starts. Articles get a separate three-second elapsed
budget and a child deadline for setting and registry reads. Canonical delegates
retain the caller's transaction context; late results and remaining targets are omitted.
Slow denied or unlabelled targets cannot change box contents or `partial`.

The independent administrator API at `/api/admin/front-page/article-buttons`
uses Home settings’ administrator security profile. GET returns configuration,
its opaque `version`, `unavailable_items` (index, table_uid, row_id, reason) and
`configuration_error`. POST accepts `{article_buttons,version}`, checks every
target through the saving administrator’s canonical article read (including
disabled items), and creates an absent setting. Stale writes return 409;
invalid or unreadable targets return 400. An unavailable saved target stays in
private configuration for explicit repair/removal. Generic settings writers
refuse this key, including deletion (clear the list with a versioned save).
The final generic DELETE also excludes this key and rolls back a partial delete;
this protects a first save even when deletion's preflight saw an absent setting.
Route startup supplies and reconciles its tableless permission,
and the existing administrator permission seed grants it. Home renders only these viewer-filtered links, in payload order, using the
payload label as the accessible name. Empty lists have no wrapper. The stored
placement selects either links immediately below the description inside the
text block, or outlined pills at the far right after the dataset tabs, before
administrator actions when present. Top-row pills have transparent backgrounds,
2 px theme-text borders, rounded ends, bold labels and generous horizontal padding.
On wider screens, Home centres tabs, pills and actions vertically through its
page-scoped row rule, which outranks the shared dataset hero's top alignment.
Opposing theme-background halos around text and both border edges preserve their
contrast over images, video and either Home wash without adding a top strip.
Below-text links retain their shared primary-button appearance. At
700 px and below, below-text links fill the text block and top-row links occupy
a full-width row beneath the tabs, with each pill filling the row. Buttons have a 44 px minimum height and
visible keyboard focus. A language change cancels an obsolete Home read and
refetches the complete payload; session changes use the existing visit guards.
Labels never trigger another public title request.

Home settings has an independent Article buttons section: placement, readable
grouped dataset catalogue (including authorised `system_about`), searchable
single-row picker, current-label preview, Add, enable/disable, keyboard reorder
and Remove. The picker reuses the shared single-selection dropdown and
`get-results` article projection, with the returned `resultsPerLoad` page size
and `row_count`; it never uses a cell editor's write callback. Preview reads
honour article header order, multilingual values, language-key roles and owner
visibility. Changing datasets clears the search field and calls the shared
dropdown's opt-in `cancelPendingSearch()` to cancel queued searches and invalidate
option installation from searches already running. The picker's request guards
also ignore obsolete responses, aborts and failures, keeping the current dataset's
options and status even when old and new requests settle without a promise drain
between them. Empty searches still load the current dataset.
Language refresh updates the popup heading, its dialog name and action labels
together with the search labels. Only stable identities and enabled flags enter the versioned save.
Unavailable administrator targets remain visible as warnings with Remove;
they must be removed before saving. A stale save keeps the draft, shows the
existing Home conflict message and requires explicit Reload. The section
participates in the settings view's dirty/cleanup lifecycle and supplies keyed
Finnish, English, Chinese and Cantonese fallback copy without a migration.

`T17_home_article_buttons.spec.ts` creates its own dataset row and restores the
article configuration through the dedicated API before removing that dataset.
It refuses invalid configuration and unavailable targets before mutations:
the protected API cannot resave an unreadable target. If the setting was absent,
the spec establishes and restores a behaviourally equivalent empty-list baseline,
records that exception and verifies both viewers' omission of buttons. The API
cannot restore absence; a target with an existing valid setting is required
when verification must preserve the setting's existence exactly.
It pins and exactly restores the account theme, including an absent preference,
and restores the Home switches. At 1280 px it checks that top-row pills follow
the last visible tab and reach the row's content edge, allowing only the
administrator actions and their gap after them. It also checks transparent pill
styling and text/border contrast against the protective theme halos in both
account themes, over the opposite OS preference. The native coordinator runs it serially.

The administrator-only house-and-palette button beside the gear lazy-loads
`admin_tools/home_palette_builder.js` with the same `/api/admin/front-page`
permission. Both Home and dataset palettes use `presentation_palette_shell.js`
and `presentation_palette.css`: dragging, native resizing, translated controls,
close/Escape focus, status toasts and draft ownership have one implementation.
Closing keeps preview; Reset restores saved values and panel geometry; leaving
Home releases preview. Save preserves edits made while its request is pending.

Home's JSON setting `front_page_presentation` uses schema version 2: `anchor`,
`horizontal_margin_px`, `vertical_margin_px`, `alignment`, `max_width_px`,
`light_wash`, `light_opacity`, `dark_wash` and `dark_opacity`. The single definition
in `frontend/shared/front_page_presentation/definition.json` is imported by the
browser and embedded by Go. Both margins are 0–320 px (step 1, initial 40);
maximum width is 320–1600 px (step 10, initial 1120). A graphical 3 × 3 button grid
chooses the anchor; arrows select and focus adjacent cells, Home/End choose the
first/last. Four original alignment glyph buttons choose left, centre, right or
justify, with translated names and `aria-pressed`; Enter/Space activate buttons.
Alignment changes only lines within the content-sized block up to its maximum
width, preserving its anchored edge. Justify keeps the title and final paragraph
lines at the left. Equal axis margins apply at all nine anchors; narrow desktop
insets are capped at 8% of the available Home content width per side
(`min(saved margin, 8cqw, remaining space above the 320 px text minimum)`). Long text expands downward, making
vertical anchors equivalent when the text exceeds the available height; full
narrow text similarly makes horizontal anchors equivalent. Phones (width ≤700 px, matching the shell) use 16 px
insets instead of the saved margins and ignore the horizontal anchor: the block
is centred and takes the whole width between
the gutters, so alignment shows even for short text; the vertical anchor still
applies (the default block is centred on phones too), and long text flows from the
top and scrolls.

A missing setting now returns the centred default with revision `none`: the
block is centred on both axes while lines start at the left. This replaces the
old centred-heading layout for every site without a saved presentation. Reads
convert development version-one rows (normal → left, artistic → centre, one
margin → both) and supply default media values. All writes require version 2.
Public/admin GETs return presentation and its revision together; conversion hashes
the original stored bytes and timestamp. POST `{presentation,version}` writes
only presentation under the same separate advisory lock and row revision;
stale or competing first writes return 409. Every successful save stamps its row.
Hero, boxes and switch writes omit and preserve presentation. Generic settings
writes use the same strict validation; malformed stored values fail visibly.

Light and dark sections each offer Theme wash and Media opacity (0–100%, step 1).
Wash blends toward white in light mode and the dark background in dark mode;
media opacity controls images and videos separately from that wash. The dark
default retains 20% media opacity and no wash. Light mode uses 75% opacity and
15% wash so media remains visible. Both pairs participate in preview, reset and
save, and CSS follows the application's resolved theme class even when the OS
preference differs. Video cross-fades and image focal points retain their behavior.
`front_page_presentation_renderer.js` applies the whole presentation before the
first content frame; no second settings request or late layout shift is needed.
The single grid stage fills the scroller below the stationary top row and grows
for long text, with dataset boxes following it.

Background uploads retain PNG/JPEG/WebP with a 10 MiB file ceiling, plus
MP4/WebM with a 50 MiB ceiling matching the media library. The request body
allows 1 MiB of multipart overhead. Videos are signature-checked and stored
only under `site_media/front_page/original/`; the protected route refuses
resized video URLs, other files and disabled Home access. The decorative video
uses autoplay, mute, loop, inline playback and focal-point positioning with
`object-fit:cover`. Reduced motion disables autoplay, changes pause playback,
and teardown releases its source and preference listener. Image variants,
focal points and transactional replacement cleanup retain their existing rules.

Admin → Site settings → Home settings uses the `/api/admin/front-page` permission
through the custom-view registry. The editor searches accounts by display name,
keeps global settings/background drafts across scope changes, and asks before
discarding unsaved blocks. Native inputs and up/down buttons work by keyboard.
Scope writes include the loaded opaque revision; a conflict keeps the draft and
requires an explicit reload before retrying. Reset and Copy common refresh the
chosen user's inheritance and read-access warnings from the API. Settings,
scope lists and staged background files/focal points save separately through the
routed pipeline, with translated live feedback. The shared web-image picker
supplies a local File to the same background upload flow. Deactivation releases
previews and requests and empties the management form so returning fetches fresh
settings. Both explicit themes use shared tokens; phones use one column and
controls have 44 px targets.
