# Filterest 9.5.0

This release gathers the changes since 9.4.3: clearer record names and search
controls, steadier Home navigation, stronger read and administration boundaries,
and storage for future article and image presentation editing. It requires
database 9.12.0, upgraded from 9.11.2. The database minimum and target are both
9.12.0.

## Before you update

- **Rehearse the database upgrade on a backup.** The reviewed migrations run
  on the first start of 9.5.0. They preserve existing article settings while
  copying them into the new storage, associate translations with their datasets,
  columns and folders, extend saved filter choices, and add settings and wording.
  The database release record is written after the batch succeeds. See the
  database section below for the changes an operator should check.
- **Table cells start with three visible lines.** Previously the fixed limit
  was 15. Administrators can set a site-wide limit from 1 to 30 in Site settings;
  longer content scrolls inside the cell and a saved limit is preserved.
- **Read rights apply more consistently.** Private dataset, column and folder
  names and linked-row labels are withheld from readers who cannot read their
  targets. Review groups that previously relied on route access alone for
  administrator functions. Existing cached linked-name fields remain a known
  permission-model exception pending an owner decision.
- **First-administrator creation always requires the setup code.** Enter the
  code from the server log even on the same machine. Per-client and global
  delays limit repeated attempts; each form binds its own authenticator key.

## Article presentations and pictures

The upgrade stores each target's ordered Article fields and widths as one
bundle, with separate Article, image-first and Page-sized image-first values.
It retains authored image-first settings, stores explicit opening-block defaults
and dataset opening policy, and copies existing route audiences once. Conflicting
orders or priorities refuse the conversion atomically. Copying existing settings
avoids repeated grant scans, and completion is recorded only after the full
bundle has been checked. Existing settings edits and dataset/field lifecycle
changes maintain the same constraints. Activation of the new opening policy and Page layout remain later work.

Article presentations share one editor. Field settings combines three article
projections and their opening blocks in one five-column table. It preserves
group differences and scoped drafts; Save applies the changes atomically with
a revision check and verifies them by reading back the complete settings. On
phones, the editor fits the page while the table scrolls sideways inside its
wrapper, keeping the field identity visible.

Each gallery image use can also store its own card presentation and focal point,
independently of the library asset. Version-checked writes reuse row-edit rights
and can adopt eligible local images atomically. Cards keep the exact image-use
identity. This is storage groundwork; its editor, viewer preferences, locks and
smart crop follow separately.

Article and thumbnail arrows are centred SVG chevrons with their existing
accessible names. Disabled arrows use the same grey theme colours and faint
border, including touch controls and an explicit light theme over a dark system
preference. Rich-text links retain validated HTTP, HTTPS and mailto destinations
with safe new-tab attributes; unsafe destinations leave their readable text.
This does not introduce the proposed save-time rich-text cleaning feature.
Image sourcing prefers formats the application can decode, with AVIF retained
at a lower priority.

## Filter bar, categories and table views

- Sorting, filters and categories share one lightly shaded section. Its sections
  stay in place when other content appears. Controls have a subtle theme-aware
  outline, Display settings spans the width, a single selected filter says Clear,
  and results from other datasets use 76 by 76 pixel thumbnails.
- Guests and signed-in readers see one shared section order. Authorized edits
  update open bars. Where the site permits it, users can explicitly choose a
  personal order across datasets and shared or per-dataset visibility memory.
  First visits receive the dataset's visibility default with the results.
  Guests cannot save shared settings; authorized signed-in users retain shared
  order and site-policy editing.
- Category matching explains Accept any / Require all with More results /
  Fewer results hints, translated help and keyboard controls. Administrators can
  order category headings themselves or put the heading with most results first;
  that order remains stable during a visit.
- Administrators can choose a dataset's default view in View content as… .
  Checking the draft saves it for everyone; unchecking returns to the site
  default. Only suitable views are offered and Chart still requires its right.
- Readers without AI access can use text search on readable datasets. AI search
  remains separately restricted; new-dataset and editor guest-read bundles
  exclude intelligent and vector search, without changing untouched grants.
- Searching for an integer, optionally prefixed with #, places the matching
  integer-ID row first under any sort. Other matches retain their order, rights,
  filters, counts and paging. Assisted search shares the rule.
- Table headers identify the server-resolved Newest column and announce sort
  direction to screen readers. Dataset and view headings follow the page's
  heading levels. Closing a still-loading add-row form keeps it closed.

## Home menu and record names

Home stays reachable from dataset pages on computers, tablets and phones. It
comes first in the Home tab row and dataset hero row, keeps its house icon and
large touch target, and follows the menu in keyboard order. Its full-height side
menu and top-left menu button match dataset pages; logo and site-name clicks
keep the menu open. Navigation preserves the side menu's remembered state.
Home follows its server setting, updates across tabs without reloading, keeps
the top bar hidden on Home, and uses the normal start view when unavailable.
Returning to Home settings opens an editable form again.

The Home palette offers an optional Serif story style with a serif title,
italic slogan accent and gradual story-line reveal that respects reduced motion,
language and explicit theme choices. Headings fit beside the side menu, with
balanced wrapping and guidance for short titles and slogans. Existing default
Home text and styling remain unchanged unless the style is chosen.

