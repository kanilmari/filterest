<!-- Table_Column_Tools_And_Multi_Field_Sort.md -->
<!-- Describes planned inline column tools and ordered multi-field sorting. -->
<!-- Connects table headers, dataset definitions, query state and permissions. -->
<!-- Preserves the missing capability and its acceptance contract without claiming implementation. -->

# Table Column Tools And Multi Field Sort

## What it makes possible

The planned tools let a person change a dataset's columns directly from its
table view and sort the same dataset by several fields in a chosen order.
For example, sort by region (Finnish *maakunta*), then city, then name. A later
key decides the order only when all earlier keys have equal values.

This document preserves ticket #885's full goal and acceptance criteria and
WL76's column-tools plan. These combined tools and user-defined multiple sort
keys are **not implemented**. The current capabilities below are context for
extending the existing product, not promises to rebuild them. Ticket #885 is a
standalone main task in the development-task dataset, not a subtask; creating
the ticket did not implement the feature.

## Concepts and ordered sorting contract

A **sort key** identifies a field and its ascending or descending direction.
An **ordered sort definition** is the person's priority-ordered list of those
keys. A **sort mode**, such as Newest, is a chosen meaning whose effective
field can depend on the dataset. A **draft column** is a browser-held name,
column-wide type and values attached to stable row identities; an empty
addition slot is neither a draft with content nor a stored column.

The future sorting capability must meet every part of #885:

1. A person can add and remove sort fields and change their relative priority.
   Every field has its own ascending or descending direction.
2. The interface shows the chosen sequence and directions understandably.
   The whole ordered definition survives URL sharing, F5 reload and browser
   Back/Forward navigation.
3. The server uses the same ordered definition across result views. Existing
   permission checks and allowed-column checks remain authoritative for every
   key; a sort choice cannot expose a forbidden field.
4. Empty values have one consistently defined ordering rule. A unique final
   key makes pagination and endless scrolling stable, including ties across
   page boundaries. The exact empty-value rule must be specified consistently
   at implementation; this document does not invent a ticket decision.
5. Existing single-field sorting and old URLs continue to work.
6. Verification includes region → city → name, equal values, mixed ascending
   and descending directions, and the result order continuing across a page
   boundary.

## Planned inline column tools

The following is WL76's target interaction, not the current table header:

1. The end of the table has an **Add a column** slot first; additional empty
   slots show **+**. These are draft entry points, not pre-created columns.
2. Extra slots appear only when the real table is clearly narrower than its
   container. Measure the container's actual inner width and the table width
   excluding filler slots. The first slot, at least one extra slot and a small
   edge allowance must fit. Extras fill almost all free space without creating
   horizontal overflow. A nearly full or already wider table gets only the
   first slot. Preserve existing horizontal scrolling and never shrink real
   columns to make filler fit.
3. A bounded resize observer updates this calculation. Narrowing the window
   must not remove a slot whose draft has started. Filler must not increase
   the next measurement's demand for more filler.
4. A person enters the new column's name in its header and can enter values
   in its draft cells. The default type is TEXT and applies to the whole
   column, never to an individual cell. Empty slots and Cancel write nothing.
5. An existing column's header gear offers its name, type, deletion and card
   role. Card roles use the shared role catalogue and the same field metadata
   as the existing field settings.
6. Sorting and the gear appear on header hover, keyboard focus within the
   header, and an explicit touch action mode. Use real buttons with keyboard
   support and accessible names. Controls fit inside the existing header
   width; showing them must not widen the column. Ellipsize the header text
   only while the buttons are visible. Touch must work without hover, and the
   column resize handle remains a separate action.

### Truthful sort indication

Keep the selected sort mode separate from its effective field. For Newest,
the header must show the active descending direction on the actual field and
an accessible label must explain Newest. An identifier used only to resolve
ties must not look like a second primary sort.

Use server-reported effective sorting or one shared, precisely tested resolver
contract for the header, dropdown, URL state and search-result sorting. Do not
introduce another conflicting fallback list. Newest selects the first
existing field among created → created_at → applied_at → id; it does not seek
the newest timestamp on each row or use updated. Distinguish an incorrect
header indication from proof that the actual row order is wrong.

## Atomic drafts, lossless types and deletion

Creating a column, saving its metadata and writing its draft cells must happen
in **one transaction**. Associate values with stable row identities and identify
the column with the server-returned column identity (`column_uid`). Creating
the column first and then issuing separate, non-atomic cell requests does not
meet the contract. A validation failure, permission refusal or single failed
cell write rolls everything back. Keep the browser draft available to correct.

A type change must check **every value in the whole column**, not just the
loaded page. Invalid values, overflow, precision loss, string truncation and
loss of timezone or meaning block saving. A successful SQL cast alone does
not prove losslessness. Return a bounded error summary with example rows the
person is allowed to see. Protect validation and conversion against concurrent
changes in the same transaction. Never silently reinterpret empty or
multilingual JSON values as different content.

Deletion must identify the column and the extent of the content that will be
lost. Preserve primary-key and dependency protections; do not add cascading
deletion.

## Permissions and implementation principles

Extend the existing [permission model](../instructions_and_documentation/Permission_Model.md).
Present actions as reading, editing content, editing structure and managing
permissions, using the current route, dataset, row and field checks. Do not
invent role names or a second authorization system. Ordinary content-editing
rights must not grant structure-editing rights. Saving draft cells also
requires write rights on the target rows; column creation cannot bypass them.

One header gear must preserve other fields' settings when saving a card role.
WL76's plan identified the separate card-visibility API and the danger of
sending one field as a partial replacement for all settings. Reconcile this
with the newer transactional column-role support described below rather than
copying an obsolete save path.

