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

## 4. The Card Picture Rule

Each parent row can have many pictures; its card shows one, stored in `cached_image`.
One rule chooses it everywhere (owner decisions K120 and K121, 30.9.2026). It lives in
two places that cannot drift apart: the pure parts in
`dtt_card_picture` (gallery order, the choice, the gallery's relation, the picture fields)
and the writer in `dtt_asset_linking/card_picture_rule.go`.

**The gallery** is the parent's one picture relation (`dtt_card_picture.PictureRelationOf`):
the first shared-asset relation that can hold pictures, otherwise an `_assets`-style child
table with the asset columns, otherwise an older single-purpose picture relation. A relation
that holds only attachments is never a gallery. Its pictures are ordered once
(`GalleryOrderClause`): `is_primary` first, then `sort_order` (empty counts as 0), then
`created` (an undated row counts as the oldest), then `id`.

**The precedence** (`ChooseCardPicture`), where a "card-only" picture is a stored
`cached_image` value no row of the parent's upload relations carries:

1. a card-only picture the rule cannot keep elsewhere stays — a file in another row's
   folder (K121), an external address, a media-library picture whose file is there, an
   own-folder file of an older relation, or a file that could not be checked; neither an
   upload nor a primary mark replaces it, only an administrator clearing the field;
2. otherwise the primary picture;
3. otherwise a card-only own-folder picture of a shared gallery stays and counts as the
   gallery's first; when a primary replaces it, it is first kept as a gallery row placed
   first (smallest `sort_order` less one, not primary, `metadata_json.recovered_from`), so
   taking the primary mark away brings it back;
4. otherwise the gallery's first picture;
5. otherwise nothing (a card picture whose file is certainly gone counts as none).

**New pictures are appended**: every creator of a gallery row (an upload, a new row's child
rows in list order, a media-library attach, a linked existing row, a CSV restore row
without a `sort_order`, an automation insert) calls `SettleNewGalleryRows`, which gives the
row the next `sort_order` under the parent's lock and applies the rule. Linking existing
rows reaches only a gallery found by its columns: registered upload relations refuse it,
and a linked row never had a parent, so no earlier parent needs the rule. An upload therefore
becomes the card picture only when the row has no picture. An uploaded file's name runs the
rule once it is stored, whatever the upload settings' cache targets say, and a new row
that brings its own first card picture (an ordinary add, an automation) has it checked by
the rule like any other.

**Every writer decides under the parent's lock** (`FOR NO KEY UPDATE`), "nothing changes"
included, so two changes at once cannot leave a deleted picture on the card. A writer waits
at most 5 s for the lock; a wait that runs out leaves the card picture to the row's next
change or the startup alignment, and an append that cannot get the lock fails the creation
as a whole rather than placing a picture out of order.

**The field is derived**: a direct edit of `cached_image` accepts only an administrator
clearing it, which releases the current picture; any other value is refused. A CSV restore
never overwrites a picture the rule keeps, not even with an empty cell: an only copy in the
row's own folder becomes a gallery row first; otherwise the stored value is written back and
the restored one is logged as a conflict (`[card picture] restore conflict`). A startup
alignment (`AlignCardPictures`) brings rows whose stored choice a gallery row carries but
which differs from the rule (the retired "newest upload wins" state), or whose card picture
is empty while the gallery has pictures, to the rule. It checks each row again under its
lock, so it never touches card-only pictures, bounds every statement by its time limit, and
writes nothing once a run has completed.

A dataset's own image fields (columns with an image card role) are the dataset's data;
the rule does not write them.

**The picture a row shows** is the card list's choice, and the article follows it (owner
decision K128, alternative (a)). The choice is the first non-empty image-role field the card
shows: not hidden on the small card, delivered to the browser, and with a `false` skipped
where the card hides false values. Without one, it is the first named picture field
(`CardPictureFields`, `cached_image` first) that holds a picture. The related-rows response
reports it as `card_picture` (`dtt_card_picture.ChooseShownPicture`), limited to
media-library pictures the viewer may open. The article starts on that picture. A picture
the viewer browsed to stays shown across later refreshes while the gallery still lists it,
and pictures are told apart by their whole address, host and query included.

Whether a named field holds a picture is one test, stated on both sides: `LikelyPictureValue`
on the server and `normalizeFallbackImageCandidate` in `card_element_builder_helpers.js`.
Both sides' tests read
[`testing/shared_contracts/card_picture_candidate_examples.json`](../../testing/shared_contracts/card_picture_candidate_examples.json),
so a change to one side that the other does not follow fails a test.

A multilingual value in an image-role field is reported as stored, because the server does
not know the viewer's language. The browser then reads a plain language map of texts in the
viewer's language, as the card's image does (`extractLangValue`).

The server reports no picture when the value names a media-library file the viewer may not
open, alone or inside a language map. This covers values written as `/storage/media/…` or
as a relative `media/…` that the browser reads under `/storage/`. For the check, the query
and fragment are set aside and `./` and `../` segments resolved, as the browser and the
storage route treat them; the value itself is reported as written. The check does not
decode percent-encoding: a disguised prefix such as `/stor%61ge/media/…` and a full address
of the site itself are not recognised, while an encoded file name under `media/` is
recognised and refused. The storage route still refuses the file to a viewer who may not
open it. The shared row filter, which every row response uses, checks only the
`cached_image` and `filename` fields, and only a value that starts with `/storage/media/`
literally. It hides such a value followed by a query or fragment even from a viewer who may
open it.

