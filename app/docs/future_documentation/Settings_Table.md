<!-- Describes one shared settings table for administrator editing. -->
<!-- Connects settings concepts, domain rules and dependable interaction. -->
<!-- Defines a general contract without choosing storage or source structure. -->
<!-- Keeps product authorities independent of the shared editing surface. -->

# One Settings Table Template

## What it makes possible

Every administrator settings table uses one simple, reliable template. Owners
learn one way to inspect settings, edit a draft, reorder rows where ordering
has meaning, and save changes with a clear result. Card visibility, view field
settings, permissions, referring tabs, dataset header text, site languages and
Home settings express their own rules through this same editing surface.

The template supports both compact lists and wider matrices. A combined
article-presentation editor can show each field's name and stable identifier,
independent visibility choices for Article, Image First Article and Page-sized
Image First Article, and a row-wide Select all column. A separate row group in
the same table can hold initial opening choices for collapsible blocks. The
template does not impose those columns on other settings.

Sharing the editor leaves each setting with its existing product authority.
Visibility settings do not grant access, and an initial opening choice does
not remove a block or replace a reader's current open or closed choice. The
[permission model](../instructions_and_documentation/Permission_Model.md),
[article collapsible-block defaults](../instructions_and_documentation/Article_Section_Defaults.md)
and [Home page](../instructions_and_documentation/Frontend_Home_Page.md)
documentation own those meanings.