Extend the existing table structure and styles, cell/grid interactions and
saved column widths, column-management workflow, column CRUD and metadata,
shared card-role catalogue and card-visibility client, sort dropdown and
server resolver. Split additions to large files into small named helpers.
Confirm exact ownership and dependency impact, including the GitNexus impact
review, when implementation begins. Existing view-field settings work
(WL52 / #881), permission-model work (WL73), supported-view metadata (#874)
and metadata identities (#877) are neighbouring concerns, not another copy of
this feature.

Interface text must use language keys and retain translations. Controls must
work in both explicit application themes, including when the operating system
prefers the opposite theme.

## What exists today: verified source boundary

These source references describe the current code, not implemented multi-field
sorting or inline drafts. They are review evidence for this proposal.

| Current fact | Source evidence |
| --- | --- |
| The result-order builder reads one sort column and one direction. | [get_results_query.go:272](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_query.go#L272), [get_results_query.go:273](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_query.go#L273) |
| Newest resolves by column existence in the order created, created_at, applied_at, id, returns no order if none exists, places NULL last, and adds id in the same direction for ties when present and different from the chosen field. | [get_results_query.go:336](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_query.go#L336), [get_results_query.go:342](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_query.go#L342), [get_results_query.go:349](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_query.go#L349), [get_results_query.go:359](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_query.go#L359) |
| The header uses a clickable span for sorting and shows its active direction only when the selected column equals that header's field. A semantic Newest selection therefore has no matching ordinary field header. | [table_structure_builder.js:180](../../frontend/core_components/table_views/table_view/table_structure_builder.js#L180), [table_structure_builder.js:186](../../frontend/core_components/table_views/table_view/table_structure_builder.js#L186) |
| The modify-columns request carries added, modified and removed column definitions, not draft cell values. A column definition has one type and optional length. | [crud_workflows.go:426](../../backend/core_components/dynamic_table_tools/dtt_crud_workflows/crud_workflows.go#L426), [modified_col.go:10](../../backend/core_components/dynamic_table_tools/dtt_2_column_crud/modified_col.go#L10) |
| Column changes and metadata already use a request transaction and check that a primary key remains; this does not yet include draft-cell writes. | [modify_columns_handler.go:134](../../backend/core_components/dynamic_table_tools/dtt_crud_workflows/modify_columns_handler.go#L134), [modify_columns_handler.go:193](../../backend/core_components/dynamic_table_tools/dtt_crud_workflows/modify_columns_handler.go#L193) |
| Modifying structure uses the administrator security profile. | [route_profiles.go:290](../../backend/pipeline/route_profiles.go#L290) |
| Type changes issue an ALTER COLUMN TYPE, without the plan's separate whole-column losslessness validation. | [column_update.go:341](../../backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update/column_update.go#L341) |

## Neighbouring changes identified by R1010

Reconcile these already present changes when implementing WL76; do not promise
them as new work or weaken the losslessness requirement to match them.

| Existing neighbour | Evidence and implementation consequence |
| --- | --- |
| Dataset creation and Manage table share one column table. | [dataset_form.js:117](../../frontend/core_components/general_tables/dataset_form/dataset_form.js#L117) selects the creation/edit mode of [dataset_column_table.js:49](../../frontend/core_components/general_tables/dataset_form/dataset_column_table.js#L49); [dataset_column_table.js:77](../../frontend/core_components/general_tables/dataset_form/dataset_column_table.js#L77) adds its Add column button. Reuse the shared vocabulary and controls rather than introduce a second catalogue. This form is distinct from the proposed inline table slots. |
| Card roles can be edited for existing datasets. | [dataset_column_table.js:55](../../frontend/core_components/general_tables/dataset_form/dataset_column_table.js#L55) includes existing role variants; [crud_workflows.go:433](../../backend/core_components/dynamic_table_tools/dtt_crud_workflows/crud_workflows.go#L433) accepts per-column roles and [modify_columns_handler.go:163](../../backend/core_components/dynamic_table_tools/dtt_crud_workflows/modify_columns_handler.go#L163) applies them in the column transaction. Preserve other fields' roles. |
| JSON-to-number conversion changes an empty JSON string into NULL. | [column_update.go:405](../../backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update/column_update.go#L405) uses NULLIF before casting. This conflicts with WL76's prohibition on silently changing empty JSON content. Future lossless validation must refuse that silent conversion; do not treat cast success as acceptance. |

## Acceptance and regression evidence required at implementation

- Prove every #885 case: region → city → name; tied keys; mixed directions;
  adding, removing and reprioritizing keys; visible sequence and directions;
  URL, F5 and Back/Forward restoration; one server definition across result
  views; permitted columns; one empty-value rule; a unique final key and
  stable order across page boundaries and endless scrolling; old single-field
  choices and URLs.
- Exercise narrow, nearly full and over-wide tables and window resizing.
  Verify filler never creates overflow or removes an active draft, real
  columns retain their widths, and hover does not change measured width.
- Exercise mouse, keyboard and touch, independent resizing and accessible
  control names; all supported interface languages, Finnish/English content
  and both explicit application themes over the opposite OS preference.
- Exercise draft Save, Cancel and error recovery; atomic rollback on each
  failure path, stable row identities and row-write permission refusals.
- Exercise valid and lossy whole-column type changes, including invalid values,
  overflow, precision, truncation, timezones, empty and multilingual JSON,
  concurrent changes and permission-limited error examples; deletion scope,
  primary keys and dependencies; different user permission levels.
- Exercise Newest with all four fallbacks and a dataset with none, NULL values
  and ties. Verify both actual row order and truthful header indication, with
  the id tie-break not presented as a second primary sort.