These differences remain:
- For an empty image-role field that the card does not hide, the card shows a letter avatar,
  and the article shows the row's next picture. The same applies to an empty value for the
  viewer's language.
- The server chooses among the fields before the language is known. So a field whose
  viewer-language value is empty, or is a `false` the card hides, still wins over the next
  field.
- The card first applies the column's multilingual setting (`is_multilingual`). The article
  applies only the image's own reading. So for a column marked multilingual whose value is
  not a plain language map of texts, the card can show one language's picture while the
  article shows a broken picture made of the stored text. Examples are a map with a `null`
  or other non-text value for some language, and a map encoded inside a text. A language
  left out entirely is fine: `{"fi":"fi.png"}` reads the same in both.
- The card list resolves names with its own path helper. A storage path to a sized copy,
  such as `104/133/300/104_133_38.png` or `/storage/104/133/300/104_133_38.png`, opens
  the original from the card but shows that sized copy as the article's picture.

## 5. Storage Model

Current implementation is local-filesystem-first.
The current file layout still matters:

- `/storage/<table_uid>/<row_id>/original/...`
- thumbnail subfolders for image profile

Current canonical shared-asset rule:

- direct uploads into `<parent>_assets` still store files under the parent dataset uid and parent row id
- canonical filenames therefore keep the parent-based shape `<parent_table_uid>_<parent_row_id>_<asset_row_id>.<ext>`
- shared asset delete cleanup moves files out of that parent-based folder layout at file level after a successful transaction commit; a file that a remaining row of the same parent or the parent's preview (after the resync) still names stays in live storage
- storage cleanup (`/api/check-media-tables`, `/api/archive-media-tables`, `/api/check-archived-media-tables`, `/api/prune-archived-media-tables`) only ever treats top-level folders named by a canonical positive integer as dataset folders, so `media/`, `service_catalog_logos/`, `lost+found`, backup folders and `storage_deleted/media/` are never listed, archived or pruned
- image/attachment status payloads should expose explicit `relation_kind` and `foreign_key_column` metadata so read/detail surfaces can resolve shared media without guessing only from `_assets` / `_images` suffixes
- the missing media files check reads this layout to report rows whose file no size folder holds any more, and never repairs or deletes anything; see [Missing_Media_Check.md](Missing_Media_Check.md)

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
- every change of gallery rows ends in the card picture rule (section 4) for exactly the parents it touched: `CollectSharedAssetParentCacheSyncPlan` before the change (it records the values the change releases), `AddCurrentSharedAssetParents` after it, then `ResyncSharedAssetParentCache`, which applies `ApplyCardPictureRule`
- the rule never drops a card picture it cannot keep. A picture is kept as a gallery row (same stored name, no file copy) only when it is the only reference to a file in the parent's own folder and the gallery is a shared relation; a picture in another row's folder is left in place, because a gallery row here would later move that other row's file on delete. "Carried" means any row of any upload relation of the parent names it (whatever its `asset_kind`), compared by value and by stored file. File presence is asked with `media_utils.StoredFileState`, which answers "could not check" for an unreadable or unmounted disk, and the rule then keeps the picture. The rule locks the parent row before its deciding read, so concurrent writers keep a value at most once, and it runs behind a savepoint: when the caller's database role may not insert gallery rows or the insert fails, the operation still succeeds and the card picture is left untouched, with one log line
- row edits collect the plan before the column update, so a renamed file is released rather than kept as a stale card picture, and a row moved to another parent refreshes both the parent it left and the one it joined. Other `cache_targets` columns keep their plain write; they are not card pictures
- direct uploads into canonical shared `_assets` tables must normalize storage back to the parent dataset uid + parent row id instead of inventing child-table-specific folder roots
- direct shared `_assets` uploads must fail fast when the canonical parent storage context cannot be resolved; they must not silently fall back to the older child-table storage layout
- migrated historical shared-asset rows may still carry filename keys that point at older storage roots; shared-asset delete/archive cleanup should resolve the actual storage root from the stored filename instead of resurrecting legacy table-aware branching
- read-side media detection shares the lightweight FK/file-upload metadata reader of `dtt_card_picture` (`ListRelationStatuses`, `PictureRelationOf`), so card-support enrichment, child-tab relation-kind classification and the writers decide from the same parsed metadata; the read path cannot import `dtt_asset_linking` (`dtt_asset_linking → dtt_crud_workflows → dtt_1_row_read`)
- the article's gallery rows come from the server in gallery order, pictures before other files and before the 50-row limit, with the parent's gallery relation (`gallery_relation`, named only when the viewer may read it) and the picture the row shows (`card_picture`); the rows and the picture are read in one read-only snapshot, or, where the row-security pilot dataset is involved, the rows first and the picture after them, so a deleted picture cannot come back; `child_tables` is always a list, empty when the viewer may read no relation, and the browser takes the response as final and does not sort or choose a gallery of its own
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
