# Asset Linking Architecture

This document defines the long-term direction for asset support in Filterest.
It replaces the narrower “image linking only” mental model with a generic `asset_linking` architecture while keeping images as the first fully supported profile.

## 1. Why This Exists

Filterest already has working image-linking behavior, but upcoming requirements expand beyond one image per row:

- multiple images per parent row
- future videos, PDFs, audio files, and general documents
- admin-side enable/disable/remove controls per table
- fast list/card rendering without expensive runtime lookups

The goal is not to flatten everything into one generic file blob.
The goal is:

- one shared asset engine
- media-specific profiles on top
- fast parent-side cache fields for UI rendering

## 2. Locked Architectural Decisions

These decisions are intentionally fixed unless a future RFC replaces them.

### 2.1 One Shared `<parent>_assets` Table Per Parent

Use one canonical asset child table per parent dataset.

Example:

- `app_service_catalog`
- `app_service_catalog_assets`

Why:

- keeps native FK integrity
- matches Filterest’s current child-table pattern
- avoids a global polymorphic `system_assets` table
- avoids creating one separate table per media type
- allows one shared FK relation row to carry multiple live capability profiles through `file_upload.profiles`

### 2.2 Parent Cache Fields Stay

The child asset table is the source of truth.
The parent row still keeps lightweight cache fields for fast rendering.

Examples:

- `cached_image`
- later possibly `cached_video_poster`

These cache fields are not the full asset store.
They only support fast card/list rendering.

### 2.3 Application-Level Cache Sync

Cache invalidation is handled in application code, not DB triggers.

Sync must run when:

- an asset is created
- an asset is deleted
- the primary asset changes
- asset ordering changes
- a file is replaced

There should also be an admin-side rebuild path for repairing cache drift.

### 2.4 Local-First Storage With Logical Keys

Storage starts with the current local filesystem model.
The database should store logical storage identifiers, not hardcoded final URLs.

Recommended storage fields:

- `storage_key`
- optional `storage_driver`

This allows the same data model to move later from local disk to S3-style storage without rewriting asset rows.

### 2.5 Permissions Inherit From Parent

Asset rows inherit permissions from the parent table by default.

Version 1 should not introduce asset-level ACLs.
If there is a future need for per-asset restrictions, it should be added as an explicit extension, not baked into the first rollout.

### 2.6 Images Are A First-Class Profile

Even with a generic asset engine, images keep a dedicated profile.

Why:

- thumbnails
- galleries
- card preview image
- alt text
- image dimensions

The architecture is generic.
The UX and rendering paths remain media-aware.

### 2.7 Profiles Share One Relation Row

Capability identity should live above the physical FK row.

That means:

- one `<parent>_assets` relation row
- one `file_upload` config envelope
- multiple logical profiles inside `file_upload.profiles`

Example:

- `image`
- `attachment`

This avoids duplicate FK metadata rows pointing at the same child table and keeps admin, upload, and read paths aligned on one canonical relation.

## 3. Target Data Model

### 3.1 Parent Table

Parent tables keep fast summary fields only.

Example:

```text
app_service_catalog
  id
  ...
  cached_image
```

### 3.2 Child Asset Table

One row equals one asset file.

Example:

```text
app_service_catalog_assets
  id
  app_service_catalog_id
  asset_kind
  mime_type
  original_name
  storage_key
  size_bytes
  sort_order
  is_primary
  title
  description
  metadata_json
  created
  updated
```

### 3.3 Metadata Strategy

Use common columns for shared fields and `metadata_json` for media-specific technical metadata.

Common columns:

- `asset_kind`
- `mime_type`
- `original_name`
- `storage_key`
- `size_bytes`
- `sort_order`
- `is_primary`
- `title`
- `description`

`metadata_json` examples:

- image: `width`, `height`
- video: `duration_ms`, `poster_key`
- pdf: `page_count`
- audio: `duration_ms`

User-facing text should stay in named columns when it deserves first-class handling.

## 4. Primary Asset Rules

Each parent row can have many assets.
UI often needs one primary preview asset.

Selection rule:

1. prefer `is_primary = true`
2. otherwise lowest `sort_order`
3. otherwise newest row

For images:

- the chosen primary image syncs to `cached_image`

## 5. Storage Model

Current implementation is local-filesystem-first.
The current file layout still matters:

- `/storage/<table_uid>/<row_id>/original/...`
- thumbnail subfolders for image profile

Current canonical shared-asset rule:

- direct uploads into `<parent>_assets` still store files under the parent dataset uid and parent row id
- canonical filenames therefore keep the parent-based shape `<parent_table_uid>_<parent_row_id>_<asset_row_id>.<ext>`
- shared asset delete cleanup moves files out of that parent-based folder layout at file level after a successful transaction commit
- image/attachment status payloads should expose explicit `relation_kind` and `foreign_key_column` metadata so read/detail surfaces can resolve shared media without guessing only from `_assets` / `_images` suffixes

Long-term rule:

- generic asset engine resolves storage keys
- image profile may additionally generate thumbnails
- non-image profiles must not be forced through image-only thumbnail logic

## 6. Shared Detail Surfaces

Canonical shared-asset detail UX should now assume:

- big-card attachment rows may edit `title` and `description` inline when the child dataset has `/api/update-row`
- big-card image rows may also edit `title` and `description` inline when the shared child dataset has `/api/update-row`, and the UI should batch those field changes through one `update-row` call for the active image row
- the original uploaded filename should stay visible as secondary metadata even when a friendlier attachment title is set
- attachment refresh order should be deterministic (`sort_order`, then `created`, then `id`, then display name) so delete/edit flows do not drift between refreshes
- card-support hero-image discovery should prefer explicit shared-media metadata first and FK-discovered `_assets` relations second; repo-wide shared-asset migrations should remove the old blind `_images` fallback path entirely
- custom-named shared-asset or image-asset child tables are valid if their FK metadata is explicit; suffixes like `_assets` / `_images` should help rank candidates, not act as hard requirements

