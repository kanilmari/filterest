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
of the SPA Home. K381 freezes further SPA Home and dynamic-palette development,
with the owner's 17 October 2026 exception for the Serif story text style below. The owner's draft is a local static mockup linking to dataset pages
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

### Serif story text style

The Home palette offers **Text style** (Default / Serif story), **Line reveal**
(Off / Line by line), bounded start-delay/interval ranges, and a Serif-only phone-size stepper (12–18 px, step 1, default 15): translated −/+ buttons have 44 px targets, disable at the bounds and announce the px value through `aria-live`.
The owner's 17 October exception to K381 permits text style; K466 also permits
logical alignment and its phone override; K474 permits phone story size. Other expansion remains frozen. Copy belongs to the source-owned
Finnish/English palette dictionary, without language keys or a migration.

The opt-in `text_style` in presentation schema 5 selects `default` or
`serif_story_v1`; `reveal` holds `mode` (`none` / `lines`), `start_ms` (0–5000,
initial 3000) and `interval_ms` (200–2000, initial 800). Unknown, missing, null,
extra and wrongly typed fields fail strict Go/browser validation. Old v1/v2 rows
read with default typography and reveal off, preserving their stored revision.
Every palette save carries the complete text style even when it was untouched.

Serif story uses upright Georgia / Times New Roman; a non-empty slogan of at most 40 trimmed Unicode code points joins the title as an italic accent (emoji surrogate pairs count once).
Longer slogans appear once as the first paragraph below the title, before the story lines, in italic Georgia / Times New Roman and the accent colour.
The lead keeps its desktop 17–22 px clamp, 1.4 line height and story shadow (17 px at the 1180 px step); at the unchanged 760 px container step, story lines use `phone_story_size` with a 15 px fallback and 1.45 line height (15 → 21.75 px), and the lead follows at size + 1 px (12→13 … 18→19). It is visible from first paint, outside the reveal, without changing story-line indexes; title sizes stay unchanged.
Blank slogans render neither accent nor lead; the site-name title fallback remains, and the hero's language follows its rendered copy.
Keep title and slogan short, e.g. “Matkatiedot ja -edut” + “yhdellä silmäyksellä”.
Each description line becomes one paragraph; blank lines start sections and a
whole line `**…**` marks bold emphasis. Only the outer markers are removed;
other asterisks stay literal. All copy uses text nodes. Default keeps the existing
separate slogan and literal paragraph rendering.

`front_page_serif_story.css` owns responsive fonts, colours and shadows under
`.front-page-hero--serif-story-v1`, with explicit body theme classes overriding
OS preference. Text inherits hero alignment; story and emphasis paragraphs wrap at every
width, keeping authored lines separate and the configured maximum story-column
width. Font sizes use container units (`cqi`) and the 1180/760 px container queries
follow the content scroller's width, accounting for a docked side menu. The hero
uses the full stage width when needed: a title and accent that fit stay on one
line; otherwise the heading wraps in balanced lines inside Home's gutters, and a single word
too long for the content width breaks rather than running off-screen. No navigation,
listing, media or background setting is changed. There are no custom font,
colour or CSS-string controls, and WL170 only reserves this existing ownership.

All lines occupy their full height on the initial render. Optional CSS keyframes
fade for 650 ms and slide from −12 px for 750 ms, after the configured start and
interval; lines beyond 40 share line 40's delay. Reduced motion shows all lines
at once. Entering reduced motion latches completion until the next text render;
leaving it never re-hides lines. Preview, save, Reset and language changes rebuild
the text and restart once; theme changes retain the running nodes and animation.
Deactivation removes the motion listener. No reveal timers or authored inline
styles are used; bounded delays and indexes use CSSOM custom properties.

