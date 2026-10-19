# Vanilla Checkbox Table

Reusable vanilla JS component for runtime-defined editable tables with checkbox-heavy workflows.

## What It Handles

- Dynamic rows and columns (no hardcoded dataset shape)
- Read-only and edit mode
- Save and cancel flows
- Dirty-state tracking
- Optional localStorage draft restore via `storageKey`
- Cell types: `checkbox`, `select`, `text`, `static`
- Per-column sizing via `width`, `minWidth`, and `maxWidth`
- Optional per-cell hover edit button that enters whole-table edit mode
- Read-only boolean indicators with built-in green/red/amber state colors

## Quick Example

```js
import { createVanillaCheckboxTable } from "./vanilla_checkbox_table.js";

const table = createVanillaCheckboxTable({
    containerElement: document.getElementById("settings-table"),
    columns: [
        { key: "name", label: "Column", type: "static", editable: false, width: "12rem" },
        { key: "enabled", label: "Enabled", type: "checkbox", width: "6rem" },
        {
            key: "card_element",
            label: "Card role",
            type: "select",
            width: "8rem",
            options: [
                { value: "details", label: "Details" },
                { value: "header", label: "Header" },
            ],
        },
    ],
    rows: [
        { id: "title", name: "title", enabled: true, card_element: "header" },
        { id: "summary", name: "summary", enabled: false, card_element: "details" },
    ],
    storageKey: "card-visibility-draft",
    onSave: async ({ rows, changedCells }) => {
        await saveToApi(rows);
        console.log("Changed cells", changedCells);
    },
});

// Optional API usage:
table.enterEditMode();
await table.saveChanges();
```

## API Surface

- `createVanillaCheckboxTable(options)` -> returns instance API
- Table option fields:
  - `showCellEditButtonOnHover`
  - `renderCellEditButton`
- Column option fields:
  - `key`, `label`, `type`, `editable`, `options`, `className`
  - `width`, `minWidth`, `maxWidth`
  - `renderHeaderCell`, `renderReadOnlyCell`, `renderEditableCell`
  - `isCellDisabled`
- Instance methods:
  - `getElement()`
  - `getRows({ draft?: boolean })`
  - `isDirty()`
  - `isEditMode()`
  - `setRows(rows, { resetDraft?: boolean })`
  - `setColumns(columns)`
  - `enterEditMode()`
  - `exitEditMode()`
  - `saveChanges()`
  - `cancelChanges()`
  - `clearPersistedDraft()`
  - `rerender()`
  - `destroy()`

## localStorage Behavior

When `storageKey` is provided and `persistDraftToLocalStorage` is not disabled:

- Draft rows and edit-mode state are persisted while editing/dirty
- Draft is cleared automatically after successful save or cancel
- On init, draft rows are merged back by row id (`rowIdKey`, default `id`)

## Toolbar Behavior

- Clean state is intentionally quiet by default: no status text is shown unless the caller sets `cleanLabel`
- `Cancel` exits edit mode even when no fields have changed yet
- `Save` stays disabled until the table becomes dirty

## Integration Notes

- The first real integration is `card_visibility_view`, which uses one dataset column per row and visibility flags as table columns
- `manage_permissions` is the second real integration, and it drove the library-level hover pencil behavior for readonly editable cells
- For long translated header labels, prefer setting explicit narrow `width`/`maxWidth` values so headers wrap to a few lines instead of forcing the whole table wider
- When the surrounding view already handles context-switch confirmation, keep that logic outside the library and let the library focus on row editing, draft state, and save/cancel behavior
- If a custom read-only renderer returns an `HTMLElement`, return it directly; the library now supports node content without requiring an adopter-side wrapper element

## Styling

- Base styles live in `vanilla_checkbox_table.css`
- Component class prefix: `vct-...`
- Read-only boolean cells intentionally use an explicit green checkmark for `true` and red cross for `false`; neutral grey indicators looked too ambiguous in real admin usage
- Checkbox/boolean cells are centered by the library via the shared `.vct-cell-checkbox` / `.vct-readonly-cell-shell` rules, so adopters should not need per-view centering fixes
- The hover pencil is anchored inside the hovered readonly cell via `.vct-cell-edit-button`; adopters can supply a custom icon with `renderCellEditButton`

## Opt-in settings table features

Existing callers need no changes. Without the following options, the toolbar,
DOM, hover pencil, native keyboard controls, version-1 storage, destruction and
`onSave({rows, changedCells})` contract retain their original behavior (including
adopting submitted rows after a resolved `undefined` or `null` callback).

