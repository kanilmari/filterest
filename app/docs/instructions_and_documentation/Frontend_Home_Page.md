<!-- Frontend_Home_Page.md: explains the optional Home page and its presentation. -->
<!-- Connects Home navigation, texts, palette, background media and settings with their APIs. -->
<!-- Exists to keep Home page guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Home Page

Part of the [Frontend Guide](Frontend_Guide.md); this section was formerly part of section 2, UI Configuration.

## Optional Home page

The site-wide `separate_front_page` setting defaults to false, retaining the
existing default-dataset start and root history behavior. When enabled, `/`
opens the hidden `front_page` custom view; `/front_page` is never a view address.
The SPA reads the setting and the optional Home-button site name from the
auth-modes response before loading datasets. Explicit dataset/article links
and login/register entry flows retain their existing behavior.

`front_page/front_page_navigation.js` opens Home through the navigation
pipeline, clears dataset selection only after navigation succeeds, writes the
root entry, then retitles it. Repeated clicks on current-session Home do nothing;
bootstrap passes `forceReload` to refresh the current session. The static
`navbarFrontPage` region is rendered by `initTabs`, in the reserved `front-page`
grid area, with a translated label or the configured site name.

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
actions, keeping its one borrowed menu toggle beside the icon in both panel
states with a fixed 10 px gap. The panel’s duplicate toggle is hidden on Home,
marked `aria-hidden="true"` and removed from the tab order. Accessibility is
reconciled immediately after the completed row is mounted, and when Home
returns the toggle. During construction the borrowed button is detached from
the document; reconciling then cannot find it. Signed-in and signed-out Home
use the same mount lifecycle, identity and toggle in both panel states.
The name scales with the available row width beside an open menu too. At widths through 700 px the name
uses 18 px bold: at 320 px, 200 px remain for the name; only names wider than
that budget use an ellipsis. Fintravel, Easelect and Serlog fit. Home applies
no bottom border or shadow to that row.

Home alone keeps the dataset tabs on phones as a centred vertical stack, at
most 480 px wide inside 16 px side gutters, with the shared icons, labels,
current-page and focus styles and at least 44 px touch height. Administrator
actions occupy the following row. Throughout the shell's overlay band (through
1850 px), Home's menu starts below the measured complete header. This keeps the
single borrowed toggle reachable by pointer and keyboard in both menu states;
raising the toggle's own z-index cannot escape its ancestor stacking contexts.
The shell retains the full content width in this band; above it, the open menu
reserves its ordinary sidebar width. Dataset pages retain their existing layout
and hidden phone tabs. The fit controller restores every destination only in a
Home vertical stack when crossing the phone breakpoint, including buttons
hidden in the previous horizontal row; dataset projections keep their fit rule.
When a focused destination no longer fits after leaving the phone stack, focus
moves to Home's visible borrowed toggle before the destination hides. Dataset
pages retain their existing menu focus selection.

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
needs native browser verification. The social-preview default remains the legacy
Serlog image at `/frontend/favicon4S.png`; it is separate from the tab icon.

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