`T21_home_text_style.spec.ts` is a GET-only fixture proof using the actual signed-in
viewer id. It covers the reference's exact Finnish/English 12-line story, desktop
and phone wrapping, a long slogan at 1920 px with the menu docked, timing, stable
geometry, theme continuity, language restart and reduced motion. Native
screenshots go under `data/testing/wo38a/after/`
(or the configured test runtime root's `wo38a/after/`). It never enables Home.
At 15 px with inherited phone alignment, a non-default text style stores schema 3.
The default style then stores v2 and stays readable by older binaries. Pre-v3 binaries
cannot read a v3 row: before a downgrade, set Text style to Default and Line reveal
to Off and save (which stores v2), or restore the row from a compatible backup.

`front_page/front_page_navigation.js` opens Home through the navigation
pipeline, clears dataset selection only after navigation succeeds, writes the
root entry, then retitles it. Repeated clicks on current-session Home do nothing;
bootstrap passes `forceReload` to refresh the current session. The static
`navbarFrontPage` region is rendered by `initTabs`, in the reserved `front-page`
grid area, with a translated label or the configured site name.

The menu and top navigation share `front_page/front_page_link.js`: the same root address, house symbol,
language renderer and Home activation handler. `front_page_availability.js` owns the effective feature rule
(built-in Home enabled or a server-confirmed custom root). Login-only guests see neither link. The server
supplies a Home-button site name only when its switch is enabled; otherwise the `front_page` language key does.
Home's content read also loads its navigation dictionaries (at most 3 s): Home and dataset labels use the chosen language
from the first paint. The later page-translation pass shares that cache; unchanged labels keep their text nodes and geometry.

When Home is enabled, each dataset owns one top-navigation Home link. The toolbar controller moves that same
node to the first position in the hero's dataset tab row, with the tab surface and the larger native Home
size, whether the side menu is open or closed. Its house icon and translated/site-name label stay together;
only a tight row hides the visual label to retain room for the first dataset. Once that row scrolls away, Home
moves to the compact toolbar's end slot above 700 CSS pixels; on phones it moves right after the menu (start
slot), so visual and keyboard order is menu → Home → site identity → search → filter-toolbar button (keyboard
focus skips the decorative identity). Focus follows the original node. Home never participates in deciding
whether the toolbar is visible. The pre-WO37 rule remains `active && (phone || shouldShowSharedTopBar(...))`:
at widths up to 700 CSS pixels the active toolbar stays visible independently of the hero; above 700 it is
hidden while the inline hero is visible. This phone rule dates from 11 October 2026, before the Home button
was added. Home's own header puts its current-page link first in the tab row, before every dataset; the
trailing actions keep their order. Keyboard order is menu → Home → first dataset. Both rows share
`--top-nav-home-size` and `--top-nav-home-icon-size` from
[top_nav_home_button.css](../../frontend/core_components/front_page/top_nav_home_button.css). Only Home's own
stacked phone navigation gives Home the full tab width, 44px minimum height and its translated/site-name label
(the fit controller never compacts that stack); dataset toolbars keep the 44px square Home. Focus ring,
accessible name and current-page marker are unchanged. An ordinary Home activation bubbles to the same
outside-click closer as a dataset tab: below 1850 CSS pixels it closes the overlay menu and saves that state;
a docked menu stays open, Home inside the menu is an inside click, and modified or non-primary gestures stay
native and leave the menu alone. Menu state still has one owner.

`front_page_availability.js` keeps server-confirmed availability in tab memory;
a stale local-storage value cannot enable a link or route. Auth bootstrap clears
that authority, then accepts the fresh auth-modes response. The settings editor
saves through the existing API and refreshes auth modes. Confirmed policy emits
`HOME_AVAILABILITY_CHANGED_EVENT` with `detail.confirmed=true`; invalidation
uses false. Menu links, dataset toolbars (including cached views) and Home's own
control reconcile immediately. A confirmed disable also replaces visible Home
with the normal start view through the existing startup dataset resolver.
Cross-tab storage changes for `separate_front_page`, custom-root readiness or
the button label invalidate the receiving tab and re-read auth modes. Persisted
values are refresh hints only. Every availability-producing request reserves a
revision before it starts: authentication bootstrap (including the editor's
post-save refresh), storage refresh and the Home content request's 404 path.
One guard in the availability setter rejects older responses before changing
memory, persisted hints or events. Invalidation goes through that same setter.
Failed reads stay disabled; late enabled and disabled responses cannot override
newer policy. Missing or disabled server fields mean off.

