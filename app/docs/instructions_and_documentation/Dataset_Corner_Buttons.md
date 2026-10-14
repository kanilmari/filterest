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

On phones (up to 700px), the shared toolbar stays present in both card and
article views. Opening the navbar hides and releases the local menu opener;
the navbar's own closer is the only announced, focusable menu control at every
width. Closing it returns ownership to the local opener. Its `aria-expanded`
still follows the navbar state. The floating fallback stays hidden while a
local opener owns the menu. A visible card
hero owns its opener even when no shared toolbar is visible; absence of that
toolbar alone does not imply that the floating fallback should appear.

The hero sidebar opener keeps the canonical 12px viewport top/right inset, mirroring the main-menu opener at 12px top/left. The hero-local CSS compensates the existing 1px scroll sentinel immediately before the hero; fixed positions remain unchanged. Narrow shared toolbars keep their existing content padding; only the buttons compensate its difference from the canonical 12px inset. While the sidebar opener is present, the settings gear moves one control slot to its left and the cover palette stays centered below the gear. When that opener is absent, the gear and palette return to their original hero positions. These slots add no permanent toolbar or reserved vertical space. When the sidebar is open, its existing hide control remains in the sidebar dock. When the navbar is open, its existing hide control remains in the navbar.

`dataset_corner_controls.js` chooses the active host and moves the same sidebar button, preserving its existing listener. Local main-menu buttons call the existing `toggleNavbarVisibility`. The original global `showMenuButton` remains in its DOM home and is hidden only while an active local menu button owns its place. Dataset teardown releases only its own ownership; it cannot clear another dataset's owner.

A partially visible hero does not own a button whose corner has scrolled outside the scroll viewport. Returning to the hero restores its local buttons. Tab changes and rerendering reuse the same controls, and hidden copies are removed from the tab order. Button titles and accessible names follow the existing language selection lifecycle in Finnish, English, Chinese and Cantonese.

When a menu control owns keyboard focus, ownership changes hand it to the
incoming visible opener, or to the navbar closer while the menu is open.
Unrelated focus is left alone. The shared toolbar captures menu-focus intent
through `dataset_corner_controls.js` before changing its own accessibility;
the same synchronous corner reconciliation consumes it after the incoming
controls become accessible. This also covers a restored hero scroll position
hiding the toolbar just after Back/Forward returned focus to its opener.
The handoff requires no timer or retained focus state.

The shared toolbar's released menu button becomes visually hidden immediately
when its own `aria-hidden` changes to `true`. Its slot and the toolbar can
continue shrinking and fading for 260 ms; their delayed CSS visibility must
never keep the former menu owner painted beside the incoming control. The
shell opener and closer likewise hide immediately on release, including while
the navbar's children fade during its slide-out. Ownership and the incoming
CSS reveal start in the same task; no deferred reveal or focus intent remains.

On phone Home (through 700px), the open menu overlays Home from the viewport
top, with its height bounded by the dynamic viewport. Its own scroll area
reveals the remaining controls while the sticky top row keeps its closer,
history, theme and language controls reachable. Home's dataset count cannot
push that row below the screen. The borrowed Home slot stays hidden and inert
without leaving an identity gap; closing restores it and its existing focus
handoff. The language panel remains outside the menu's scrolling/clipping area.
Tablet and desktop placement, and dataset-page layouts, retain their rules.

## Modal boundary

Image-first, image preview and reusable modal dialogs keep their existing controls. `card_image_modal.js` currently supplies record navigation and close in `image_modal_top_controls`, while `modal_builder.js` supplies the modal focus lifecycle. These modal overlays are above the current navbar and filter toolbar. Adding app-menu buttons there would open panels behind the modal and require a separate layer/focus behavior change, outside the button-only contract. Closing a modal returns to the existing underlying corner buttons.

## Verification

Focused unit coverage checks host choice, partially scrolled hero corners, original button action/focus preservation, hidden datasets, ownership release, FI/EN accessible labels, teardown and canonical builder toggles. Existing responsive visibility and temporary filter shortcut tests remain applicable.

`filterbar_menu_history.test.js` also checks Home/dataset Back/Forward and
shared-toolbar/fallback/hero scroll handoffs, with both menu states and
unrelated focus. It focuses the outgoing control before navigation and checks
each incoming control without supplying focus after the transition.
It also loads the actual toolbar CSS and samples the existing transition
deadline. The CSS regressions supply intermediate ancestor visibility/opacity
because jsdom does not interpolate animations. G11 samples rendered frames
and completed DOM mutation batches across Home/dataset Back/Forward handoffs,
and checks both settled Home menu states. It checks viewport/clipping/opacity,
pointer access, tab order and accessibility; an earlier ownership-transition
failure remains recorded after the transition settles. Every frame permits
at most one painted control and one announced, focusable owner, with no painted
aria-hidden copy. An empty frame is allowed only when `getAnimations()` reports
a running animation on that announced owner or an ancestor (its fade or panel
slide). Paused, finished and unrelated animations cannot excuse an empty frame.
Idle frames and every focus assertion require exactly one painted, on-screen,
announced, focusable, pointer-accessible owner. Sampler negative controls reject
the former two-painted-buttons state, two announced owners even when one is
offscreen, and static empty frames.
The 12-dataset response fixtures also check every rendered menu control after
internal scrolling, sticky-row pointer access, the separate language panel and
pointer closing at 320×568, 375×667 and 414×896 in light and dark themes.
Destination geometry uses a fixed catalogue rather than the native dataset count.

`E10_site_identity_and_menu_contract.spec.ts` verifies real clicks on the wide
article opener, the persistent phone article opener and navbar closer, and the
card hero opener. It checks the hidden fallback's accessibility state as well
as the active controls, after startup and saved filterbar layout have settled.

The native regression checklist includes desktop/mobile, Finnish/English, and explicit light/dark themes opposite the OS theme: hide/show both panels, scroll between hero and shared toolbar, switch active dataset/view, open/cancel settings and image dialogs, and verify that gear, palette and close actions remain reachable. Verify pointer/touch activation, keyboard activation and focus visibility without changing application content. Each verification receipt must distinguish the views actually exercised from source review or unit coverage; this checklist is not a claim that every view was exercised in a particular run.
