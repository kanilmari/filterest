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
