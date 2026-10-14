<!-- Linked_Name_Filter_Visibility.md -->
<!-- Describes independent filter visibility for a reference and its linked name. -->
<!-- Connects administrator field settings, relation identities and saved queries. -->
<!-- Keeps the missing capability distinct from today's shared visibility rule. -->

# Independent Linked Name Filter Visibility

## What it makes possible

An administrator can hide a technical reference identifier from the filter bar
while offering its readable name, or hide both with one choice. The setting
belongs to each dataset's reference, so a category can expose its name without
forcing creator and owner names to appear. It affects filters and their saved
selections, independently of the values displayed in cards or tables.

## Current boundary and concepts

Today the source and generated name filters are hidden together when the source
filter is hidden. Visible sources retain the existing redundant-name rule.
Previously active hidden names are discarded on restoration and the remaining
query is loaded again. The implemented contract is maintained in
[Column filter visibility](../instructions_and_documentation/Frontend_Dataset_Appearance.md#column-filter-visibility);
this document describes the missing independent controls.

- **Reference source:** a stored field that identifies a row in another dataset.
- **Linked name:** a generated readable display field belonging to that reference.
  Its visible label, including a linked-name suffix, is not its stable identity.
- **Filter visibility:** permission to offer a field's filtering control. It is
  a presentation setting and does not grant access to another dataset's data.
- **Shared hiding:** one administrator choice suppresses both source and names.
- **Independent hiding:** an explicit choice suppresses one while allowing the
  other. For example, hide the ID input and show the name input.

Hiding a source everywhere remains a hard boundary. Independent filter choices
cannot reveal names whose source or referenced values are withheld from the
reader. The ID-hidden/name-visible example uses filter-panel hiding only.

## Two data model options

### A. A setting on the generated field

Each generated linked-name field has a nullable visibility override:

| Stored choice | Effective behavior |
| --- | --- |
| Inherit (missing or unset) | Apply shared source hiding and today's redundancy rule. |
| Show | Offer the name even when the source input is hidden; still enforce read access and hiding everywhere. |
| Hide | Omit the generated name input regardless of source filter visibility. |

The source retains its existing visibility choice. Thus source hidden/name Show
produces name-only filtering, and source hidden/name Inherit hides both. An
explicit Show with a visible source must bypass duplicate suppression if the
administrator deliberately wants both controls.

Generated fields need durable identities in the metadata model: the source
field identity plus the referenced display role, rather than a generated label.
The metadata catalogue must distinguish virtual display fields from physical
fields. Multiple generated displays can then have independent overrides.
Changing a relation's target invalidates or deliberately remaps its overrides;
renaming a field or its translated label does not lose them.

This model offers fine control but requires generated-field metadata storage
and clear ownership for generated displays that exist only in certain views.

### B. A setting on the reference source

Store one filter-exposure choice with the reference's existing field metadata:

| Stored choice | Effective behavior |
| --- | --- |
| Inherit (missing or unset) | Keep today's source visibility and redundancy behavior. |
| Hide both | Suppress the source and all generated linked-name inputs. |
| Source only | Offer the source input and suppress its generated names. |
| Name only | Suppress the source input and offer its readable linked names. |
| Both | Offer both deliberately, bypassing duplicate suppression. |

Hiding everywhere and read permissions take precedence over every choice.
The setting follows the source's stable identity, surviving generated suffixes
and translated label changes. If the relation cannot supply a readable name,
Name only offers no input; it does not silently substitute an ID input.

This is the simpler candidate when administrators think of one reference pair.
Its tradeoff is that several generated displays share one exposure choice.
Choose one authority before implementation; do not persist both models without
a defined precedence and a demonstrated need.

## Where administrators set it

Extend the existing **card visibility / view field settings** surface beside
the source field's filter visibility. A linked-name subrow can expose model A's
Inherit/Show/Hide choice; model B can expose one named reference-exposure choice.
Show the effective source/name result and its inherited origin before saving.
Keep card-value visibility and filter visibility clearly separate in that form.

Use existing administrator rights, validation, save feedback and revision
handling. Hide both is one operation. Explain a locked hiding-everywhere or
unreadable relation using translated text. Live language changes and explicit
light/dark application themes preserve the draft and focus.

## API and migration impact

The existing field-settings read/write API must return the stored choice and
effective visibility for source and names. Results metadata must carry the
source relationship and effective filter visibility on generated displays,
including when the source input is omitted from the filter list. Clients should
not infer a new override from an alias spelling or from card display settings.

Model A requires metadata persistence for virtual fields and its override;
model B adds a validated choice to existing reference-field metadata. Either
requires a versioned schema migration, metadata/API contract updates and cache
invalidation after saves. No such API or migration is part of the current
shared-hiding change.

Reject invalid types, unknown choices and targets that do not belong to the
dataset. Old API writes that omit the choice preserve a saved override. Unset
explicitly restores Inherit. Hiding everywhere must remain authoritative even
if an older client sends Show or Name only.

## Existing-site adoption and saved queries

Initialize existing references to Inherit. This preserves shared hiding and
visible-source redundancy without reviving the former hidden-ID/name substitute.
An administrator who wants that substitute chooses Show or Name only explicitly
for each reference. Avoid site-specific migrations or guesses based on empty
creator/owner values. Changes to available display names are a separate feature.

Saved layouts and opening preferences may retain absent field keys but cannot
recreate controls. Restore URL/state selections against effective visibility:
discard disallowed include, exclude and range conditions, replace the current
address without adding history, and reload remaining conditions from page one.
Do not transfer an ID condition to a name condition; they select different
values. Previously discarded conditions are not revived on making a field
visible. Preserve unrelated filters, search, sorting and view choice.

## Verification contract

- Shared baseline: hidden source hides all names; visible source preserves
  duplicate suppression; datasets without generated names stay unchanged.
- Every supported exposure choice, explicit override, unset and missing value;
  multiple generated displays, renamed fields and changed relation targets.
- Hard hiding everywhere, unreadable targets and administrator access checks.
- API validation, old-client omission, revisions, save failures and migration
  replay without overwriting authored settings.
- Legacy, accordion and inline-open inputs; persistent panels; saved layouts;
  URL, history and state restore; include/exclude/range keys and active chips.
- Correct first-page counts and pagination after discarding hidden conditions,
  including text searches and delayed obsolete responses.
- Browser proofs in Finnish/English and explicit application light/dark themes
  over the opposite OS preference. Restore every changed setting exactly.