Home layout specs G11/G12/G13 use `helpers/home-policy-fixture.ts` for response-only
policy/content and never save server settings. G11 opens the explicit SPA Home
address so an operator's custom root cannot intercept its initial document.
Real-writing Home specs T16/T17/T18 and the deliberate-timeout proof T22 share
`helpers/home-settings.ts` and its cross-process Home writer lock in `os.tmpdir()`.
The lock is exclusive per server origin, derived from the first Home GET's
response URL. That discovery response is discarded; restoration values are read
fresh only after acquisition. The atomic lock directory contains an exclusively
created owner file with PID, start time and test label. A live competing writer
fails immediately before reading a snapshot or sending any write/restore:
`Another real-writing Home spec (pid N, "<label>") is running against <origin>; run real-writing Home specs with one worker (lock: <path>)`.
Nested/repeated snapshots in the same worker share refcounted ownership. The
body's restore retains the hook's reference: T16/T17 release in the shared
afterEach's `finally`, T18 after its complete afterAll cleanup, and T22 after its
independent afterAll verification/recovery and context disposal. Snapshot failure
and unarmed body cleanup also release in `finally`, including restore/readback
failures. Release checks owner PID and identity and never deletes a foreign lock.
The snapshot covers the four switches, presentation (including
absence), article buttons and every hero text part/field (Finnish, English,
usage explanation and language-key identity) before mutation. The Home save trims
hero text, refuses NUL or over 2000 characters and limits its body to 32 KiB, so a
stored hero it could not store back exactly makes the snapshot fail before any
write. Body cleanup stays
in place. T16/T17/T22 also arm one shared `afterEach` timeout backstop immediately
after their snapshot; T18 uses the same runner in its existing worker `afterAll`,
before closing its administrator context. The backstop restores hero texts,
unconditionally re-saves an originally present presentation with the latest
revision, then restores and reads back all six settings plus the hero texts.
Equal presentation updates still advance the revision, so stale presentation
saves conflict. Other writes happen only on a difference; every cleanup step
runs even after another fails, and aggregated failures fail the spec.
The owner's Serif story (schema-3) presentation survives T16's temporary default-style pin unchanged on the pass, body-failure and timeout paths; `helpers/home-settings.test.ts` proves all three and T22 proves the timeout path natively when the development Home has a non-default text style.
Absent presentation is removed through supported application CRUD; absent article
configuration uses the API's equivalent empty list because deletion is protected.
The shared afterEach has a separate 60-second cleanup budget. T22 has a 20-second
body budget, verifies completed button-label switch/hero/presentation changes,
then sets `expectedStatus = 'timedOut'` immediately before hanging with no request
in flight. The expected timeout passes without stopping the worker or skipping
the next serial test. T22's second test is the proof: it checks the actual timeout,
the same worker, no additional cleanup errors and every value against the
independent original snapshot. Earlier failures/timeouts keep the default
expectation and fail; ignoring the assignment also fails. Playwright 1.60 sources
under `node_modules/playwright/` establish this: `types/test.d.ts:2498`,
`lib/worker/workerProcessEntry.js:2554-2556,3073,3085-3086`, and
`lib/runner/index.js:585-594,5293-5297,5430-5449`. T22's `afterAll` only verifies
and recovers differences before disposing its context, with a 60-second budget;
verification, restoration and disposal failures are aggregated and fail the spec.
Real-writing Home specs must run with one worker (and one project for isolated
proofs); the nightly runs them in a separate one-worker pass. With two workers,
some of these specs intentionally fail fast and turn the run red to protect Home.
T21 and G11/G12/G13 stay lock-free because they only replace responses/read Home.
Different server origins are independent. A dead PID's lock is reclaimed with
one atomic retry. SIGKILL leaves a lock until a later run detects its dead PID;
PID reuse by an unrelated live process can retain a stale lock. The diagnostic
names its path for manual removal.

A body request still in flight when the backstop runs may commit afterwards.
Each supervisor job compares the owner's Home switches, layout `json_value`,
article buttons and hero texts before and after its browser run; a difference
stops publication.
An owner editing Home during a run is overwritten by restoration, as before.
Non-Home values (T17's account theme/owned dataset and T18's `login_to_browse`/theme
rows) retain their existing cleanup. A worker crash or killed process runs no hooks.

