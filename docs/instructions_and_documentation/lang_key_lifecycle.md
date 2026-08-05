# Lang Key Lifecycle

> How lang keys are created, tracked, translated, renamed, deleted, scanned, and marked as orphans.

This document captures the full lifecycle of Easelect's multilingual key system. It is intended as a reference for developers and AI agents working with the `system_lang_keys` / `system_lang_key_sources` tables.

---

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
10. [Description Management](#10-description-management)
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
| `source_type` | text | One of: `code`, `column`, `table`, `folder`, `view`, `group`, `dataset_header`, `column_value`, `manual_crud`, `orphan` |
| `source_high` | text | Primary identifier (table name, file path, folder name, etc.) |
| `source_low` | text | Secondary identifier (column name, username, etc.) |
| `last_seen` | date | Last scan or usage date |
| `usage_explanation` | text | Per-source explanation of what the key does in this specific location. Serves two purposes: (1) **AI translation context** — tells the translator what tone, style, and meaning to use (e.g., `search_slogan` → "Marketing tagline on search page hero: should be inviting and encouraging, not a literal translation"); (2) **Developer traceability** — documents what the key does in each specific UI location. Set by seed migrations or manually; the startup scanner does not populate this. |

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

When new database objects are created, lang keys are implicitly created for their display names. The keys follow naming conventions (e.g., the table name itself becomes a lang key). These are populated during:

- **Startup scanning** (`PopulateLangKeySources`) — creates `source_type='table'`, `'column'`, or `'folder'` records.
- **Primary key check** (`EnsurePrimaryKeyLangKeys`) — ensures PK columns like `id` have lang keys.

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

Every lang key can have **multiple** source records. A key like `updated` may appear in code, as a column name in 10 tables, and have been manually edited in the admin UI — that's 12+ sources.

### Source Types

| `source_type` | `source_high` | `source_low` | Created by |
|---------------|---------------|--------------|------------|
| `code` | file path (e.g., `frontend/core_components/...`) | `''` | Startup scanner |
| `table` | table name | table name | Startup scanner |
| `column` | table name | column name | Startup scanner |
| `dataset_header` | dataset name | header field name (`title`, `slogan`, `search_placeholder`) | `dataset_header_config.go` |
| `column_value` | `table.column` | lang key value stored in that column | hasLangKey scanner |
| `folder` | folder name | `''` | Startup scanner |
| `view` | view name | `''` | Startup scanner |
| `group` | group name | `''` | Startup scanner |
| `manual_crud` | `'admin_ui'` | normalized username | `EnsureLangKeySourceForCRUDMutation()` |
| `orphan` | `'system'` | `''` | `MarkOrphanLangKeys()` |

### UPSERT Pattern

All source creation uses the same UPSERT pattern:

```sql
INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
VALUES ($1, $2, $3, $4, CURRENT_DATE)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
  SET source_low = EXCLUDED.source_low,
      last_seen = CURRENT_DATE
```

The `last_seen` date is key — sources not seen for 7+ days are eligible for stale cleanup.

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
   - Playwright E2E runs send `X-Bypass-Ratelimit: test-mode` from both `playwright.config.ts` and `testing/e2e/global-setup.ts`.
   - `GenerateTranslationsHandler` checks that header early and returns `[]` immediately in development test mode.
   - This short-circuit happens before session-based AI generation and before Anthropic/OpenAI provider resolution, so normal E2E runs do not need external LLM billing even if some non-synthetic missing keys still reach the route.

Practical consequence:

- Test-only lang keys should prefer the `e2e_...` / `e2e-...` prefix.
- Missing `test_*` keys are still safe in Playwright because of the backend bypass, but they can create extra `/api/generateTranslations` noise in logs.
- E2E tests must not rely on live AI-generated translations appearing during the run.

---

## 5. Translation Serving

### Bulk Fetch — `GetTranslationsHandler`

`GET /api/get-translations?lang=fi`

Returns all translations as `{lang_key: translation}` for the requested language column. The column name is validated against `langColRegexp` (`^[a-z]{2}$`) to prevent SQL injection.

### Single Key — `GetLangKeyTranslationsHandler`

`GET /api/get-lang-key-translations?lang_key=search_&_filter`

Returns all language translations for a single key: `{fi: "...", en: "...", ch: "..."}`.

### DEV_MODE Orphan Overlay

In development mode, `GetTranslationsHandler` also returns a list of orphan key names via `fetchOrphanLangKeyNames()`. This allows the frontend to visually flag keys that are no longer referenced by any source — a development-time tool that doesn't run in production.

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

When a database object is dropped, its lang key sources must be cleaned up. Keys that lose their **last** source are deleted entirely.

### Algorithm (shared by all DROP modes)

`cleanupSources(q, mode, name, subname)` in `cleanup_lang_key_sources.go`:

1. **Collect affected IDs** — `SELECT DISTINCT lang_key_id` from matching sources.
2. **Delete source rows** — `DELETE FROM system_lang_key_sources WHERE ...`
3. **Check survivors** — For each affected key, `COUNT(*)` remaining sources:
   - **Zero sources** → `DELETE FROM system_lang_keys WHERE id = $1` (FK CASCADE cleans up)
   - **Has sources** → key survives (e.g., `updated` is also a column in other tables)
4. **Clear stale descriptions** — For surviving keys, clear descriptions that reference the dropped object (e.g., `"Column 'name' in table 'customers'"` is cleared when `customers` is dropped, even if the key survives due to being used in another table). `PopulateLangKeySources()` will re-populate correct descriptions on next startup.

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
- the exact-key safety net keeps table deletion at `0` leftover owned keys while newer writes are being normalized

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

1. **Code scan** — Walks `frontend/` and `backend/` directories, scans `.js`, `.html`, `.go` files for lang key patterns (`data-lang-key`, `dataset.langKey`, `langKey=`, `I("...")` etc.). Creates `source_type='code'` records.
2. **Schema scan** — Queries `information_schema.columns` to find all dynamic table columns. Creates `source_type='column'` records with `source_high=table_name`, `source_low=column_name`.
3. **Table scan** — Queries `system_db_tables`. Creates `source_type='table'` records.
4. **View scan** — Queries `system_views`. Creates `source_type='view'` records.
5. **Group scan** — Queries `system_groups`. Creates `source_type='group'` records.
6. **Folder scan** — Queries `system_table_folders`. Creates `source_type='folder'` records.
7. **Stale cleanup** — `cleanupStaleLangKeySources()` deletes source records with `last_seen < NOW() - 7 days` for all scannable types (`code`, `table`, `column`, `folder`, `view`, `group`). This handles the case where a file was deleted or a code reference was removed — after 7 days without being re-scanned, the stale source is removed.

Dynamic key rule:

- runtime AI saves should classify dynamic schema keys with the same ownership logic as startup scans
- example: `add_row_customers`, `search_for_customers`, and `customers_front_page` should resolve to dataset/table ownership, not generic `code::unknown`

**Description auto-population:** During schema/table/folder scans, `updateLangKeyDescriptionIfEmpty()` sets descriptions for keys that don't have one yet:

- Tables: `"Table 'customers'"`
- Columns: `"Column 'name' in table 'customers'"`
- Folders: `"Folder 'main_folder'"`

### Step 2: `MarkOrphanLangKeys()`

**File:** `lang_key_consistency_checks.go`

After sources are fully populated, identifies keys with **zero non-orphan sources**:

```sql
SELECT id FROM system_lang_keys
WHERE id NOT IN (
    SELECT DISTINCT lang_key_id FROM system_lang_key_sources
    WHERE source_type != 'orphan'
)
```

For each orphan:
- **UPSERT** a `source_type='orphan'`, `source_high='system'` record.

For keys that are **no longer** orphans (they gained a source since last startup):
- **DELETE** the orphan source record.

Returns `(marked, unmarked)` counts logged at startup.

### Step 3: Stale Source Cleanup

Part of `PopulateLangKeySources()` — removes sources not seen in 7 days. This ensures that if a file is deleted from the codebase, its `source_type='code'` records eventually disappear, which may then cause the key to be marked as orphan in the next restart.

---

## 9. Consistency Checks (Admin UI)

The Database Consistency Check tool (`/api/check-db-consistency`) includes two lang key categories:

### Category 7: Garbage Lang Keys

`checkGarbageLangKeys()` finds keys whose `lang_key` value looks like an HTML fragment or other non-key content (e.g., `<div class="...">`). These are typically created by bugs and can be fixed (deleted) via the admin UI.

### Category 8: Orphan Lang Keys

`checkOrphanLangKeys()` uses the same `findOrphanLangKeys()` function as `MarkOrphanLangKeys()`. Displays orphan keys in the admin UI for manual review. Admins can delete them one by one or use "Fix All".

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
| `backend/core_components/lang/cleanup_lang_key_sources.go` | DROP and RENAME cleanup for sources + descriptions |
| `backend/core_components/lang/lang.go` | Translation serving endpoints |
| `backend/core_components/lang/get_ai_translations.go` | AI translation generation handler |
| `backend/core_components/lang/ensure_lang_key_source_for_crud_mutation.go` | Manual CRUD source tracking |
| `backend/core_components/lang/lang_key_consistency_checks.go` | Orphan detection and marking, garbage key detection |
| `backend/core_components/lang/fix_table_translations.go` | Fix JSON translations in table cells |
| `backend/core_components/lang/update_relates_to_table.go` | Populate `relates_to_table` column |
| `backend/core_components/lang/update_last_used.go` | Update `last_used` timestamps |

### Source Population & Startup

| File | Purpose |
|------|---------|
| `backend/core_components/system_table_tools/lang_key_source_population.go` | Startup scanner: code+schema+DB objects → sources |
| `backend/core_components/startup/optional_tasks.go` | Startup orchestration: scan → mark orphans |
| `backend/core_components/startup/primary_key_check.go` | Ensure PK columns have lang keys |

### Wiring Points (DROP/RENAME triggers)

| File | What triggers |
|------|---------------|
| `backend/.../dtt_table_folders/rename_tree_node.go` | Table rename → `UpdateLangKeySourcesForTableRename()`, Folder rename → `UpdateLangKeySourcesForFolderRename()` |
| `backend/.../dtt_table_folders/delete_table_folder.go` | Folder delete → `CleanupLangKeySourcesForFolder()` |
| `backend/.../dtt_2_column_update/column_update.go` | Column rename → `UpdateLangKeySourcesForColumnRename()` |
| `backend/.../dtt_1_row_update/update_row.go` | Table rename via cell edit → `UpdateLangKeySourcesForTableRename()` |
| `backend/.../table_metadata_cleanup.go` | Table drop → `CleanupLangKeySourcesForTable()` (pre-existing) |
| `backend/.../column_delete.go` | Column drop → `CleanupLangKeySourcesForColumn()` (pre-existing) |

---

## 12. Design Principles

1. **One key, many sources.** A lang key like `updated` can be a column in 10 tables and appear in 5 code files. Each usage is tracked independently. The key is only deleted when **all** sources are gone.

2. **Non-fatal metadata operations.** Lang key cleanup never aborts the parent operation (table drop, column rename, etc.). Failures are logged, not propagated.

3. **UPSERT everywhere.** All source creation uses `ON CONFLICT DO UPDATE` — safe to call multiple times, idempotent.

4. **7-day stale window.** Source records not refreshed by the startup scanner within 7 days are cleaned up. This handles code file deletions and removed references gracefully.

5. **Context lives per-source, not per-key.** `usage_explanation` on `system_lang_key_sources` is the authoritative context for AI translation and developer traceability. The legacy `system_lang_keys.description` column is still auto-populated for schema objects but is not the primary source. New features should always set `usage_explanation` on source records.

6. **FK CASCADE as safety net.** `system_lang_key_sources.lang_key_id` references `system_lang_keys.id ON DELETE CASCADE`. Even if cleanup code misses something, deleting the lang key cleans up all sources automatically.

7. **Orphan marking, not immediate deletion.** Keys without sources are marked with `source_type='orphan'` rather than immediately deleted. This provides a review window — admins can see orphans in the consistency check tool and decide whether to delete them.

8. **One canonical JS syntax for lang keys.** All JS code uses `el.dataset.langKey = 'x'` — never `setAttribute('data-lang-key', ...)`. This keeps the scanner simple (one pattern instead of three) and makes grep/search predictable. The scanner currently uses 6 patterns (down from 7) — see `langKeyPatterns` in `lang_key_consistency_checks.go`.

9. **Same-request readback must share visibility with the write.** Handlers that write lang keys and immediately return the saved payload should read through the same transaction (or after commit). A pooled read on `backend.Db` can legitimately return stale dataset-header values even though the write itself succeeded.
