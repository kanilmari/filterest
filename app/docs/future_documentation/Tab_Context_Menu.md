<!-- Describes explicit dataset actions on a navigation tab. -->
<!-- Connects a tab's dataset with its place in the existing database tree. -->
<!-- Keeps ordinary tab activation separate from opening the tree. -->
<!-- Reuses accessible product menu behavior without a second navigation tree. -->

# Tab Context Menu

## What it makes possible

A dataset tab offers a context menu with an action to reveal that dataset in
the database tree. A person can locate a tab's dataset in its folder context
without having the tree open automatically during ordinary tab use.

Right-click opens the menu. A keyboard route or equivalent visible control
provides the same actions. A plain click continues to open the tab alone;
revealing it in the tree is a separate, deliberate action.

## Concepts

- **Dataset tab:** a navigation entry associated with one dataset.
- **Tab context menu:** actions applying to the dataset represented by that tab.
- **Reveal in tree:** opening the existing database tree and necessary ancestor
  branches, then bringing the authorized dataset entry into view.

## Implementation principles

Reuse the product's existing context-menu pattern, including focus, dismissal,
keyboard access, translated labels and both application themes. Resolve the
dataset through its existing identity and tree entry; do not construct a
second tree. The action respects current tree and dataset permissions and
explains when the target is unavailable.