A 404 JSON error with `error: "front page unavailable"` from `/api/front-page`
confirms Home is off. The shared request pipeline preserves its body as
`error.responseBody`, so recovery does not parse localized diagnostic copy. Recovery
removes the controls and opens the normal start view without a load-error box.
Rejecting an obsolete availability write does not abandon the current visit:
it still opens the start view when a newer policy refresh is pending or failed.
Only a newer response confirming Home enabled keeps the visit, which requests
fresh content after releasing the old request; a failed fresh load offers retry.
Other failures, including other 404s and the fifteen-second timeout, retain retry. A request stopped by a leave the browser then cancelled (Back, then Forward at once; `isLeavingNetworkAbort` counts 3 s from `beforeunload`) loads once more silently before that retry surface appears. The boot gives a bare `/` entry its history identity before DOMContentLoaded (`ensureRootEntryIdentity`; other entries, denied bookmarks included, stay as loaded), so Home's `writeHistoryEntry('/', …, { replace })` is a no-op on an unchanged all-primitive entry state (any object-holding state is still written) rather than a same-document navigation racing Back/Forward (G5).
A response from a departed visit cannot change current availability or navigation.

`G12_top_nav_home_button.spec.ts` intercepts Home, auth-mode and settings responses;
settings saves exercise the real client path without sending writes to the server.
It checks both menu states at 1920, 1440 and 1000 px in both explicit themes over
the opposite OS preference, first-item geometry, focus during scroll handoffs,
menu memory, cached cross-tab disable, root fallback and unavailable/error responses.
Its existing six dataset presentations remain covered at 1440, 1000 and 375 px.
`G13_phone_topbar_measurements.spec.ts` measures 390×844, 412×915 and 430×932 in
portrait and landscape, Home on/off and both menu states, before/after scrolling.
Run both specs serially against a native target serving the intended checkout.
`WO37_PROBE_PHASE=before` on `a9b4520c^` and `after` on the fix selects screenshot
and JSON filenames under the configured test-results directory. Use a separate
Playwright `--output` subdirectory there for each phase to retain both sets. Baseline skips
assertions about the newly added Home control, while checking historical visibility.
Browser contexts discard all intercepted policy and local UI preferences at teardown;
no owner settings or test datasets require restoration.

`front_page/front_page_printer.js` keeps one `/api/front-page` request in flight
per visit, with cancellation, a render generation and a fifteen-second timeout/retry.
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
card collection newest first (`__newest`). Boxes follow tab order in one centred
800px column at every width, above the theme-aware image or video background.

The `front_page_show_blocks` boolean defaults to **true even when absent**, retaining boxes. When false the
public facade resolves no datasets and returns `show_blocks:false, blocks:[]`;
the editor disables and greys its retained box list. The key is registered in
`system_config_checks`, so generic writes also refuse a non-boolean value.
Home has one inner scrolling surface (`.front-page-scroller`); the absolute
background and video remain siblings outside it and cover the viewport. Above
700 px the top row stays before the scroller, with the existing desktop layout.
Row caps stay in the shared compact renderer: 76px images or search's letter fallback,
one-line titles, two-line excerpts and one stretched title link per row; Show all stays 44px.

`front_page_top_row_builder.js` owns the live dataset tabs, admin actions and
borrowed shell menu button. It returns that button and destroys the tab
subscription on teardown. Identity uses the resolved 128 px favicon at 32 CSS px
(the 16 px link remains the fallback). Dataset corner controls keep their own
ownership and focus lifecycle, including retained datasets on Back/Forward.

At `(width <= 700px)`, `front_page_phone_layout.js` is mounted by the printer
and owns the reversible projection. The scroller begins with the sticky
`.front-page-phone-topbar`: menu slot | centred icon and site name | empty
44 px `.front-page-phone-topbar__end` balance slot (`aria-hidden="true"`).
Home has no filter-bar control; the end slot contains no control. The name
stays visible at 18 px bold, with ellipsis for names wider than the centre track.
The menu keeps the shell's 12 px corner inset; safe-area top padding adds to it.
The translucent theme surface has a border and blur, with a solid theme surface
when blur is unsupported. Its stacking level stays below drawers and modals.

