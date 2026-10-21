# Filterest 9.5.1

This patch includes all eight commits on main after 9.5.0. The database stays
at 9.12.0, with minimum and target both 9.12.0. Upgrading from 9.5.0 runs no
migration and adds no database release record.

## Page image-first pilot

A row can open as a page-sized image-first article, with its whole image
contained at a moderate size inside the text column and the text following it.
Rows without an image show text alone. Page uses the shared article history:
Back, Forward, close and Escape return to or reopen the same context.

**The Page pilot is opt-in:** nothing changes until an administrator saves a
Home article button with the Page view, or a direct
`?view=image_first_page_view` row link is used. Ordinary article openers and
Home button defaults keep their existing presentation. The required view right
is `/ui/view/image_first_page_view` in the catalogue's scope, plus the dataset's
get-results right. The current catalogue entry is tableless, so the Page view
right is global; the get-results right retains the dataset boundary. These
checks also apply when the server returns the row.

**Rollback:** 9.5.0's strict reader rejects a stored Home article button `view`
field and hides all Home article buttons. Before rolling back to 9.5.0,
re-save the buttons without Page, removing the `view` field.

## Phone layout: Home, headers and articles

On phones (widths at or below 700 px), Home fills its stacked navigation row.
The top bar places Home beside the menu, whose button has a complete border.
Activating Home closes an overlay menu, as a dataset tab does.

Dataset headings have tighter spacing. **Phones (≤ 700 px): the cover hero no
longer adds the administrator's "hero extra height"; the owner asked for tighter
phone spacing.**

Ordinary articles lose their outer frame and excess title/image spacing.
Article and image-first previous/next record controls become compact 44 px
icons without thumbnails. All three article presentations put detail names
above their values. Revealed disabled image arrows dim; hidden arrows stay
hidden. These article layout changes apply through 700 px; tablet and desktop
article layouts retain their existing behavior.

Disabled Back and Forward buttons in the side menu now use the normal cursor
instead of the "not allowed" cursor, at all screen sizes.

## Home slogan

With Home's Serif story style, slogans up to 40 Unicode code points remain an
italic title accent. Longer slogans appear below the title as a smaller italic
lead paragraph, outside the line reveal, followed by the story lines. Finnish
and English palette guidance explains this rule. The default text style stays
unchanged.

## Documentation

The dataset appearance guide explains which settings belong to one tab, to the
whole site or to a site default that a tab can override. It covers resolution,
palette scopes, drafts, permissions, refusals and revision-protected storage;
related frontend guides now agree with it.

The developer guide asks maintainers to compare implementations and combine
their best parts before merging them. A future document describes proposed
modularity checks based on source structure and reviewed exceptions. These
changes are documentation only; the proposed checks are not a new shipped tool.

## Release tooling

Operators can prepare read-only BEFORE/AFTER reports of article-presentation
settings from database copies, compare every difference, and give the owner a
value-free difference list for approval. An offline SHA-256 approval gate binds
approval to the exact detailed difference file and rejects unapproved or missing
differences on a later comparison. These commands do not change a database or
start the application; they do not change visitors' articles by themselves.
