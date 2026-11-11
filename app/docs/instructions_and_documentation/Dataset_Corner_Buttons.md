<!-- Dataset_Corner_Buttons.md
Describes dataset-local show/hide button ownership without changing panel behavior.
Connects the filterbar builder and corner-control helper with UI verification.
Keeps corner placement and modal scope explicit for future maintenance. -->

# Dataset corner buttons

The active dataset toolbar uses the existing menu and filter toggles. Whenever the
toolbar is visible both toggles stay in it, can open or close their panel, and
report its current state with `aria-expanded`. The corresponding floating and
panel controls are hidden and removed from keyboard navigation.

| Surface | Toolbar and navigation |
| --- | --- |
| Inline hero above 700px | The original hero top row moves into the centre, including its horizontal dataset navigation and actions. Whole tabs fit progressively. The hero displays the dataset title and search. |
| Listing below the hero | The same toolbar displays the dataset title and search. The scroll container and toolbar retain their dimensions at the switch. |
| Phone through 700px | Model D retains its 48px toolbar, 52px menu, site or article identity, 44px search toggle and 52px filter toggle. |
| Both vertical panels open in a listing | Each panel supplies its own closer. The original horizontal row returns to the hero. |
| Selected article, including an empty result | The installation's article toolbar keeps its dataset title, search and existing close action. Both panel toggles stay in the visible toolbar. |
| Inactive dataset or Home | The hidden dataset releases its controls to the active surface. |

The single surface-state decision is `resolveDatasetTopbarMode` in
`shared_topbar_builder.js`. It gives an open or selected article precedence over
a retained list. In a listing, the runtime compares the actual inline hero's
bottom with the top of its own scroll container. While the toolbar participates,
the hero row remains mounted in it on both sides of that boundary. Narrow
overlay panels open below the active toolbar so its edge controls remain usable.

## Modal boundary

Image-first, image preview and reusable modal dialogs keep their existing controls. `card_image_modal.js` currently supplies record navigation and close in `image_modal_top_controls`, while `modal_builder.js` supplies the modal focus lifecycle. These modal overlays are above the current navbar and filter toolbar. Adding app-menu buttons there would open panels behind the modal and require a separate layer/focus behavior change, outside the button-only contract. Closing a modal returns to the existing underlying corner buttons.

## Verification

Focused unit coverage checks both panel owners, the transferred hero row, original button action/focus preservation, hidden datasets, ownership release, FI/EN accessible labels, teardown and canonical builder toggles. Existing responsive visibility and temporary filter shortcut tests remain applicable.

`filterbar_menu_history.test.js` also checks Home/dataset Back/Forward and
the same toolbar toggle before and after the hero scroll boundary, with both menu states and
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

`E10_site_identity_and_menu_contract.spec.ts` exercises the open and closed
menu in wide and narrow articles. E15 uses native Chromium input to drag the
real listing scrollbar across the hero threshold in both directions and checks
the full scroll range and toolbar geometry. Its other #999 cases open both
panels in both orders, verify the actual pointer target and keyboard owner, and
activate the original dataset tabs by keyboard and pointer across history.
The standard matrix creates and cleans its long card dataset. A readable
`FILTEREST_E2E_TOPBAR_DATASET` selects an existing long dataset for a read-only
preview with at least two accessible navigation tabs.

## End-control order

The panel button is always last; do not insert controls after it. Keep Home in
its original host: first in the hero dataset-navigation row, in the shared
bar's end slot above 700px. Phones have no top-bar Home button.
Where Home and panel share an end slot, existing Home-prepend/panel-append
placement supplies DOM order; CSS must not reverse it with `order: 10`.
The filter toggle occupies the toolbar end slot in both modes. Home stays in
normal flow in the original 44px row, preserving its direct-child label fitter.
Native Home keeps its first navigation link and has no dataset filter panel.

`dataset_corner_controls.test.js` guards original hosts and panel-last placement
through both arrival orders, resize and retained-host handoffs. The phone CSS
pins guard sizing/reservations and the absence of CSS reordering. G16 covers
390/700/1000/1440px in both themes, top/scroll, resize, history and keyboard order.
It compares row/Home/dataset heights and actual compact outcomes with main's
Home stylesheet, including a long GET-fixtured label in a crowded row. Only the
production fitter changes the compact class. G12/G13 retain their original
placement and phone geometry checks; native browser receipts remain required.

## Phone search and identity (WO129)

Closed search shows the logo and site name in dataset views and on Home; an
article shows the dataset's translated name with the same logo. Long names
end in an ellipsis. Opening search replaces that identity cell with a square
field, using the existing `search` placeholder key and no leading decoration.
K580's exception to K465 applies only to this phone bar field; the dataset's
own search field under it retains its rounding. The field contains clear (⊗)
and submit (magnifier); the adjacent crossed-out magnifier closes it without
clearing the draft or committed search. Dataset/article clear visibility still
comes from `hasCommittedDatasetSearch`.

Home previously destroyed its typed draft on close and had no clear action.
It now retains the draft for the mounted Home visit, has a clear action whenever
there is text, and reopens with that text. Its same toggle moves into the modal
subtree while open, preserving its cell and focus/history behavior. The removed
separate × close no longer covers the magnifier. Only actual results paint the
results box; the live search status stays outside it. Views above 700px and the
menu drawer retain their existing behavior. Batch 356's record bar hides the
shared bar's article close at every width (`row_article_record_bar.css`).
