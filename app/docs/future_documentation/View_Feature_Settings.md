<!-- Describes family-owned special features and their presentation values. -->
<!-- Connects view families, target settings and the shared administrator editor. -->
<!-- Extends existing card choices without mixing presentation and authorization. -->
<!-- Leaves field permissions and article section behavior with their owning guides. -->

# View Feature Settings

Card management already offers Glowy, Plain and Site default, with a dataset
override of the site choice. [Card style presentation](../instructions_and_documentation/Card_Style_Presentation.md)
owns that existing behavior. It is the starting point for family-owned feature
sets, an article-family set and values specific to a view variant.

## What it makes possible

Each view family owns the special presentation features of its variants and
offers them in its own management place. Cards and articles can have different
features and choices while using [one settings table template](Settings_Table.md).
The editor derives available choices from the family's feature definitions
where dynamic choices are useful, rather than imposing one fixed set on every
kind of view.

The article family's management covers Article, Image First Article and Image
First Article with a medium image, the page-sized presentation. Its feature
set need not match the cards' set. [Image-first article sections](Image_First_Sections.md)
owns the planned section capabilities and independent initial opening choices;
the feature editor does not redefine their meanings.

## Concepts

**View family.** A group of related presentations with one owner for their
special features, such as cards or the article family.

**View variant.** One presentation within a family. Variants share the family's
feature vocabulary but can support different features or choices.

**Feature set.** The named special features owned by a family, together with
their meanings, supported variants, value kinds and allowed choices. Card glow
is an existing example of a feature; the set gives such choices a common
family-owned description.

**Feature value.** A choice for one feature and target. A site default can
have dataset overrides and, where needed, values for a variant or a dataset
and variant together. The family defines supported targets and how applicable
values resolve; a variant-specific value is not required for every feature.
The editor distinguishes an explicit choice from inheritance and shows the
effective value and its origin.

## Boundaries and editing

Feature values control presentation, never authorization. They are independent
of [field permissions](Field_Permissions.md): showing, hiding or highlighting a
field neither grants nor removes permission to read, insert or edit it.
Every presentation remains within the reader's effective rights.

When a feature needs a field, such as the field driving a highlight, its
**value is a field reference** within the selected dataset. That reference is
still a presentation value, not a permission. The feature set is not a per-field
link table between view variants and fields, even for such a feature.

Cards are edited in card management; the article family has its own management
place. Both use the shared template with their own features, supported choices
and target context. Selecting another dataset changes the settings target;
it does not create another feature definition or another editor.

## General data model

| Concept | Information and relationships |
| --- | --- |
| Family | Stable identity, owned feature set and member variants. |
| Variant | Stable identity within a family and the features it supports. |
| Feature | Stable identity within its family, meaning, value kind, default, allowed choices and supported targets. |
| Feature value | Feature identity, exact target and explicit value; the value can be a field reference when the feature requires it. |
| Effective value | The resolved presentation choice and its origin under the family's declared inheritance rules. |

## Implementation principles

Extend existing presentation settings and card management rather than adding
a second authority for the existing card choice. Keep feature definitions with
their owning family and validate values, targets and field references against
them. Reuse the shared editor's draft and save contract. Keep authorization
independent, controls translated and behavior usable in both application themes.