The existing row follows the bar inside the scroller: Home and dataset tabs,
top-row article buttons, then administrator actions. The story and dataset
blocks follow in the same scrolling surface. Tabs retain their centred vertical
stack, at most 480 px wide within 16 px gutters, shared labels/icons, current-page
and focus styles, and at least 44 px touch height. The page uses dynamic viewport
height with the existing viewport-height fallback. A border-box ResizeObserver
publishes `--home-phone-bar-size` on the scroller, including safe-area changes;
the scrolled content's own scroll margin clears the bar (the bar has none, so
focusing its menu never scrolls Home) and the text stage subtracts that size
from its viewport minimum. Long text still grows the stage.

Crossing 700 ↔ 701 px moves the same nodes back to their original parents and
order; listeners, translated copy, tab subscription and accessibility attributes
survive. Every focused descendant is preserved; fitting a destination out of a
desktop row transfers focus to the visible menu. Above 700 px and on destroy,
the bar, measurement and observer disappear. Destroy also removes both listeners.
No Home scroll memory or root-fragment policy is added by this projection.

At every width the shared menu remains a fixed full-height drawer, with its
closer at the top-left. Only the collapsed menu shows Home's borrowed opener;
the inactive control and slot are hidden, inert and removed from the tab order.
On phone Home the centre and end tracks remain balanced while that slot is
hidden. While the phone drawer is open, Home's scroller is locked by
`.front-page-scroller--drawer-open`, retaining and restoring its scroll position
on close, breakpoint exit or teardown. Drawer wheel events are not forwarded to
Home; the drawer scrolls natively and keeps its sticky controls and portalled
language panel. Above 700 px wheel forwarding keeps its existing behavior.
Through 1850 px the drawer overlays content; above it the ordinary sidebar width
is reserved. Dataset layout, menu ownership and phone tab fitting are unchanged.
Logo and site-name clicks never close the menu; ordinary outside clicks close
below 1850 px. G14/E10 cover sole-control ownership, focus and corner parity on
scrolled phone Home; G13 measures 320/375/390/414/700 px and the 701 px boundary.
The non-phone CSS hash and desktop DOM test pin the original desktop contract.

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

The five maintained 16 px icons have exact 8× normal and two-colour dark variants.
Run `go run app/server_tools/site_favicon_variants/main.go` offline from the root;
refresh `server_tools/licenses/asset_provenance.json`. The pure helper ignores
zero-alpha RGB and preserves alpha. Two opaque bases must each outnumber any
mixture and cover ≥75% of opaque pixels; bases within two 8-bit steps are ambiguous.
Visible mixtures fit `(1−t)A+tB` within one 8-bit step/channel (257 at 16-bit); dark is `tA+(1−t)B`.
Mixtures touch both opaque bases in their eight-neighbourhood; wider ramps fall back.
Unclear gradients, third/single colours and ambiguous art are rejected; stale dark
files are removed. Pixel tests cover generated and shipped files.
Safe regular siblings supply `data-home-dark-href` on the shell's 128 px icon link
(Vite too); missing/unsafe dark files fall back to the normal 128/16 px icon.
Home alone observes body theme classes and swaps its img live even inside the phone bar;
it falls back once on error and disconnects on teardown. No invert, filter, inline
handler or OS media selection. Light pixels, dataset identities, 16 px names and social previews stay unchanged.
Only `*-128-dark-v1.png` static siblings use `image/png`, `public, no-cache` and
content ETags for GET/HEAD/304; same-date byte replacements return fresh content.