| Option | Contract |
| --- | --- |
| `rowGroupKey` | Row property identifying a visual group. |
| `rowGroups: [{key, label}]` | Ordered translated group labels; each group is a labelled native `tbody` within the same table. |
| `rowHeaderKey` | Column rendered as `th scope="row"`; column headers get `scope="col"`. |
| `reorder: {group, inColumn, labels, onChange?}` | Only rows in this group move, within their own contiguous group. Buttons live inside `inColumn`; `labels` requires translated `up`, `down`, `filtered` and `position`. `position` is a function receiving `{name, position, count}` or a string with those placeholders. `onChange({rowId, order})` records a domain order intent, including moves back to the displayed initial order. Native buttons support Enter/Space, retain focus and stay focusable with guarded `aria-disabled` at boundaries. |
| Column `rowToggle: {columns: [key, ...]}` | Computed aggregate over supported real boolean cells (including disabled cells for display); mixed values stay mixed. Mixed/unchecked activation writes true, checked writes false, only to supported enabled editable cells. No aggregate value enters rows, changes or storage. No writable cells disables it. |
| Column or table `isCellSupported(context)` | Returns support for a cell. Column hook takes precedence. Unsupported cells bypass all ordinary renderers and checkbox creation. |
| `renderUnsupportedCell(context)` | Required when support can be false. Return a translated dash node with a translated accessible explanation (for example a span with `aria-label`). No default English copy is invented. |
| `cellAccessibleName(context)` | Translated name applied to cell inputs, selects, textareas and buttons. Receives `{row, column, rowIndex, group, groupLabel, value, isEditMode}`; include group, field name/UID, presentation and the domain meaning (Visible/Open at start). |
| `toolbar: "external"` | Omits the built-in toolbar; the host owns Save/Cancel, dirty feedback and error announcements. |
| `startInEditMode: true` | Starts editable; also available to legacy callers. |
| `draftContext` | Opts into version 2. Exact JSON context identity (actor, dataset, targets, family); its optional `revisions` property is stored separately as baseline revisions. Use a separate storage key for each context. |
| `draftRevisions` | Alternative initial revisions when they are not nested in `draftContext`. |
| `draftMetadata` | Initial domain metadata baseline (JSON value, default null); subsequent metadata is an explicit intent. |
| `onDraftRecovery({status, draft?})` | Reports `recovered`, `revision-conflict`, `context-mismatch`, `invalid-draft`, `invalid-identities`, `invalid-order`, `invalid-cells`, `discarded` or `none`. Invalid/stale drafts remain stored and unreplayed. The host supplies translated reconciliation UI. |
| `baselinePolicy: "verified-result"` | `onSave` receives the change set below and must return `{rows, context, revisions, metadata}` from verified authoritative readback. Missing/incomplete/mismatched results reject; submitted rows are never a fallback baseline. Real column values, row identities/order, metadata and exact context must match the submission, with the complete revision dependency keys supplied by the caller. Controls freeze during Save; generation/disposal guards ignore late results. |
| `onSaveError({code, committed, error})` | Host supplies translated error feedback. A write that committed but could not be verified must reject with `error.committed = true` (optionally `code = "verification-failed"`). Missing/mismatched returned readback is treated conservatively as committed. Drafts remain and further Save is blocked until `setRows` supplies fresh state. A rejected uncommitted write permits retry. |

Additional methods:

- `moveRow(id, delta)`: moves one place (`-1` or `1`), returns false for a boundary,
  fixed group, active filter or frozen Save. Resolves the ID at activation.
- `setRowFilter(predicate|null)`: changes only existing row visibility, preserving
  values and node identity. Never calls `setRows`. The caller keeps fixed blocks
  visible in its predicate. Any active predicate disables reordering and exposes
  `reorder.labels.filtered` as an accessible explanation.
- `getChangeSet()`: deep-cloned `{rows, changedCells, order, context, revisions,
  metadata}`. Only real changed cells are intents. Order and metadata changes
  make the table dirty even without a cell change.
- `setDraftMetadata(value)`: replaces metadata intents and recomputes dirty state.
- `getRecoveryState()`: reads the last recovery outcome.
- `reconcileDraft({discard?: boolean})`: explicitly replays a revision-conflicting
  draft against the supplied baseline, or discards it. Invalid identities,
  support, context or ordering cannot be accepted; supply corrected fresh state
  first. The domain must compare per-target baseline differences before acceptance.
- `setRows(rows, {context, revisions, metadata, resetDraft?})`: the existing method
  also accepts a fresh verified snapshot, invalidates pending save responses and
  resets the verification block. In settings mode, use the normal reset behavior
  and provide all current snapshot fields.

Version-2 drafts store `{version:2, editMode, context, revisions, changedCells,
order, metadata}`. Before replay, the table checks the complete unique row-ID set,
real editable columns, current support, group boundaries, fixed rows and exact
context/revisions. Reconciliation is explicit; disposing a context (`destroy()`)
keeps its draft. Cancel restores cells/order/metadata and clears the draft; a
verified Save clears it only after adoption. Keep each target's immutable baseline
and mixed-target/width/priority rules in the caller; a computed row toggle never
becomes an instruction to flatten untouched targets.

Feature CSS is scoped to `.vct-features`. It uses the application's theme
variables, wrapping identity cells, a separate horizontal table scroller and
44px reorder controls. A host must still prove its full five-column phone layout,
translated copy and explicit themes in a browser.
