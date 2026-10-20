<!-- Describes automated structure checks for modularity and its deviations. -->
<!-- Connects shared libraries and component folders with the test suite. -->
<!-- Keeps deviations visible at the change that introduces them. -->
<!-- Checks source structure, never a library's own bookkeeping. -->

# Modularity and Its Deviations in Tests

## What it makes possible

The automated tests recognise when code bypasses a shared library or component
instead of using it: an icon drawn outside the symbol library, a copied
fragment of a shared helper, or a file placed where the component folder rules
do not allow it. A deviation fails the change that introduces it, instead of
being found later in a cleanup review.

Known deviations stay visible. They are listed explicitly, each with a reason,
so they can be removed one at a time, and new ones cannot be added unnoticed.

## Concepts

- **Shared library:** the single owner of one kind of reusable asset or
  behaviour, such as the symbol library for icons or a shared interface
  component.
- **Modularity rule:** a structural statement that can be checked from the
  source tree alone: which file kinds may exist in which folders, which folder
  owns a kind of asset, and which content forms may appear only inside their
  owning library, such as inline vector drawings or embedded icon path data.
- **Component folder rules:** what a component folder may contain and where its
  scripts, styles, assets and tests belong.
- **Deviation:** a place in the source that breaks a modularity rule.
- **Allow-list:** the reviewed list of accepted deviations. Each entry names its
  location and reason, and it is removed together with the deviation.

## General data model

Each modularity rule names its owning library or folder, the file kinds and
folders it covers, the content forms forbidden outside the owner, and its
allow-list entries. An allow-list entry relates one location to one rule and a
reason.

## Implementation principles

Check structure, never library-internal state. Markers kept by a library
itself, such as "in use" flags or registry counters, describe its bookkeeping,
not where code actually takes its assets and behaviour from; a rule passes or
fails from the source tree alone.

Rules cover file kinds by extension, component folder rules and forbidden
inline copies of shared code or assets. A failure names the file, the broken
rule and the library or component to use instead.

The allow-list only shrinks in ordinary work: adding an entry requires a
stated reason in the same change. Extend the existing structure and boundary
checks instead of adding a parallel checker.
