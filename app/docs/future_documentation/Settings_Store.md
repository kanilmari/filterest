<!-- Describes a common settings home with feature-owned definitions and targets. -->
<!-- Connects existing site settings, row classifications and the shared editor. -->
<!-- Separates setting meaning, stored values and administrator interaction. -->
<!-- Defines a general data contract without choosing a physical table schema. -->

# Central Settings Store

Site settings already have a central home, setting identities and typed values.
Some features already share definitions and validation, and row-group
classification already supports settings. The missing capability is one
consistent definition and target contract across settings, extending those
foundations rather than introducing another site settings store.

## What it makes possible

Settings have one central home while the features using them retain ownership
of their meanings. The default target is the existing site settings. The same
store also supports settings for dynamically selected datasets and views;
a card setting can apply to almost any suitable dataset without creating a
settings table inside each dataset.

This is the storage counterpart of [one settings table template](Settings_Table.md),
which describes editing rather than a new settings store. A shared editing
surface does not decide the setting's meaning, its target or its authority.
[View feature settings](View_Feature_Settings.md) is one consumer of this contract.

## Three roles

**Definition.** The feature that consumes a setting owns its single authoritative
definition: identity, meaning, value schema, default, constraints, category and
supported target scopes. Reusing an editor or selecting another dataset does
not create another definition.

**Value.** The central store holds an explicit value keyed by the setting's
identity and exact target. A dataset or variant is a target, not a separate
settings store. Definitions determine any inheritance and precedence between
applicable targets, including how absence differs from an explicit value.

**Editing.** The shared template presents those definitions and values in the
feature's management place. It supplies the common interaction while the
feature owns supported targets, validation and permission to change them.
Dynamic dataset selection changes the target of the draft, not the definition
or the dataset's own business data.

## General data model

Every setting has an exact, documented logical schema. A value kind alone is
not enough: structured values describe their required parts and constraints
just as precisely as a boolean, number or named choice.

| Concept | Information and relationships |
| --- | --- |
| Setting definition | Stable identity, owning feature, meaning, value type and complete value shape, default, valid range or allowed choices, category and supported target scopes. |
| Target | Exactly one scope: the site, a dataset, a view family, a view variant, or a dataset plus variant. Non-site targets carry the stable identities needed to identify that scope. |
| Stored value | Setting identity, exact target and explicit value conforming to the definition; one authoritative value for that setting and target. |
| Effective value | The result of the definition's declared default and override rules, with the origin available to the editor and consuming feature. |
| Category | Existing multilingual row-group classification attached to settings; organizes discovery without changing values or target scopes. |

Categories grow with the settings collection using the existing
[row-group classification model](../instructions_and_documentation/Dictionary.md#tables).
Selecting a category only filters which settings are shown: it never enables
a feature, changes a saved value or grants access. Category growth does not
require a separate settings store for each category. The shared template's
visual row groups can organize the editor without replacing these stored
classifications.

## Implementation principles

- Validate every stored value and its target against the owning definition,
  including writes outside the shared editor. Keep one definition authoritative
  for editing and consumption rather than copying rules between them.
- An unreadable or invalid stored value falls back to the definition's default,
  or fails closed where the feature requires that protection. Failure never
  silently enables a capability or relaxes authorization.
- Extend existing site storage and feature validators into the common contract;
  preserve existing values and meanings when adopting it. The physical table
  definition, storage layout and migrations belong to implementation work.
