<!-- Describes one mutation contract for immediate updates across views and tabs. -->
<!-- Connects committed changes with affected records, surfaces and caches. -->
<!-- Keeps replay safe and reads subject to the recipient's current rights. -->
<!-- Extends the ordinary update inventory without repeating its observations. -->

# Immediate Updates

## What it makes possible

A successful change appears at once wherever it matters: the initiating view,
other views, open articles and other tabs. Changing a child image also updates
its parent article and card. Deleting content removes stale representations
instead of allowing an old cache to bring it back.

The [immediate UI update inventory](../instructions_and_documentation/SPA_Immediate_UI_Update_Inventory.md)
owns the current coverage and gaps. This description adds the missing shared
contract rather than another set of local refresh instructions.

## Concepts

- **Mutation identity:** one stable identity shared by the committed write
  result and its later change notification.
- **Affected subject:** a changed record or related parent whose presentation
  must be reconsidered, including the relationship that caused the effect.
- **Affected surface:** a view, article, count, media display or cached setting
  that consumes the changed subject.
- **Reconciliation:** applying a permitted result, clearing a stale cache or
  fetching the affected surface again.

## General data model

A committed mutation relates its identity and change kind to affected datasets,
records, parents and surfaces. Each consumer remembers which mutations it has
applied, allowing the initiating tab and other tabs to handle the same event
without duplicating its effect.

## Implementation principles

Deliver effects only after commit, extending the existing post-commit row
events. Repeated or replayed delivery must be idempotent; reconnection must
recover missed effects or invalidate and refetch affected state. Refetch with
the receiving user's current permissions, never the writer's authority.
Deletion clears stale row, relationship and media caches and closes or replaces
deleted open content. Permission changes invalidate prior access decisions;
a generic data event cannot grant access.