The browser fallback `/favicon.ico` serves the **exact resolved PNG bytes** with
`image/png`, using the same selection as the shell's 16 px head link. Resolution
chooses an existing safe configured PNG basename first, then available site-name
initials (multiple initials before the first letter), then the generated Filterest
F. Unknown, removed, unsafe and non-regular configured files use that same fallback.
GET/HEAD stay public during maintenance and required sign-in. Both icon addresses
share the public frontend rate-limit exemption for repeated loads from one IP.
`Cache-Control: public, no-cache` and content ETags return 304 for unchanged bytes
and fresh content for changed selections/replacements even with matching dates.
The compatibility address `/favicon4S.png` serves the same current site icon.
Shell, login/OTP and first-run documents keep their existing 16/128 px icon links.
Maintenance links `/favicon.ico`; standalone registration, recovery and rate-limit
HTML without icon links use that fallback, as do non-HTML responses (Markdown API
catalogs, JSON, text, XML, images, PDFs and errors) and custom roots without links.
Browser tab/cache behavior still needs native browser verification. Social previews
use the site's normal resolved 128 px icon, as described below.

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
keys above: in Default, slogan first, then description, then the site name.
Serif story uses the cleaned description, then the site name, never the accent.
Whole-line emphasis markers are stripped from description metadata in both styles. Both slogans and
description fallbacks collapse whitespace to one line and limit the excerpt to
200 Unicode characters, including an ellipsis when shortened. It ends at a word
boundary when one is available; a single overlong word is cut at a safe character
boundary. Generic metadata uses the shell's enabled request language negotiation,
including its configured default.

`router/seo_meta_builder.go` shares the translation map already read for shell
recovery. The existing presentation reader adds one settings read on generic
shells to select the preset; a missing row means Default without an error.
No Home dataset or row authorization is bypassed. The Open Graph and Twitter image is the absolute URL of
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
stores `{schema_version:1,placement,items:[{table_uid,row_id,enabled,view?}]}`. No row
means an empty list with `below_text` and version `none`; its first POST creates the key. At most ten unique targets are accepted.
Absent `view` means Article; Page uses `image_first_page_view`. Unknown views return 400 on save and fail-closed on stored read.
The presentation select, picker, label refresh and save carry the chosen projection using existing labels.
Each request needs that presentation's view grant and the dataset's get-results read grant. A view grant follows its catalogue scope: Page's entry is
tableless, so a global grant counts, and the get-results grant keeps the dataset boundary. Title delegates request the chosen
`view_key` with the viewer's session, row policies and SELECT projection.
The first usable header supplies the localized label; permission recovery never
supplies a missing Home view/read grant. Denied, deleted and unlabelled targets
leave no element. Links use `/<preferred-name>/<id>?view=<chosen-view>`; private
identities, revisions and diagnostics never leave this facade. Article links keep
their native behavior. An ordinary Page-button click borrows IFAV's opener/history
so X/Esc and Back return Home, and Forward reopens the same row. Modified clicks retain the native link for a new tab. Default Home and other openers stay unchanged.
Boxes finish under their existing three-second elapsed budget before article
configuration or resolution starts. Articles get a separate three-second elapsed
budget and a child deadline for setting and registry reads. Canonical delegates
retain the caller's transaction context; late results and remaining targets are omitted.
Slow denied or unlabelled targets cannot change box contents or `partial`.

The independent administrator API at `/api/admin/front-page/article-buttons`
uses Home settings’ administrator security profile. GET returns configuration,
its opaque `version`, `unavailable_items` (index, table_uid, row_id, reason) and
`configuration_error`. POST accepts `{article_buttons,version}`, checks every
target through the saving administrator’s chosen presentation (including
disabled items); Page needs the Page grant in its catalogue scope (global), `/api/get-results` and the Page delegate. Stale writes return 409;
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

Home settings has an independent Article buttons section: placement, presentation, readable
grouped dataset catalogue (including authorised `system_about`), searchable
single-row picker, current-label preview, Add, enable/disable, keyboard reorder
and Remove. The picker reuses the shared single-selection dropdown and
`get-results` chosen Article/Page projection, with the returned `resultsPerLoad` page size
and `row_count`; it never uses a cell editor's write callback. Preview reads
honour article header order, multilingual values, language-key roles and owner
visibility. Changing datasets clears the search field and calls the shared
dropdown's opt-in `cancelPendingSearch()` to cancel queued searches and invalidate
option installation from searches already running. The picker's request guards
also ignore obsolete responses, aborts and failures, keeping the current dataset's
options and status even when old and new requests settle without a promise drain
between them. Empty searches still load the current dataset.
Language refresh updates the popup heading, its dialog name and action labels
together with the search labels. Only identities, enabled flags and optional `view` enter the versioned save.
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

