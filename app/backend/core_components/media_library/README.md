<!-- README.md -->
<!-- Describes the first bounded existing-image reuse workflow and its limits. -->
<!-- Between asset-child relations, row creation, current permissions, and independent storage. -->
<!-- Exists so future library work preserves the tested audience and retention contract. -->

# Existing image reuse

The create-row image section can select a stored image in the same dataset and
registered image relation. Submission sends its relation and source-row identity;
the server creates a normal asset-child usage in the parent's own transaction.
The existing image caption fields are copied without translation. The source row,
source files, order and primary flag remain unchanged. A new usage retains its own
caption snapshot; editing shared default captions and per-language inheritance
are outside this first slice.

API: GET /api/media-library/list?relation_id=...&after=...;
POST /api/media-library/attach and /detach use dataset, relation_id,
parent_row_id, and source_row_id or asset_id respectively. Attachment returns
asset_id, usage_row_id, url and unchanged. Repeating an intact attachment is a
no-op. Detachment is exact-target-only and never deletes physical bytes.

Only same-dataset, same-relation images whose parent and child tables have no
PostgreSQL RLS, mandatory visibility flags, exact-row read rules, or row-group
memberships are reusable in this first slice. This proof is repeated on every
metadata and file request, for administrators as well as ordinary readers.
Unsupported policies fail closed with meaningful UI copy. Table/function and
column permissions are checked separately, using the actor's role transaction.
A later restriction revokes every related media URL immediately.

A physical file is copied once into storage/media/<uuid>/, preserving the
original. Originals and available 300/1000/2160 variants use the same protected
storage authorization and private,no-store response. One live exact usage
plus current permissions is always required; knowing a cached_image URL grants
nothing. Normal, semantic and related-row responses also clear unavailable media
URLs and derived cached_image_* support fields; independently authored
title/description values retain their ordinary row/column permissions. Parent or dataset deletion cannot move this independent directory.
The existing generic asset-delete resolver skips this new namespace.

The copy journal is private and cannot be served by the storage route. A normal
rollback removes only files and folders created by that request. A process crash
can leave an unreachable independent folder: inspect its copy.json and registry
before any manual cleanup. There is deliberately no automatic deletion or
garbage collector in this slice. Stale usage bookkeeping does not authorize
reads; the actual child row and parent FK are rechecked. Global orphan cleanup,
cross-dataset publication, shared-caption editing, and bulk legacy migration
remain future work and must not be inferred from this API.