## 7. Admin UX Direction

The current `asset_linking` admin view is the canonical admin surface.
It owns both image and attachment capabilities on the shared media foundation.

Per table, admin should be able to:

- enable assets
- disable assets
- destroy assets
- configure allowed file types
- configure max upload size
- later manage enabled profiles such as images, PDF, video, audio

Image-specific language may still appear inside the shared admin sections, but the live product surface is now `asset_linking`.

## 7. Isolated Module Homes

To avoid scattering asset logic across the repo, the feature should live in dedicated homes:

### Backend

```text
filterest/app/backend/core_components/dynamic_table_tools/dtt_asset_linking/
```

This module owns:

- typed asset-linking config
- file-upload spec formatting/parsing
- permission inheritance helpers
- future cache sync helpers
- future generic asset capability handlers
- profile-specific logic under `profiles/`

### Frontend

```text
filterest/app/frontend/core_components/admin_tools/asset_linking/
```

This module owns:

- asset-linking admin state
- shared admin rendering
- profile editors
- adapters for the migration from the legacy image-linking UI

Current module rule:

- the visible admin tab is named `asset_linking`
- the rendering owner lives under `filterest/app/frontend/core_components/admin_tools/asset_linking/`
- new media profiles should extend this shared admin view instead of reviving separate image-only tooling

Current implementation note:

- attachment linking now has a first live contract under `dtt_asset_linking`
- the admin UI enters through `asset_linking` and renders both image and attachment capability sections from the shared asset-linking view
- end-user attachment UX now lives on two surfaces:
  - the big-card media sections for existing rows (`image upload/delete/set-primary` plus `attachment upload/open/download/delete`, with inline PDF preview inside the same big-card modal)
  - the add-row modal for creating a new parent row together with shared `_assets` image + attachment children
- shared file upload infrastructure is now profile-aware: image uploads generate thumbnails, attachment uploads persist the original file only
- big-card image thumbnails now use a small top-right `x` overlay for delete, a top-left primary-image toggle, and a right-click context menu for the same actions
- shared media child relations (`_assets` / `_images`) should not appear as generic related-row tabs or child-tab-config candidates; they have dedicated media UI instead
- parent-row delete cleanup must treat shared `<parent>_assets` children like legacy `_images` children so storage moves happen before `DELETE CASCADE`
- shared asset mutations must keep parent preview caches in sync from application code: when a canonical `_assets` image row is updated or deleted, the parent `cached_image` is recalculated from the remaining preferred image rows
- direct uploads into canonical shared `_assets` tables must normalize storage back to the parent dataset uid + parent row id instead of inventing child-table-specific folder roots
- direct shared `_assets` uploads must fail fast when the canonical parent storage context cannot be resolved; they must not silently fall back to the older child-table storage layout
- migrated historical shared-asset rows may still carry filename keys that point at older storage roots; shared-asset delete/archive cleanup should resolve the actual storage root from the stored filename instead of resurrecting legacy table-aware branching
- read-side media detection should share one lightweight FK/file-upload metadata helper inside `dtt_1_row_read`, so card-support enrichment and child-tab relation-kind classification evolve together without importing the full `dtt_asset_linking` package into read-path packages
- generic related-row and media resolvers should now treat explicit `file_upload` relation metadata plus backend `relation_kind` as the source of truth; `_assets` / `_images` suffixes are no longer runtime truth for active product image flows
- card-support enrichment must treat attachment-only shared asset metadata as authoritative: if a resolved shared `<parent>_assets` relation exposes only attachment profiles, do not blindly guess a canonical image hero from the `_assets` suffix alone
- PDF attachments can stay on a lightweight frontend-only thumbnail path for now: a first-page iframe tile in the big-card attachment list is preferred over adding a separate backend raster-thumbnail pipeline before the shared asset model is fully stabilized

## 8. Migration Strategy

### Phase A: Isolate The Module

- create `filterest/app/backend/` and `filterest/app/frontend/` `asset_linking` homes
- move shared decisions there first
- keep current routes and admin UI behavior stable

### Phase B: Direct Asset Routes

- register image and attachment routes directly under `asset_linking`
- remove legacy image-only wrappers
- keep tests green while callers adopt the shared asset vocabulary

### Phase C: Parent-Specific Shared Asset Table

- move from legacy `_images` assumptions toward canonical `<parent>_assets`
- keep `cached_image` as the image preview cache

### Phase D: Image Profile First

- complete image upload, primary selection, thumbnail, and gallery behavior on the new model

### Phase E: Add New Profiles

- PDF
- video
- audio
- document/archive

## 9. Current Migration Status

As of this document:

- `dtt_asset_linking/` is the live backend home for image-linking and attachment-linking handlers; the legacy `dtt_image_linking` package has been removed
- `filterest/app/frontend/core_components/admin_tools/asset_linking/` is the live frontend home (`asset_linking_view.js`); the legacy `image_linking_view.js` no longer exists
- live admin routes are now under `/api/asset-linking/{images,attachments}/*` (see `filterest/app/backend/core_components/router/router.go`); the old `/api/*-image-linking` endpoints have been retired

The staged migration described in `Asset_Linking_Migration.md` is now complete; this section reflects the current end state.

## 10. Related Documents

- System_Architecture.md (maintained in the private maintenance shell)
- Database_Guide.md (maintained in the private maintenance shell)
- [Frontend_Guide.md](Frontend_Guide.md)
- [Core_Workflows.md](Core_Workflows.md)
