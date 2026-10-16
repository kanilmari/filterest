<!--
What: Explains the creation, translation, provenance, and retirement of language keys.
Between: Connects public bootstrap, migrations, language APIs, and frontend rendering.
Why: Keeps translated interface copy available before use and maintenance out of user messages.
-->
# Lang Key Lifecycle

> How lang keys are created, tracked, translated, renamed, deleted, scanned, and marked as orphans.

This document captures the full lifecycle of Filterest's multilingual key system. It is intended as a reference for developers and AI agents working with the `system_lang_keys` / `system_lang_key_sources` tables.

## Table of Contents

1. [Schema Overview](#1-schema-overview)
2. [Creation Paths](#2-creation-paths)
3. [Source Tracking](#3-source-tracking)
4. [AI Translation](#4-ai-translation)
5. [Translation Serving](#5-translation-serving)
6. [Modification — RENAME Operations](#6-modification--rename-operations)
7. [Deletion — DROP Operations](#7-deletion--drop-operations)
8. [Startup Scanning & Orphan Marking](#8-startup-scanning--orphan-marking)
9. [Consistency Checks (Admin UI)](#9-consistency-checks-admin-ui)
10. [Context Management (`usage_explanation`)](#10-context-management-usage_explanation)
11. [File Inventory](#11-file-inventory)
12. [Design Principles](#12-design-principles)

---

## 1. Schema Overview

### `system_lang_keys`

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment primary key |
| `lang_key` | text UNIQUE | The key identifier (e.g. `search_&_filter`, `updated`) |
| `fi` | text | Finnish translation |
| `en` | text | English translation |
| `ch` | text | Chinese translation |
| `description` | text | Auto-generated or manual context description for AI |
| `last_used` | date | Last time the key was requested by the frontend |
| `relates_to_table` | text | Which DB table the key belongs to (auto-populated) |
| `lang_key_type` | integer FK | References `system_lang_key_types` |
| `search_vector_simple` | tsvector | Full-text search index |
| `created` | timestamp | Row creation time |
| `updated` | timestamp | Last update time |
| `creation_spec` | text | How the key was created |

### `system_lang_key_sources`

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment primary key |
| `lang_key_id` | integer FK | → `system_lang_keys.id` **ON DELETE CASCADE** |
| `source_type` | text | Open vocabulary; see the source types and counting rule in §3. |
| `source_high` | text | Primary identifier (table name, file path, folder name, etc.) |
| `source_low` | text | Secondary identifier (column name, username, etc.) |
| `last_seen` | date | Last scan or usage date |
| `usage_explanation` | text | Per-source explanation of what the key does in this specific location. Serves two purposes: (1) **AI translation context** — tells the translator what tone, style, and meaning to use (e.g., `search_slogan` → "Marketing tagline on search page hero: should be inviting and encouraging, not a literal translation"); (2) **Developer traceability** — documents what the key does in each specific UI location. Set by seeds, APIs and schema/table/folder scans; authored explanations are preserved. |

**Unique constraint:** `(lang_key_id, source_type, source_high)` — prevents duplicate source records.

**FK CASCADE:** Deleting a row from `system_lang_keys` automatically removes all its sources.

### `system_lang_key_types`

Simple lookup table: `(id, lang_key_type)` — categorizes keys (e.g., UI label, column name, etc.).

---

## 2. Creation Paths

Lang keys enter the system through several paths:

### 2.1 Frontend Dynamic Keys (`data-lang-key` attribute)

The frontend generates lang keys by assigning `dataset.langKey` to DOM elements:

```js
button.dataset.langKey = 'save_permissions';
span.dataset.langKey = 'search_&_filter';
```

> **Convention:** Always use `el.dataset.langKey = 'x'` in JS. Never use `el.setAttribute('data-lang-key', 'x')`. The `data-lang-key="x"` HTML attribute form is acceptable in `.html` template files only.

These keys are **declarative** — they're used in code but may not exist in `system_lang_keys` yet. The startup code scanner (`PopulateLangKeySources`) discovers them by scanning `.js`, `.html`, and `.go` files for `langKey` / `lang_key` patterns and creates source records with `source_type='code'`.

### 2.2 Admin UI — Direct Table Editing

`system_lang_keys` is itself a dynamic table (CRUD-editable in the admin panel). Admins can insert keys directly with translations. When they do, `EnsureLangKeySourceForCRUDMutation()` creates a source record:

- `source_type = 'manual_crud'`
- `source_high = 'admin_ui'`
- `source_low = <normalized_username>`

### 2.3 Table/Folder/Column Creation

When the supported dataset-creation or column-addition workflow creates schema objects, it also writes readable schema-derived labels in the same transaction. The write covers the dataset/column name plus the search, sort, add-row, and dataset-heading keys the interface constructs from it.

- **Creation-time label persistence** (`EnsureDatasetInterfaceLabels` /
  `EnsureColumnInterfaceLabels`) — fills only languages enabled for the site and
  writes both `system_lang_keys` language columns and matching
  `system_lang_key_translations` rows. It never overwrites authored copy.
- **Startup scanning** (`PopulateLangKeySources`) — refreshes `source_type='table'`, `'column'`, or `'folder'` records for keys that already exist. It does not create a missing key or translation value.
- **Primary key check** (`EnsurePrimaryKeyLangKeys`) — ensures PK columns like `id` have lang keys.

Migration `20260920000002_create_dataset_interface_labels.sql` applies the same schema-derived fallback to already registered datasets. The deterministic labels remain editable through the language-key API when a site wants more natural or fully translated copy.

### 2.4 Tree Node Rename (`upsertLangKey`)

When renaming tables/folders via the tree view, `upsertLangKey()` either updates an existing key or creates a new one:

```go
// If old key exists → UPDATE lang_key, fi, en, ch
// If not found      → INSERT new row with translations
```

After the key exists, `upsertLangKeySource()` ensures a source record via `ON CONFLICT DO UPDATE`.

### 2.5 AI-Generated Keys

`GenerateTranslationsHandler` can create new lang keys when the AI generates translations for keys that don't yet exist:

```go
INSERT INTO system_lang_keys (lang_key, en, fi)
VALUES ($1, $2, $3)
ON CONFLICT (lang_key) DO UPDATE SET ...
```

It also creates empty placeholder keys for description population:

```go
INSERT INTO system_lang_keys (lang_key, description)
VALUES ($1, $2)
ON CONFLICT (lang_key) DO UPDATE SET description = ...
```

---

## 3. Source Tracking

**One form for a code source: the file.** A `code` source records `source_high` as the path of the file that uses the key, and `source_low` empty. The start-up scan writes this form, so a seed migration that records a folder instead creates a second record for the same use, and its hand-written usage explanation expires after seven days while the scan's record survives. Write the file path.

Every lang key can have **multiple** source records. A key like `updated` may appear in code, as a column name in 10 tables, and have been manually edited in the admin UI — that's 12+ sources.

### Source Types

| `source_type` | `source_high` / `source_low` | Created by | Counts as use today? |
|---|---|---|---|
| `code` | file path / `''` | Startup scanner, seeds | Yes |
| `table` | dataset / dataset | Schema scanner and label creation | Yes |
| `column` | dataset / column | Schema scanner and label creation | Yes |
| `prefix`, `suffix`, `db` | legacy scanner identity | Historical source records | Yes |
| `dataset_header` | dataset / header field | Dataset header settings | Yes |
| `column_value` | `table.column` / value | hasLangKey scanner | Yes |
| `folder` | folder name / name or `''` | Folder scanner and writes | Yes |
| `view` | view registry / view name | Startup scanner | Yes |
| `group` | group registry / group name | Startup scanner | Yes |
| `foreign_key` | `schema.table.column` / column | FK-value scanner | Yes, including the translations table reference |
| `front_page_hero` | hero identity / field | Home settings and seeds | Yes |
| `admin_api` | `admin_lang_key` / author | Admin language-key API | Yes |
| `dev_editor` | editor identity / author | Development editor | Yes |
| `template`, `javascript`, `migration`, `schema` | declared source identity | Seed-written evidence | Yes |
| `manual_crud` | `admin_ui` / normalized username | Generic CRUD editing | No |
| `orphan` | `consistency_scan` / `''` | Orphan marking | No |
| Any other type | source-owned identity | Existing or future writer | Yes |

The shared SQL rule in `lang_key_consistency_checks.go` excludes only `orphan`
and `manual_crud`. B1 does not change what counts as use. In particular,
`foreign_key / public.system_lang_key_translations.lang_key_id` still protects
its key. The later rule change belongs to WO-J35.

### UPSERT Pattern

All source creation uses the same UPSERT pattern:

```sql
INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
VALUES ($1, $2, $3, $4, CURRENT_DATE)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
  SET source_low = EXCLUDED.source_low,
      last_seen = CURRENT_DATE
```

The `last_seen` date is used for the seven-day cleanup only for the explicit
source types listed in §8; other types do not expire in that cleanup.

`dataset_header` has one backward-compatibility wrinkle: older rows stored `source_high` in the legacy form `<dataset>:<field>`. New writes use the canonical ownership form `source_high=<dataset>`, `source_low=<field>`, and cleanup must support both until old rows are gone.

---

## 4. AI Translation

### Request Flow

`GenerateTranslationsHandler` (`get_ai_translations.go`) accepts:

```go
type GenerateTranslationsRequest struct {
    MissingKeys    []string            // Keys to translate
    ChosenLanguage string              // Target language code
    Descriptions   map[string]string   // Optional: key→description context
    Sources        map[string]string   // Optional: key→source info
}
```

**Descriptions** and **Sources** provide context to the AI for higher-quality translations. For example, the AI knows that `updated` in the context of "Column 'updated' in table 'customers'" should be translated as a timestamp label, not as a past tense verb.

### How It Works

1. Frontend sends missing keys + optional context.
2. Backend validates session auth.
3. Backend calls the configured LLM provider with keys + context.
4. AI returns translations.
5. Backend saves results via `INSERT ... ON CONFLICT DO UPDATE`.

### Dev And E2E Safeguards

The normal AI translation flow above has two explicit guardrails for local automation:

1. **Frontend synthetic-key filter**
   - `translation_handler.js` treats keys starting with `e2e_` or `e2e-` as synthetic test keys.
   - Those keys are excluded from the frontend's AI-translation request queue before `/api/generateTranslations` is called.

2. **Backend test-mode bypass**
   - Playwright E2E runs send `X-Bypass-Ratelimit: test-mode` from both `app/playwright.config.ts` and `app/testing/e2e/global-setup.ts`.
   - `GenerateTranslationsHandler` checks that header early and returns `[]` immediately in development test mode.
   - This short-circuit happens before session-based AI generation and before Anthropic/OpenAI provider resolution, so normal E2E runs do not need external LLM billing even if some non-synthetic missing keys still reach the route.

Practical consequence:

- Test-only lang keys should prefer the `e2e_...` / `e2e-...` prefix.
- Missing `test_*` keys are still safe in Playwright because of the backend bypass, but they can create extra `/api/generateTranslations` noise in logs.
- E2E tests must not rely on live AI-generated translations appearing during the run.

---

## 5. Translation Serving

### Two stores, and which one serves a language

Translations live in two places, and this is the single most common way seeded
copy goes missing:

| Store | What is in it | Which languages it serves |
|---|---|---|
| `system_lang_keys.fi` / `.en` / `.ch` / `.yue` | the original per-language columns | **Finnish, English, Chinese, Cantonese** — the languages installations actually run |
| `system_lang_key_translations` | the normalized `(lang_key_id, language_code)` table | every other locale tag, for example `zh-CN`, `zh-TW`, `zh-HK` |

**A migration that seeds interface copy must write both stores.** Writing only
`system_lang_key_translations` succeeds, leaves visible rows behind, and still
never reaches a screen in Finnish or English, because those languages are served
from their own columns. `20260918000002_seed_site_assistant_language_keys.sql`
is the shape to copy: it inserts `lang_key, fi, en, creation_spec` into
`system_lang_keys` and *then* mirrors the same values into the normalized table.
`/api/admin/lang-key` writes both for the same reason.

`readServedTranslationMap()` softens the trap: for a language served from a
column it also reads the normalized table and fills only the keys whose column
is empty, so authored copy reaches the interface either way. A value the site
already shows always wins, so the fallback never overwrites a site's own
translation. It is a safety net, not a licence to seed one store.

`20260919000004_serve_authored_seed_translations.sql` repaired the rows that had
been written to the normalized table alone.

### Bulk Fetch — `GetTranslationsHandler`

`GET /api/get-translations?lang=fi`

Returns all translations as `{lang_key: translation}` for the requested language. The requested tag is normalized first (`normalizeRequestedLanguageCode`), then routed to the store above.

### Single Key — `GetLangKeyTranslationsHandler`

`GET /api/get-lang-key-translations?lang_key=search_&_filter`

Returns all language translations for a single key: `{fi: "...", en: "...", ch: "..."}`.

### Development diagnostics

In development mode, `GetTranslationsHandler` also returns orphan key names
through `fetchOrphanLangKeyNames()`. Missing-key discovery, its success or
failure, and orphan-key warnings go to the browser console. They do not create
user-facing toasts, even in the development application. Readable fallback copy
remains available while a developer reviews the missing translations.

New product copy must ship with reviewed language rows in a public migration
and the public bootstrap source before the view is first opened. The field
collection selector's ownership and inheritance keys are maintained in
`app/server_tools/public_bootstrap/source/field_settings.lang_keys.sql`.
Their upgrade migration fills missing values while preserving nonempty
site-authored translations. Finnish and English are recorded as reviewed;
legacy Chinese/Cantonese fallbacks do not constitute approval of new locales.
During development, new copy is written in Finnish and English only (owner
decision K175, 2026-10-04): Chinese (`ch`) and Cantonese (`yue`) values are
optional until the owner restores them, so a missing value there is not an
error. Existing translations in those languages stay, and the application keeps
serving both languages.
A seed migration can instead be run by the bootstrap itself: list it in
`language_seed_migrations` in `generate_bootstrap.py`, in the order an upgrade
runs the files, so the copy is written once. A seed left off that list still
reaches a new installation as applied, because the bootstrap records every
migration as already embodied, so its rows never arrive there:
`20260919000005_seed_dataset_form_dimension_language_keys.sql` was missing from
new installations this way until 9.9.1.
`20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql`
does this, and also shows how to retire wording generated from a key's name:
only that exact text is replaced, never a translation a site has changed.
`20260922000005_seed_interface_language_keys_of_9_8_1.sql` retires
wording an earlier seed wrote in the same way, in all four columns, when the
copy is rewritten before a site has reviewed it. Keep apostrophes out of the SQL
comments of a file the bootstrap embeds: the manifest's row counter reads a
comment's apostrophe as the start of a string.

Explicit user actions, such as saving an edited translation or restoring a
personal field selection, keep their normal success/error notifications.

### Locating an exact UI string safely

Use the read-only application API first when the translation key is already
known:

```bash
./filterest language get grant_users_read
```

This reads through the same application boundary that serves the interface. A
`401` response means that the configured local development credentials must be
fixed; it is not a reason to write directly to the database.

When only the visible text or a screenshot is known, discover candidate keys
with a read-only query against the canonical translation table:

```bash
./filterest database --local "SELECT lang_key, fi, en FROM system_lang_keys WHERE fi ILIKE '%Anna käyttäjille lukuoikeus%' OR en ILIKE '%Grant users read%' ORDER BY lang_key;"
```

Then locate the actual interface consumer in source code, excluding generated
bundles and historical evidence:

```bash
rg -n --glob '!app/frontend/dist/**' --glob '!app/docs/**/artifacts/**' \
  'grant_users_read' app/frontend app/backend app/server_tools/migrations
```

For this example the canonical key is `grant_users_read`. The table-creation
checkbox grants read access to the ordinary `users` group; it does not control
the independent administrator permission that lets the first administrator or
another creating administrator open and manage the dataset.

The per-use context field `usage_explanation` belongs to
`system_lang_key_sources`, not `system_lang_keys`. The normal inspection role
may intentionally lack access to the source-tracking table. Do not elevate
database access just to locate a UI string: use the application API and source
search instead. Direct `INSERT`, `UPDATE`, or `DELETE` statements are never part
of this discovery workflow.

---

## 6. Modification — RENAME Operations

When database objects are renamed, lang key sources and descriptions must be updated to reflect the new names. Failing to do so would create "phantom" references to old names.

### Table Rename

**Triggered by:** `rename_tree_node.go` → `renameTable()` or `update_row.go` (system_db_tables.table_name update)

**`UpdateLangKeySourcesForTableRename(q, oldName, newName)`** does:

1. `UPDATE source_high` for all exact-match dataset-owned sources (`table`, `column`, canonical `dataset_header`) where `source_high = oldName` → `newName`
2. `UPDATE source_low` for `source_type = 'table'` where `source_low = oldName` → `newName`
3. `UPDATE source_high` for legacy/prefix dataset-owned sources (`dataset_header` legacy `<dataset>:<field>`, `column_value` `<dataset>.<column>`) so they follow the renamed dataset too
3. Update descriptions: `"Table 'old'"` → `"Table 'new'"` and `"in table 'old'"` → `"in table 'new'"`

### Column Rename

**Triggered by:** `column_update.go` after `ALTER TABLE RENAME COLUMN`

**`UpdateLangKeySourcesForColumnRename(q, tableName, oldCol, newCol)`** does:

1. `UPDATE source_low` for `source_type = 'column'` where `source_high = tableName` AND `source_low = oldCol` → `newCol`
2. `UPDATE source_high` for `source_type = 'column_value'` where `source_high = '<table>.<oldCol>'` → `'<table>.<newCol>'`
2. Update descriptions: `"Column 'old' in table 'T'"` → `"Column 'new' in table 'T'"`

### Folder Rename

**Triggered by:** `rename_tree_node.go` → `renameFolder()`

**`UpdateLangKeySourcesForFolderRename(q, oldName, newName)`** does:

1. `UPDATE source_high` for `source_type = 'folder'` where `source_high = oldName` → `newName`
2. Update descriptions: `"Folder 'old'"` → `"Folder 'new'"`

### Idempotent Overlap Note

`upsertLangKey()` in `rename_tree_node.go` also updates `source_high` and `source_low` for the renamed item's own lang key. This overlaps with `UpdateLangKeySourcesForTableRename()` for tables, but the overlap is harmless (idempotent `UPDATE`). The `upsertLangKey()` line must stay because folder renames use it too, and they don't go through `UpdateLangKeySourcesForTableRename()` for their own key's source.

---

## 7. Deletion — DROP Operations

When a database object is dropped, its language-key sources are cleaned up.
Keys and translations remain even when the **last** source is removed; the
normal orphan-marking pass handles the key. Automatic retirement is paused.

### Algorithm (shared by all DROP modes)

`cleanupSources(q, mode, name, subname)` in `cleanup_lang_key_sources.go`:

1. **Collect affected IDs** — `SELECT DISTINCT lang_key_id` from matching sources.
2. **Delete source rows** — `DELETE FROM system_lang_key_sources WHERE ...`
3. **Keep keys and translations** — no remaining-source count or key deletion
   runs here. A later normal scan and marking pass can record an orphan marker.

Only the matching source rows (and their per-source context) are removed.
There is no separate surviving-key description-clearing step.

### Table Drop

**Triggered by:** `table_metadata_cleanup.go` (already wired before this work)

`CleanupLangKeySourcesForTable(q, tableName)` — removes every dataset-owned source row registered in the centralized ownership rules:

- exact `table` / `column` rows where `source_high = tableName`
- canonical `dataset_header` rows where `source_high = tableName`
- legacy `dataset_header` rows where `source_high LIKE '<table>:%'`
- `column_value` rows where `source_high LIKE '<table>.%'`
- known dataset-specific dynamic keys by exact lang-key name as a compatibility cleanup path:
  - `add_row_<table>`
  - `search_for_<table>`
  - `search_slogan_<table>`
  - `<table>_front_page`

Why the extra exact-key cleanup exists:

- older AI-generated dynamic dataset keys could be stored with generic fallback provenance such as `code/unknown`
- in that case, source-only cleanup would miss them on table drop even though the key name itself is dataset-owned
- the exact-key safety net removes old dataset-owned source rows while retaining
  the keys and their translations for the orphan lifecycle

### Column Drop

**Triggered by:** `column_delete.go` (already wired before this work)

`CleanupLangKeySourcesForColumn(q, tableName, colName)` — removes:

- `source_type = 'column'` where `source_high = tableName` AND `source_low = colName`
- `source_type = 'column_value'` where `source_high = '<table>.<colName>'`

### Folder Drop

**Triggered by:** `delete_table_folder.go`

`CleanupLangKeySourcesForFolder(q, folderName)` — removes `source_type = 'folder'` where `source_high = folderName`.

### Error Handling

All cleanup operations are **non-fatal** — they log warnings but don't abort the parent operation. The HTTP handler proceeds even if lang key cleanup fails. This follows the project convention for metadata operations.

---

## 8. Startup Scanning & Orphan Marking

On every server startup, `optional_tasks.go` runs a three-step pipeline:

### Step 1: `PopulateLangKeySources()`

**File:** `lang_key_source_population.go`

Scans all sources and UPSERTS records into `system_lang_key_sources`:

1. **Code scan** — Walks `app/frontend/`, `app/backend/` and, when present, `app/components/` directories, scans `.js`, `.html`, `.go` files for lang key patterns (`data-lang-key`, `dataset.langKey`, `getTranslationForKey("...")` etc.). Creates `source_type='code'` records. A missing optional components tree is allowed; an unreadable tree, dangling link or link outside its source root stops the scan, so incomplete discovery cannot retire still-used keys.

   A module that gathers its copy into one catalogue passes a *variable* to the
   translation call, so the key literal never sits beside it. The scan therefore
   also reads the catalogue itself. These three shapes are recognised, which is
   why a new module needs no convention its author has to remember:

   ```js
   attach: ["chat_attach_image", "Attach an image"]      // catalogue entry with fallback copy
   labelKey: "dataset_column_type_text"                  // a property whose name ends in Key
   image_ready: { fi: "Kuva on valmis", en: "Image is ready" }  // fallback translations
   ```

   In each shape the key is recognised by its own snake_case name, so ordinary
   identifiers (`apiKey: "abc123"`) and short values (`["png", "jpeg"]`) stay
   out. A key written as a single word with no underscore is not read from a
   catalogue; give such a key an ordinary `dataset.langKey` or
   `getTranslationForKey("…")` reference somewhere.
2. **Schema scan** — Queries `information_schema.columns` to find all dynamic table columns. Creates `source_type='column'` records with `source_high=table_name`, `source_low=column_name`.
3. **Table scan** — Queries `system_db_tables`. Creates `source_type='table'` records.
4. **View scan** — Queries `system_views`. Creates `source_type='view'` records.
5. **Group scan** — Queries `system_groups`. Creates `source_type='group'` records.
6. **Folder scan** — Queries `system_table_folders`. Creates `source_type='folder'` records.
7. **Stale cleanup** — after a fresh scan, `cleanupStaleLangKeySources()` removes
   source rows with `last_seen < CURRENT_DATE - INTERVAL '7 days'` only for
   `code`, `column`, `table`, `prefix`, `suffix`, `view`, `group`, `folder`, `db`,
   `foreign_key` and `column_value`. It never deletes keys. Types outside this
   list do not expire through this cleanup: this includes `dataset_header`,
   `front_page_hero`, `admin_api`, `dev_editor`, `template`, `javascript`,
   `migration`, `schema`, `manual_crud`, `orphan` and unknown types.

Dynamic key rule:

- runtime AI saves should classify dynamic schema keys with the same ownership logic as startup scans
- example: `add_row_customers`, `search_for_customers`, and `customers_front_page` should resolve to dataset/table ownership, not generic `code::unknown`

**Context auto-population:** During schema/table/folder scans, `updateSourceUsageExplanationIfEmpty()` fills empty per-source explanations:

- Tables: `"Table 'customers'"`
- Columns: `"Column 'name' in table 'customers'"`
- Folders: `"Folder 'main_folder'"`

### Step 2: `MarkOrphanLangKeys()`

**File:** `lang_key_consistency_checks.go`

After a scan counts as fresh, `findOrphanLangKeys()` lists keys with no
counting source, plus the existing synthetic-test candidates. Raw HTML names
(containing `<` or `>`) and names longer than 200 characters are excluded and
reported in category 7 instead. Exactly 200 characters is not garbage by length.

The counting condition is `source_type NOT IN ('orphan', 'manual_crud')`.
Synthetic candidates still use the existing case-insensitive
`(^|_)(e2e|test)(_|-)` name rule, even when they have counting sources. Neither
that rule nor scanner coverage changes in B1.

For each orphan:
- **INSERT** a `source_type='orphan'`, `source_high='consistency_scan'` record,
  with `ON CONFLICT DO NOTHING` so the original `last_seen` is kept. On an orphan
  record `last_seen` means *first seen as an orphan*, which is what the
  reported orphan age is counted from. Stale-source cleanup deliberately leaves
  `orphan` rows alone, so the age really does accumulate.

For keys that are **no longer** orphans (they gained a source since last startup):
- **DELETE** the orphan source record.

Returns `(marked, unmarked)` counts logged at startup.

#### Retirement is paused

`MarkOrphanLangKeys()` only marks and unmarks; it no longer calls
`archiveExpiredOrphans()`. Startup, opening the consistency report and the
on-demand scan cannot archive or delete a key. The legacy archive function and
its 90-day constant remain for later WO-J35 work, without an automatic caller.
Its current fi/en/ch/yue column copy does not preserve every normalized
translation, so this document makes no lossless-archive claim.

Category 8 is report-only. Its fi/en language keys say archiving is paused,
show the recorded age when available, and identify a counting source when one
exists. There is no deletion countdown. Single category-8 fixes are skipped,
and "Fix All" skips both language-key categories (7 and 8).

#### Retirement records — category copy (WO22/WO26)

<a id="retirement-record--2026-10-15-wo22"></a>
<a id="retirement-record--2026-10-16-wo26"></a>

`row_group_categories_modes_hint` (WO22) and `row_group_match_mode` (WO26) no longer have code references.
Released seeds, bootstrap rows and stored translations remain; neither change deletes keys.
The current scan treats translation references as use, and J36 pauses automatic archiving.
They become candidates when WO-J35 B5 ships. If still unused, archiving can happen no earlier
than 90 days after archiving returns to that site through B8 and explicit owner approval.
Source expiry and removal of code references do not promise archiving.

### Step 3: Stale Source Cleanup

This is part of `PopulateLangKeySources()`, before marking, rather than a second
cleanup after it. Only the explicit source list in Step 1 expires after seven
days; other types never expire through this cleanup. Losing a source may make a
key an orphan candidate, but never causes key deletion during this pause.

---

## 9. Consistency Checks (Admin UI)

The Database Consistency Check tool (`/api/check-db-consistency`) includes two lang key categories:

### Category 7: Garbage Lang Keys

`checkGarbageLangKeys()` finds keys whose `lang_key` value looks like an HTML fragment or other non-key content (e.g., `<div class="...">`). These are typically created by bugs. A single fix deletes only if the name
still contains `<` or `>` or exceeds 200 characters, and the key has no counting
source. Both conditions are in the DELETE statement; an absent, repaired or newly
protected key is skipped. "Fix All" skips category 7.

### Category 8: Orphan Lang Keys

`checkOrphanLangKeys()` uses the same `findOrphanLangKeys()` function as `MarkOrphanLangKeys()`. Displays orphan keys for review with translated pause notices and no fix button.
Category 8 is report-only: single fixes return the existing skipped result, and
"Fix All" skips it. Re-enabling archiving and changes to source evidence belong
to later WO-J35 batches; they are not implemented by B1.

---

## 10. Context Management (`usage_explanation`)

Context for AI translation and developer traceability now lives **per-source** in `system_lang_key_sources.usage_explanation`, not per-key in `system_lang_keys.description`.

### Why per-source, not per-key

A key like `more_actions` can appear in many UI locations with different roles — a dropdown toggle in one file, a button in another. A single `description` on the key cannot represent all locations accurately. Per-source `usage_explanation` solves this:

| source_high | usage_explanation |
|---|---|
| `column_view_preset_builder.js` | `Dropdown toggle: opens save-as-new and delete actions for field set presets` |
| `permission_editor.js` | `Button at row end: reveals additional permission settings` |

### AI translation benefit

`usage_explanation` is the **primary context source for AI translations**. It tells the LLM not just what the text means, but what tone and style to use. For example, `search_slogan` without context might be translated literally ("haku-slogan"), but with `usage_explanation = "Marketing tagline on search page hero: should be inviting and encouraging"` the AI produces a richer, contextually appropriate translation.

### Auto-generated usage explanations

The startup scanner auto-populates `usage_explanation` on source records for schema objects (only if currently empty):

| Source type | usage_explanation format |
|---|---|
| `column` | `"Column 'name' in table 'customers'"` |
| `table` | `"Table 'customers'"` |
| `folder` | `"Folder 'main_folder'"` |

Manually set `usage_explanation` values (e.g., from seed migrations) are never overwritten by the scanner.

The legacy `system_lang_keys.description` column still contains old auto-generated data but is **no longer written to or read by any active code path**. It is ticketed for deprecation.

### Lifecycle of `usage_explanation`

1. **Set** in seed migrations or manually by developers when creating lang keys.
2. **Preserved** by the startup scanner — the scanner's UPSERT clause does not overwrite `usage_explanation`.
3. **Not auto-migrated** on file rename — when a file is renamed, the old source expires (7-day stale window) and a new source is created with an empty `usage_explanation`. This is acceptable (option A); the explanation can be re-set manually if needed.
4. **Read by AI** — `GenerateTranslationsHandler` reads `usage_explanation` from source records to provide context to the LLM.

---

## 11. File Inventory

### Core Lang Key Files

| File | Purpose |
|------|---------|
| `app/backend/core_components/lang/cleanup_lang_key_sources.go` | DROP and RENAME cleanup for sources + descriptions |
| `app/backend/core_components/lang/lang.go` | Translation serving endpoints |
| `app/backend/core_components/lang/get_ai_translations.go` | AI translation generation handler |
| `app/backend/core_components/lang/ensure_lang_key_source_for_crud_mutation.go` | Manual CRUD source tracking |
| `app/backend/core_components/system_table_tools/lang_key_consistency_checks.go` | Orphan detection and marking, garbage key detection |
| `app/backend/core_components/lang/fix_table_translations.go` | Fix JSON translations in table cells |
| `app/backend/core_components/lang/update_relates_to_table.go` | Populate `relates_to_table` column |
| `app/backend/core_components/lang/update_last_used.go` | Update `last_used` timestamps |

### Source Population & Startup

| File | Purpose |
|------|---------|
| `app/backend/core_components/system_table_tools/lang_key_source_population.go` | Startup scanner: code+schema+DB objects → sources |
| `app/backend/core_components/startup/optional_tasks.go` | Startup orchestration: scan → mark orphans |
| `app/backend/core_components/startup/primary_key_check.go` | Ensure PK columns have lang keys |

### Wiring Points (DROP/RENAME triggers)

| File | What triggers |
|------|---------------|
| `app/backend/.../dtt_table_folders/rename_tree_node.go` | Table rename → `UpdateLangKeySourcesForTableRename()`, Folder rename → `UpdateLangKeySourcesForFolderRename()` |
| `app/backend/.../dtt_table_folders/delete_table_folder.go` | Folder delete → `CleanupLangKeySourcesForFolder()` |
| `app/backend/.../dtt_2_column_update/column_update.go` | Column rename → `UpdateLangKeySourcesForColumnRename()` |
| `app/backend/.../dtt_1_row_update/update_row.go` | Table rename via cell edit → `UpdateLangKeySourcesForTableRename()` |
| `app/backend/.../table_metadata_cleanup.go` | Table drop → `CleanupLangKeySourcesForTable()` (pre-existing) |
| `app/backend/.../column_delete.go` | Column drop → `CleanupLangKeySourcesForColumn()` (pre-existing) |

---

## 12. Design Principles

1. **One key, many sources.** A lang key like `updated` can be a column in 10 tables and appear in 5 code files. Each usage is tracked independently. Counting sources protect a key; losing all sources leads to marking, with
   automatic deletion paused.

2. **Non-fatal metadata operations.** Lang key cleanup never aborts the parent operation (table drop, column rename, etc.). Failures are logged, not propagated.

3. **UPSERT everywhere.** All source creation uses `ON CONFLICT DO UPDATE` — safe to call multiple times, idempotent.

4. **7-day stale window for an explicit list.** Only the source types listed in
   §8 expire in scan cleanup; all other types are retained. Keys are never
   removed by that cleanup.

5. **Context lives per-source, not per-key.** `usage_explanation` on `system_lang_key_sources` is the authoritative context for AI translation and developer traceability. The legacy `system_lang_keys.description` column is no longer populated by these scans. New features should always set `usage_explanation` on source records.

6. **FK CASCADE as safety net.** `system_lang_key_sources.lang_key_id` references `system_lang_keys.id ON DELETE CASCADE`. Even if cleanup code misses something, deleting the lang key cleans up all sources automatically.

7. **Marking continues; retirement is paused.** Source-less keys survive dataset
   cleanup and receive orphan markers during normal maintenance. Category 8 is
   report-only and "Fix All" skips categories 7 and 8. A single category-7
   consistency fix can delete a key only with both current garbage and no-counting-source
   conditions checked by the DELETE itself. Later WO-J35 work owns any return of
   archiving.

8. **One canonical JS syntax for lang keys.** All JS code uses `el.dataset.langKey = 'x'` — never `setAttribute('data-lang-key', ...)`. This keeps grep/search predictable. A module that keeps its copy in a catalogue is read from the catalogue instead — see the three shapes in §8 — so a key never has to be repeated just to be seen. See `langKeyPatterns` in `lang_key_consistency_checks.go`.

9. **Seeded copy goes into both translation stores.** See §5: Finnish, English, Chinese and Cantonese are served from columns on `system_lang_keys`, so a migration that writes only `system_lang_key_translations` succeeds without changing a single screen.

10. **Same-request readback must share visibility with the write.** Handlers that write lang keys and immediately return the saved payload should read through the same transaction (or after commit). A pooled read on `backend.Db` can legitimately return stale dataset-header values even though the write itself succeeded.
