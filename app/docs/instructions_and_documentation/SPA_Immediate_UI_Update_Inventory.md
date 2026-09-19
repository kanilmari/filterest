# Immediate UI Update Inventory

This inventory records whether a successful application mutation is visible without F5.
It distinguishes the initiating surface, other views of the same dataset, and other browser
tabs because those paths currently have different refresh guarantees.

## Current architecture

- Generic row create, update, and delete handlers publish a metadata-only `row_change`
  event after the database transaction commits.
- The event currently contains `table`, `row_id`, `action`, and `changed_fields`. It does
  not yet contain an authoritative row/patch, a mutation identifier, or a list of affected
  parent/child datasets and UI surfaces.
- The browser subscribes only to the active dataset. A received event triggers a debounced
  full refresh of that dataset, or reruns its active search.
- The initiating UI frequently performs an additional local refresh. There is no shared
  registry that reconciles the write response with the later event or prevents duplicate
  same-tab work.
- A child asset mutation publishes the child-table name. A browser subscribed only to the
  parent dataset therefore cannot infer that its card image or open article also changed.

## Observed mutation matrix

| Mutation | Initiating surface without F5 | Other same-dataset surface | Other browser tab | Current limitation / evidence |
| --- | --- | --- | --- | --- |
| Create a row | Yes: the create flow reloads the active dataset from offset zero | Yes, through the same active-dataset refresh | Usually yes when that dataset is active | The response contains only a message, so the whole dataset is fetched again. |
| Edit ordinary row fields in an article/card | The edited DOM is restored from the submitted value | Background cards depend on the active-dataset event refresh | Usually yes when that dataset is active | One API request and event are emitted per changed field; there is no `mutation_id` deduplication. |
| Delete selected parent rows | Yes: the initiating flow refreshes the dataset | Yes | Usually yes when that dataset is active | A full refresh is used instead of an authoritative delete patch. |
| Upload, delete, reprioritize, or edit an image asset | Partial | Partial | No reliable parent refresh | The gallery refreshes its child rows, but the child event does not identify the affected parent surface. |
| Delete an image while its article is open | Fixed in the first inventory slice | Background card refresh still needs the general affected-surface model | No reliable parent refresh | The open article previously merged authoritative fresh child rows with the stale parent `cached_image`, resurrecting the deleted image until F5. |
| Save dataset hero/cover/background configuration | Yes: authoritative readback updates the active hero, content background, cached table specification, and tab-shape metadata | The active dataset surface and main-tab geometry update immediately | Not centrally broadcast | The initiating browser no longer needs F5; cross-tab propagation still needs the general affected-surface event contract. |
| Change column/view metadata | Mixed | Mixed | Not centrally reconciled | Several editors invalidate metadata caches, but consumers decide independently whether to rebuild now or on the next navigation/F5. |
| Change a generic site setting | Mixed; often F5 | Mixed | No | The generic settings editor writes one physical value and does not own all runtime consumers or mirrored values. Dedicated settings endpoints behave better. |
| Change permissions or administrator authentication | Deliberately conservative | Deliberately conservative | Deliberately conservative | Cached permissions/session capabilities may require a new session or explicit permission refresh; this must not be guessed from a generic row event. |
| Change a translation | Visible text can be retransformed when the active language path invokes `translatePage` | Mixed | No general cross-tab reconciliation | Dataset content translations and interface-language keys use different loaders and caches. |

## First corrected slice: image deletion in an open article

When a related image dataset has resolved, its returned rows are authoritative. The article
gallery no longer appends the parent row's older cached-image fallback to those rows. The
fallback remains available only when no image child relation exists. This removes the deleted
image from the open article immediately while preserving legacy datasets that store only a
parent image field.

## Required central contract

The remaining gaps should converge on one mutation contract instead of accumulating more
per-component reload calls:

1. The write response returns the committed authoritative row or patch and a `mutation_id`.
2. The post-commit event carries the same `mutation_id`.
3. An `affected` list names parent and child datasets, row IDs, and surfaces such as cards,
   open article media, result count, hero configuration, or permission/session state.
4. A frontend mutation registry applies a local patch, invalidates a cache, refetches one
   surface, or closes a deleted article according to that list.
5. The initiating tab ignores its already-applied event by `mutation_id`; sibling tabs still
   apply it.

The image-asset family is the recommended next vertical slice because it exercises a child
row, a cached parent field, a card thumbnail, an open article, and an image-first view in one
bounded workflow.
