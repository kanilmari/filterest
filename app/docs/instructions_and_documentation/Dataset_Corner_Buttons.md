<!-- Dataset_Corner_Buttons.md
Describes dataset-local show/hide button ownership without changing panel behavior.
Connects the filterbar builder and corner-control helper with UI verification.
Keeps corner placement and modal scope explicit for future maintenance. -->

# Dataset corner buttons

The filter toolbar and main menu keep their existing open/close behavior. Only their show-button placement follows the active dataset surface. Their hide buttons remain inside the existing toolbar and navbar.

| Surface | Sidebar opener | Main-menu opener |
| --- | --- | --- |
| Visible inline-hero corner | Hero right slot, to the right of the settings gear | Hero left slot |
| Existing visible dataset shared toolbar | End slot beside the article-close action | Existing start slot before the dataset title |
| Hero corner already scrolled away, or no eligible local host | Original fixed fallback | Original fixed fallback |
| Hidden dataset | Hidden and excluded from tab order | Local copies hidden and excluded from tab order |

The hero sidebar opener keeps the canonical 12px viewport top/right inset, mirroring the main-menu opener at 12px top/left. The hero-local CSS compensates the existing 1px scroll sentinel immediately before the hero; fixed positions remain unchanged. Narrow shared toolbars keep their existing content padding; only the buttons compensate its difference from the canonical 12px inset. While the sidebar opener is present, the settings gear moves one control slot to its left and the cover palette stays centered below the gear. When that opener is absent, the gear and palette return to their original hero positions. These slots add no permanent toolbar or reserved vertical space. When the sidebar is open, its existing hide control remains in the sidebar dock. When the navbar is open, its existing hide control remains in the navbar.

`dataset_corner_controls.js` chooses the active host and moves the same sidebar button, preserving its existing listener. Local main-menu buttons call the existing `toggleNavbarVisibility`. The original global `showMenuButton` remains in its DOM home and is hidden only while an active local menu button owns its place. Dataset teardown releases only its own ownership; it cannot clear another dataset's owner.

A partially visible hero does not own a button whose corner has scrolled outside the scroll viewport. Returning to the hero restores its local buttons. Tab changes and rerendering reuse the same controls, and hidden copies are removed from the tab order. Button titles and accessible names follow the existing language selection lifecycle in Finnish, English, Chinese and Cantonese.

## Modal boundary

Image-first, image preview and reusable modal dialogs keep their existing controls. `card_image_modal.js` currently supplies record navigation and close in `image_modal_top_controls`, while `modal_builder.js` supplies the modal focus lifecycle. These modal overlays are above the current navbar and filter toolbar. Adding app-menu buttons there would open panels behind the modal and require a separate layer/focus behavior change, outside the button-only contract. Closing a modal returns to the existing underlying corner buttons.

## Verification

Focused unit coverage checks host choice, partially scrolled hero corners, original button action/focus preservation, hidden datasets, ownership release, FI/EN accessible labels, teardown and canonical builder toggles. Existing responsive visibility and temporary filter shortcut tests remain applicable.

The native regression checklist includes desktop/mobile, Finnish/English, and explicit light/dark themes opposite the OS theme: hide/show both panels, scroll between hero and shared toolbar, switch active dataset/view, open/cancel settings and image dialogs, and verify that gear, palette and close actions remain reachable. Verify pointer/touch activation, keyboard activation and focus visibility without changing application content. Each verification receipt must distinguish the views actually exercised from source review or unit coverage; this checklist is not a claim that every view was exercised in a particular run.
