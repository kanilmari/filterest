# Filterest 9.6.4

Release date: 2026-11-11. Contains the two commits since 9.6.3.

## Database and rollback

The database moves from **9.13.5 to 9.13.6** on the first start of 9.6.4.
The minimum and target are both **9.13.6**. The database release comprises
three SQL files: the row-opening presentation policy, localized controls, and
one database release record. The controls let administrators set how rows open
for the site or a dataset and let visitors return to the default. Existing
nonblank translations are preserved. With no setting, rows open as before;
existing dataset overrides are preserved and no site-wide backfill is needed.

Before upgrading, keep a reviewed backup of the **9.13.5 database**. A rollback
to **9.6.3 requires restoring that database from the reviewed backup** under a
write freeze; database changes made after the backup will be lost. Returning
to the earlier application also removes the new row-opening controls and
restores its earlier opening behaviour.

## Field order

The field order saved in the field editor survives application startup and
catalogue refreshes. Renaming a field keeps its place. New fields follow the
saved fields in creation order, including in the add-row form.

## Dataset toolbar

The dataset toolbar stays stable between the original hero tabs and the
listing's title and search. Menu and filter controls follow the visible
toolbar in both states.

## Home and dataset navigation

Navigation buttons centre on the full toolbar when space permits, keeping at
least 20 px clear of nearby edge controls. Home's side menu uses rectangular
buttons and its top controls align with the Home toolbar. The sliding overlay
keeps its edge while its outer shadow fades. Menu controls and environment
badges have flat surfaces without shadows.

## Dataset loading

A rate-limited dataset-list request retries at most four times with growing
delays. A server-requested wait is capped at 30 minutes and the waiting period
survives a reload in the same tab. Recovery opens the requested view only while
the visitor is still on that visit; it cannot replace a newer navigation.

## Related items

Articles with many incoming relations open their related items faster. Each
child table's column query reads its foreign-key metadata once. Composite keys
use their declared column pairs. When a field has several targets, related
items prefer the shortest key, breaking ties by target table and column name.
This can change which target appears where several relations share a field.

## Closing articles

Closing an article returns to the card list it was opened from, including after
switching to another record from the article's list.

## Row-opening presentation

Administrators can choose **Open rows as** in the appearance palette under
**Article**, for all datasets or one dataset: Article, Image-first article or
Page-sized image-first article. An explicit link or history entry chooses the
presentation for that opening. Otherwise the visitor's own choice for the
dataset in this tab takes precedence, then the dataset override, then the site
default. Removing a dataset override restores inheritance. Saving the same
value as the site default pins it for that dataset, even if the site changes.

The view picker's **Use default** removes the tab's preference. Reloading the
same tab retains a choice only for the same verified user. Another account or
a guest cannot inherit it. Verification uses existing startup responses,
without another request; retained choices wait for identity confirmation.
The dataset's listing view remains a separate setting. Clicking an ordinary
card photo still opens the image viewer.

Home article buttons without an explicit presentation now inherit these
choices; explicitly configured Article or Page buttons keep their choice.
Existing Article and Page permissions still apply, including to inherited
Home buttons, row contents and media. Ordinary foreign-key links remain usable
when a row presentation is unavailable. An image-first article without
permitted photos opens as text only.

Classic article openings keep their request guard while rebuilding the list
and loading the article. Home, search and related-row links finish dataset
navigation before opening the requested row, only while the original request
is current and that dataset is selected. A newer request prevents the old
article from opening. These handoffs cannot automatically open the first
result instead; ordinary Article visits still open their first result.
Closing an image-first article also leaves its image arrows usable on reopening.

API clients that need the new appearance field must send
`X-Filterest-Appearance: row-presentation`. Requests without it retain the
previous appearance response shape and revision tokens. Updates to other
appearance fields preserve the row-opening setting. Shared caches must honour
`Vary: X-Filterest-Appearance` on these responses.
