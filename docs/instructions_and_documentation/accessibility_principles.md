<!--
accessibility_principles.md
Defines the durable accessibility baseline for Easelect UI work.
Explains the minimum expectations contributors should follow when building or changing frontend features.
Keeps recurring accessibility rules in stable documentation instead of repeating them in tickets.
-->
# Accessibility Principles

This document defines the practical accessibility baseline for Easelect.
Use it when building or reviewing frontend work that creates, edits, or removes UI behavior.

## 1. Scope

These principles are the default minimum expectations for:
- server-rendered HTML
- JavaScript-built UI
- reusable frontend components
- modal, menu, dropdown, and card/table interactions

This is a project baseline, not a claim that every existing surface already meets it perfectly.
Feature-specific gaps should be tracked as focused tickets or audit findings.

## 2. Core Rules

### Semantic HTML First

- Prefer native HTML elements before recreating controls with generic `div`/`span` elements.
- Use real buttons for button behavior, real links for navigation, real headings for section structure, and real lists for list-like groups.
- Add ARIA only when native semantics do not already solve the problem.

### Keyboard Accessibility

- Every interactive element must be reachable and operable with a keyboard.
- Focus must remain visible.
- Keyboard users must be able to activate primary flows without relying on pointer-only behavior.
- If a component opens additional UI, the user must be able to close it without using a mouse.

### Labels And Names

- Form controls must have an accessible name.
- Prefer a visible `<label>` tied to the control.
- Use `aria-label` only when a visible label is not appropriate.
- Icon-only buttons must still have a clear accessible name.

### Images And Icons

- Informative images need meaningful `alt` text.
- Decorative images should use empty `alt=""` or be hidden from assistive tech when appropriate.
- Icons that are purely decorative should not create noise for screen readers.

### Focus Management

- When opening modals, overlays, or other transient UI, move focus into the active surface.
- When closing that surface, return focus to a sensible trigger or fallback target.
- Avoid focus traps unless the UI is intentionally modal.

### Dynamic Updates

- Important status changes, confirmations, or dismissible notices should be exposed in a way that assistive technologies can detect.
- Use live regions only for meaningful updates; avoid over-announcing noisy state changes.

### Color And Contrast

- Maintain readable contrast for text, icons, focus outlines, and state indicators.
- Reuse shared design tokens or CSS variables instead of hardcoding ad hoc colors.
- Do not make meaning depend on color alone when a text or structural cue can also be provided.

## 3. Practical Checklist

When changing a frontend feature, verify at least these:

1. Can the main interaction path be completed using keyboard only?
2. Does every interactive control have a clear accessible name?
3. Are visible labels, instructions, and error states understandable without guessing?
4. If a modal/menu/dropdown opens, does focus behave predictably?
5. If images or icons convey meaning, is that meaning available without sight?
6. If state is shown by color, is there another cue as well?

## 4. Canonical Homes

Use these documents together:

- `Frontend_Guide.md`
  - frontend architecture and broader UI conventions
- `DEV_GUIDE.md`
  - contributor workflow, QA, and project-wide implementation rules
- this document
  - durable accessibility baseline

Tickets should carry only:
- concrete accessibility bugs
- feature-specific audit findings
- residual implementation gaps

They should not be the long-term home for the baseline itself.