Home's JSON setting `front_page_presentation` reads as schema version 5: `anchor`,
`horizontal_margin_px`, `vertical_margin_px`, `alignment`, `phone_alignment`,
`phone_story_size`, `max_width_px`, four theme wash/opacity fields, and `text_style`. The definition
in `frontend/shared/front_page_presentation/definition.json` is imported by the
browser and embedded by Go.
Both margins are 0–320 px (step 1, initial 40);
maximum width is 320–1600 px (step 10, initial 1120). A graphical 3 × 3 button grid
chooses the anchor; arrows select and focus adjacent cells, Home/End choose the
first/last. The existing glyphs choose logical start, centre, end or justify,
with translated names and `aria-pressed`; Enter/Space activate buttons. Start/end
follow the language direction; Finnish/English retain their left/right appearance.
Alignment changes lines within the content-sized block, preserving its anchored
edge. Justify keeps the title and final paragraph lines at the logical start.
Equal axis margins apply at all nine anchors; narrow desktop insets are capped
at 8% of available Home width per side (`min(saved margin, 8cqw, remaining space
above the 320 px text minimum)`). Long text expands downward, making vertical
anchors equivalent when text exceeds the available height; full narrow text
similarly makes horizontal anchors equivalent. Phones (width ≤700 px) use 16 px
insets and ignore the horizontal anchor: the block fills the space between the
gutters, so alignment shows even for short text. The vertical anchor still
applies; long text flows from the top and scrolls. **On phones** offers
`phone_alignment: inherit | start | center`, initially `inherit` (As elsewhere).
Overrides affect hero text, including Serif story; top-row buttons keep their layout. Phone story size is hidden for Default because only Serif story consumes it; switching styles retains the size in the same preview/save/reset draft.

A missing setting returns the centred default with revision `none`: the block
is centred on both axes with logical start alignment. Version-one reads convert
normal → start, artistic → centre, one margin → both and supply default media.
Version-two/three reads map left → start, right → end, retaining centre/justify;
v1–v3 gain inherited phone alignment; v1/v2 gain default text style; v1–v4 gain 15 px.
Strict Go/browser writes require complete v5; the admin API also accepts complete
v2/v3/v4 storage forms. One Go policy (`CanonicalStored`) selects downgrade-safe
storage: at 15 px, inherited phone alignment stores v3 with start → left, end → right,
or ten-field v2 without `text_style` when style is default and reveal is off.
That v2 form discards inactive timings, which read back as 3000/800. Only an
explicit phone alignment stores v4; a size other than 15 px stores v5. Pre-change 9.5.x binaries refuse v5: before rollback, set the size to 15 px and save (v4 or lower).
Before rollback to 9.5.1, also re-save phone alignment **As elsewhere** to remove v4.
Public/admin GETs return v5 and its revision together; reads hash the original
stored bytes and timestamp without rewriting them. POST `{presentation,version}`
writes only presentation under its advisory lock and revision; stale or competing
first writes return 409. Saves stamp the row and return `{version,presentation}`
with actual stored revision and normalized v5. The palette adopts both. Other
Home writes preserve presentation. Generic settings accept canonical v2/v3/v4/v5
only; malformed stored values fail visibly.

Light and dark sections each offer Theme wash and Media opacity (0–100%, step 1).
Wash blends toward white in light mode and the dark background in dark mode;
media opacity controls images and videos separately from that wash. The dark
default retains 20% media opacity and no wash. Light mode uses 75% opacity and
15% wash so media remains visible. Both pairs participate in preview, reset and
save, and CSS follows the application's resolved theme class even when the OS
preference differs. Video cross-fades and image focal points retain their behavior.
`front_page_presentation_renderer.js` applies the whole presentation before the
first content frame; no second settings request or late layout shift is needed.
The single grid stage fills the scroller (less the sticky phone bar on phones)
and grows for long text, with dataset boxes following it.

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