**Available shared primitives (K376 batch 3a):** the checkbox table now offers
opt-in labelled native row groups/row headers, within-group keyboard move actions,
computed row selection, unsupported-cell rendering, caller-provided accessible
names, visibility-only filtering, external controls, order/metadata drafts,
context/revision-bound version-2 recovery and verified-result adoption guards.
See the [component options](../../frontend/reusable_components/vanilla_checkbox_table/README.md#opt-in-settings-table-features).
The article adapter and combined administrator editor now implement the five-column
family table, fixed opening-block rows, per-target baselines, one atomic revision-checked
Save with complete GET verification, staged defaults, external Cancel, scoped recovery
and phone scrolling with a sticky identity column (K376 batch 3b). Native browser
and PostgreSQL acceptance proofs accompany the source; their execution is a release
gate. Other domain adapters and the general requirements below remain future work;
the personal hosting surface is still unimplemented.

## Concepts and interaction

**Context and targets.** A context identifies the settings being edited and
their owners: for example a site, dataset, user group or personal preference.
The scope stays visible while editing. Rows with different scopes explain
those differences; selecting a user group cannot turn a dataset-wide setting
into a group setting. Changing context preserves a separate draft or offers an
explicit save, discard or stay choice.

**Rows and columns.** A row represents a named setting subject with a stable
identity independent of its translated name or position. A column represents
a property or a target dimension. Each cell binds that row, column and exact
target. Read-only identity cells can show a name and identifier together.

**Cell kinds.** The template provides boolean checkboxes, choices from named
options, text, multiline text, numbers, single-choice controls and read-only
values or status. Related controls, such as a duration amount and unit, form
one validated value. Domain actions have named controls. Unsupported,
permission-disabled, loading, unknown and erroneous cells remain distinguishable
from empty or false values, with an explanation where needed.

**Row groups and ordering.** Named row groups organize related settings and
keep their headings associated with their rows. A group may be collapsible.
These are visual settings groups, separate from the product's classification
values described in the [Dictionary](../instructions_and_documentation/Dictionary.md).
Ordering is available only where the domain gives it meaning. Reordering uses
stable row identities, respects group boundaries and fixed rows, and works
through both drag controls and labelled move actions. Search and filtering
change which rows are shown without discarding hidden edits or redefining
their saved order.

**Bulk choices.** A Select all column controls a declared set of boolean cells
in its row. It is checked when every eligible cell is true, unchecked when all
are false, and mixed otherwise. Activating an unchecked or mixed control sets
the eligible cells to true; activating a checked control sets them to false.
Unsupported and disabled cells are excluded, and a control with no eligible
cells is disabled. Column-wide bulk controls use the same rules. Each control
states its scope, including whether filtered-out rows are affected.

**Mixed target values.** A mixed value means that selected targets have
different saved values. It is distinct from an inherited, missing or unknown
value, and from the aggregate state of a bulk control. The draft retains each
target's baseline. Leaving a mixed cell untouched preserves those differences;
an explicit common choice changes only that cell's eligible targets. A person
can restore the original per-target values before saving. Differences in order
or priority are shown without silently choosing one target as the authority.

**Draft, save and readback.** Edit starts from an identified saved snapshot.
Changes remain in a draft until Save; Cancel restores that baseline. Any draft
recovery is bound to the actor, context, targets and baseline, so an old draft
cannot be replayed into unrelated settings. One Save covers the coherent edit
described by the domain, including ordering and dependent cell changes. The
interface states any separately saved action's boundary.

Saving validates the intended changes and the baseline revision. The saved
state becomes the new baseline only after authoritative readback confirms the
same context, targets, values and order. A write acknowledgement alone is not
proof of that result. If a write succeeds but refresh or verification fails,
the interface reports that distinction and requires fresh state before another
save. [Dataset appearance](../instructions_and_documentation/Frontend_Dataset_Appearance.md)
owns appearance values and their relationship to site defaults.

**Conflicts and errors.** A changed baseline produces a conflict without
overwriting another editor's work. The draft remains available while the person
reloads and compares the current values, then deliberately reapplies or discards
changes. Validation errors identify affected cells; request and permission
errors explain the failed operation. Loading and saving are visible, duplicate
submissions are prevented, and late responses cannot replace a newer context.

**Accessibility and phones.** Headers, row identities, groups and control
labels remain associated. Keyboard users can reach and operate every control,
including mixed choices and ordering; focus follows the same row after a move.
Changes, conflicts and errors are announced without relying on colour alone.
On phones, labelled cells can stack or a wide matrix can scroll within its own
area while retaining row and column context. Touch users can reorder without
dragging, and no essential action depends on hover.

**Themes and translations.** The template follows the application's explicit
light or dark theme even when the operating system prefers the other theme.
Labels, option names, hints, accessible names and outcomes use language keys.
Translated text can wrap without hiding controls. Changing language or theme
preserves the draft, ordering, search and target selection. The
[design constitution](../constitution/design/README.md) owns visual consistency
and readable interaction.

## General data contract

| Concept | Information and relationships |
| --- | --- |
| Settings context | Stable context identity, actor, exact targets and scope, domain capabilities and any dependencies on other settings. |
| Row description | Stable subject identity, displayed name, kind, visual group membership, optional position and ordering constraints. |
| Column description | Stable property or target identity, translated heading, cell kind, options, validation, editability and any declared bulk relationship. |
| Cell state | Row, column and target identities; saved and effective values where distinct; support, permission and availability state; explanation of defaults or inheritance. |
| Saved snapshot | Authoritative values and order for the exact context and targets, together with opaque revisions for every dependency that governs the save. |
| Draft | Baseline identity and revisions, per-target original values, explicit cell changes and intended ordering; derived mixed and bulk states are display information. |
| Save result | Confirmed scope and outcome, current revisions, authoritative readback or a way to obtain it, and validation, conflict or operation errors. |

The contract describes editing information, not a new settings store. Domain
rules decide valid combinations, supported cells, defaults, precedence and
which changes must commit together. Mixed states never become stored values.
An unchanged cell contributes no write intent, even when its effective value
is visible. Revisions prevent stale writes; readback verifies the result. Both
are needed.

## Implementation principles

- Keep one shared owner for rendering, interaction, drafts, bulk controls,
  ordering, accessibility and presentation. Screens provide declarative domain
  descriptions rather than copies of table behavior.
- Keep authorization, validation, defaults and transactional persistence in
  the product components that own the settings. The server rechecks identities,
  permissions and revisions; disabling a browser control is not enforcement.
- Make the normal path small and predictable. Optional cell kinds and grouped
  rows extend the same contract without creating screen-specific save behavior.
- Verify the shared contract through representative domains: independent
  booleans, mixed targets, constrained choices, reordered groups, failed saves
  and conflicts, keyboard and phone use, translations and opposite system themes.