Cards, tiles, summaries and articles use one safe localized record-name rule.
Configured visible headings retain their order and values; otherwise readable
name fields, a natural label or short text supply the name, with a translated
record fallback. Restricted, hidden and body fields cannot supply inferred names.
Related titles require target visibility and follow language and permission
changes. New datasets and managed asset children receive sensible card roles
when roles were omitted; explicit roles and existing CSV-restored roles remain.
Card previews skip leading empty HTML blocks while retaining paragraph/list
boundaries and the complete stored text. Service-catalogue logos follow asset
metadata, including their short text marks, without service-specific defaults.

## Permissions, translations and notices

Dataset metadata, automation lists, filter values and linked-row labels follow
the caller's read rights, including individual row restrictions. Live row events
also enforce mandatory visibility flags. Linked values retain the source key
when a label cannot be shown. Reference edits and inserts check readable targets
while preventing concurrent key changes from substituting a hidden row;
multi-column references use the complete tuple.

Comments require access to their parent dataset and row; shared guests cannot
delete comments, and administrators can remove comments from deleted accounts.
Translation repair, shared folder changes and empty-row reports require
administrator access. Explicitly activated Agent Tools also require administrator
access as well as their route grant. PostgreSQL role tools are development-only,
protect the active application role and reject names beyond PostgreSQL's limit.
Disabled routes no longer grant tree visibility; Full Permissions saves preserve
disabled functions' grants. Frontend directories and private component files
cannot be browsed through the public asset routes. Coding-agent execution needs
development mode or a configured runner.

Dataset-scoped writes validate body identities and media types, match body and
path targets, and recheck folder moves. Registration uses the common password
rule and name-separation checks, bounds indexed names and email addresses, and
gives the same valid completion answer for new and existing identities.
Guests cannot invoke image sourcing or generate AI translations. Ordinary readers
keep readable interface fallback text until an administrator generates missing
translations; private object names stay withheld and scoped responses are uncached.

Page loads no longer start maintenance writes. Embedding refresh uses an
administrator-only, CSRF-checked POST stream; assistant sessions require an
approved plan. Consistency reports read only. Payment-status reads do not call
providers or change payment state; verified webhooks perform those changes.

Automatic language-key retirement stays paused: startup, reports, scans and
dataset cleanup retain keys and translations. Fix All skips language-key
categories, while an individual garbage-key fix rechecks current evidence.
Scans now require complete, trustworthy source evidence, recognize reviewed
helpers and existing literals, and retain a seven-day safety baseline. Partial
or suspicious scans cannot mark or retire keys.

Missing/deleted dataset notices follow the interface language and preserve site
wording. Actions discarding edits say Cancel changes; plain close/abort actions
keep Cancel. Browser errors from extensions and injections remain in the console.
Application errors show translated generic copy to ordinary readers and shortened
technical details to administrators, with notices cleared on session changes.

## Database 9.11.2 → 9.12.0

On the first start of 9.5.0, the 21 reviewed migrations:

- seed record fallback names and set audit-handler and translation-key headers
  only where no header was configured;
- add Finnish/English copy for dataset default views, paused key retirement,
  category matching help, generic browser errors, redirected dataset notices,
  Cancel changes, first-run setup codes and Display settings / singular Clear;
- associate existing dataset, column and folder translations with their owning
  objects, retaining existing translations and reporting unresolved names;
- add the table cell line-limit setting and its administrator wording;
- add per-image-use card presentation/focal-point storage;
- add article bundle storage and guarded mutations, then copy legacy article
  settings and audiences once with completion checks;
- add the combined article presentations editor's atomic save and its
  interface wording;
- extend existing visual preferences for shared/personal filter bar order and
  visibility memory while preserving site orders, themes and legacy choices;
- suggest first-run names through a read-only database lookup (the setup form
  stays editable) and add the site-wide category heading order choice without
  overwriting saved choices;
- record database 9.12.0 after the preceding migrations succeed.

Fresh installations include the same storage and wording. Translation seeds
preserve site-authored text, replacing only explicitly identified old defaults
where the migration calls for it. The application requires the completed 9.12.0
schema; it does not claim runtime compatibility with 9.11.2.

## Security updates and operator tools

The release builds with Go 1.26.9, golang.org/x/image 0.45.0 and golang.org/x/text
0.43.0, addressing HTTP handling, lossless WebP decoding and Unicode normalization
security issues. Bundled dependency notices are refreshed. Database image builds
install PostgreSQL 16 / PostGIS 3 without expiring APT pins and log the installed
package versions.

Native restore-check rehearses this installation's authenticated backup packet
in temporary databases, compares objects and rows, reports interruption and
proves disposal without stopping the application. It screens extensions,
languages and stored code before restoring. Stored code still runs as superuser
on the live cluster: use the documented operator procedure for trusted packets.

Developer checks improve route-authorization coverage, shared-frontend browser
selection, test cleanup, language-key evidence, Markdown links and file-length
guards. Optional component groundwork and future-feature documentation introduce
no additional shipped interface or runtime feature.
