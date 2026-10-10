<!-- Card_Style_Presentation.md -->
<!-- Defines the site card style and nullable dataset override. -->
<!-- Connects the appearance palette, card visibility editor and one card renderer. -->
<!-- Keeps persistence, inheritance and preview behavior explicit across installations. -->

# Card styles

Filterest has one ordinary card view with two presentation styles: **Glowy**
and **Plain**. The service catalog uses this same renderer, selection and article
opening path. Its moderation controls do not define another card view.

Open the appearance palette from a dataset hero. Every opening selects
**This tab** (Tämä välilehti) first in the native scope radio group:

- **This tab** shows the tab's cover/background first, then the nine card,
  article and header settings that may override site defaults. Their badges
  distinguish **Site default** from **Override**. **Use site default** stages
  removal until **Save this tab**; equality, zero and false remain explicit.
  The seven site-wide rows appear last, with readable saved values and an
  authorized action to switch to **All datasets**.
- **All datasets** edits the nine defaults and the seven site-wide settings.
  It has no cover controls. **Save all datasets** patches this scope alone.
  Existing card-control rights remain required; a missing site right leaves
  values readable, explains the limitation and disables editing/Save.

The same controls and renderer apply to every ordinary dataset. Changing the
site default never silently clears dataset overrides. Tab media/header and
card-field actions reuse the existing editors and their separate save flows.
The field editor preselects this dataset in its existing tree before the tree's
delayed selection notification. Its save keeps both revision checks, and closing
the editor leaves the palette's appearance draft in place.
On phones, both editor entry points stack the dataset tree above the fields.
The tree has its own bounded scroll area; the modal sheet scrolls vertically
and wide field tables scroll horizontally without moving Edit or Save off-screen.

| Scope | Authoritative storage | Default / inheritance |
| --- | --- | --- |
| Site style | `system_config.json_value`, key `dataset_cover_theme_config`, map `defaults`, key `shared.card_style_variant` | `modern` (Glowy); `standard` means Plain |
| Site card field wrapping | Same JSON row, map `defaults`, key `shared.label_value_layout` | `stacked`; `inline`, or development-only `auto` |
| Site columns | Same JSON row, map `defaults`, key `shared.card_detail_columns` | 2; integer 1–4 |
| Dataset style | `system_dataset_appearance.overrides`, key `shared.card_style_variant` | Absent key inherits the site |
| Dataset columns | `system_dataset_appearance.overrides`, key `shared.card_detail_columns` | Absent key inherits the site |

The version-two public API exposes seven `site_values` and nine `defaults`;
cover values belong to each dataset and are excluded. These site
choices are shared by light and dark themes. Browser metadata is a projection
of these server settings, not another authority. Unsaved preview values remain
owned by the mounted palette and are not written to the database.

The dataset palette saves through administrator `POST /api/admin/dataset-appearance`
with `{schema_version:2,dataset_uid,tab_set,set,unset,shared_version,version}`.
The complete 28-value cover belongs to `tab_values`; `tab_set` patches it
without inheritance. `set` and `unset` support only the nine default overrides. The existing card API
continues to accept nullable style/count fields, but now requires both loaded
revisions and projects nullable read fields from the override map. The complete
card editor and generic metadata writes use the same revision-protected saver.
Omitted fields are preserved; explicit null unsets a compatibility override.
Missing/stale revisions receive translated 409 refusals and retain the draft.
The physical style/count columns and their editable metadata are retired.

Site saves require their loaded `version`. Every shared and dataset writer uses
one shared-before-dataset lock order, including the absent shared-row case.
A site save patches only the sixteen site-owned values and preserves omitted
settings, including article timestamps. Authorized results carry the complete
version-two appearance snapshot without another browser request. Each tab
validates both themes' mask ordering before saving; site saves cannot change
a cover or invalidate another tab's masks.

Every response that can carry or apply appearance keeps the guard captured
before its request, including chat jobs, search streams, related-row loads and
retained-row transfers. Sign-out, deletion or registry ownership changes discard
stale work. The first tree discovery may confirm an already authorized result's
UID during assembly without cancelling it; a different UID or intervening
registry change still discards that work. Current registry metadata resolves
names; mounted surfaces keep their own immutable UID across rename and
former-name reuse. A rejected
snapshot stops rendering before it can bind another dataset's settings.
Related rows retain their separate read permission: an omitted appearance
snapshot means failed authorization revalidation, so the dataset's saved
snapshot and draft are forgotten across the page. Connected and detached
surfaces clear private adapter projections before repainting with site defaults.
An omitted or rejected response binds its panel and rows to public defaults
without a name or UID fallback, including lazy loads and forced reloads.
The original request guard still protects row assembly. Dispatch order prevents
an older response from restoring revoked appearance or erasing a newer success;
a later successful revalidation can install the snapshot and authorize its
surface again.
If a URL search starts before its card host is assembled, its listing reload
uses the guarded view refresh and consumes that refresh's first page. This also
handles a saved sort arriving during assembly, without missing result controls
or fetching the rebuilt first page again.
Pagination cannot append replacement rows to a surface owned by the renamed
dataset, and palette teardown releases the draft's original UID after name reuse.

Tab and site drafts are independent. Switching scope preserves both and
previews only the selected draft. Reset restores that scope's saved values;
Close keeps the selected preview, and teardown releases only its owner.
Pending saves preserve newer edits and adopt their successfully saved revision.
A known local site save updates a matching tab token; conflicts keep drafts and
loaded tokens for review. Scope, Close and Save/Reset remain outside the
scrolling controls, including on phones. FI/EN changes retain focus and drafts.

Database 9.10.2 migrates every non-null legacy style/count as an explicit
override, including values equal to the shared choice. Null remains inherited;
replaying the migration never replaces an already migrated override. The older
9.7.15 transition to the glowy default happened before this cutover.

A style or count preview updates only normal cards. A dataset preview updates
only that dataset; a site preview updates only the effective inherited settings. The connected outer card, media,
checkbox, selection and history anchor remain intact. The card's owned field
groups are rendered again for the effective style and existing empty-field
setting. Article bodies and article-side compact cards are not restyled by a
site preview. Their existing explicit dataset style remains supported.

The outer card owns the only broad background surface. Plain uses its opaque
theme surface; Glowy uses 80% opacity and a 12px backdrop blur. Card content,
description, keyword containers and detail panels add no second broad fill or
gradient. Text stays fully opaque and sharp.
Borders, icon backgrounds, keyword chips, selection states and photo contrast
treatments remain distinct UI elements. The card reveals 20% of the page
background as already composed; it does not override the dataset image's own
separate fade. Local compact-summary states retain their own selection treatment.
Keyword chips, on cards in both styles and in the article view, take one theme
token, `--keyword_label_bg_color` in `styles/variables.css`: a neutral lift with
its own light and dark value, so a chip stands apart from the white or
near-black card surface. In Glowy the description text is centred vertically
against its icon, whether it has one line or several.
These are fixed style values, not additional palette settings. Card image
presentation, field visibility, translated values, URL/view selection and navigation remain separate
settings and behaviors.

The effective **Detail columns** value limits the detail grid in both Glowy
and Plain cards; a narrower detail panel automatically uses fewer columns
(240px per column). Requested counts of 3 or 4 may expand the card's existing
text-area width cap within the available space; the default two-column width
and article widths stay unchanged. Entries retain their column-first order.
Glowy keeps its complete panel frame and visible separator lines, including
when there are no keywords.
Glowy and single-line Plain details resize through CSS. Other Plain layouts use
the existing key/value renderer with the same column limit and 240px minimum.
Outer cards, media, selection and history anchors stay intact. Article-side
compact summaries retain their existing layouts. Legacy
site settings requests that omit the count preserve the latest stored count
within the existing save transaction. Dataset null inherits; fractional and
out-of-range counts are invalid in both scopes. The setting does not hide fields or change stored row values.

Card and inline article media use one 1px frame around the media box, preserving
the selected contain/cover behavior and image dimensions. This frame is separate
from the article's outer container, whose side borders remain while its top and
bottom borders are removed. Gallery selection borders retain their own meaning.

## Card field wrapping defaults and dataset choices

The **Card layout** block in either scope offers **Stacked** (Allekkain)
and **Side by side** (Rinnakkain). Stacked is the default for missing or unknown
values. **Automatic** (Automaattinen) is available only when the server runs
in development mode, using the same boundary as the experimental card.
Production rejects saving Automatic and reads an older stored Automatic as Stacked.
This is one of the nine overridable defaults: a dataset can retain an explicit
wrapping choice through its appearance endpoint, or remove it to inherit.

Every ordinary label/value pair follows this choice in Glowy and Plain result
cards, every Plain detail layout, and the experimental free-layout card.
Card field labels have no added colon in either arrangement or any detail layout.
Inline keeps the label in the left 40% area and
the value in the right 60% area even on narrow screens. Stacked puts the value
below the label across the full pair width. Automatic retains the shared
flex-wrap behavior with a 16ch value basis; no further smart measurement is used.
Hidden labels stay hidden and label-free pairs use the full width. Result cards
keep their two-line value preview, including related-record links.
The card preview cap takes precedence over the shared value
display reset. Link text participates in the capped lines, with its separate
new-tab icon at the end and both links retaining their keyboard focus targets.

Opened and Image First articles keep their existing article layout independently
of this choice. Detail labels and values start on the same row, with the label's
fixed width and long values wrapping in their own column. Hidden labels stay
hidden and articles show the complete value. Article-only pair builders do not
use the card layout adapter, so saved choices and live palette previews leave
article pairs untouched.

The shared adapter owns placement, separately from field visibility, typography
and card surfaces. Style-specific placement overrides, the 720px tile placement
switch, the 400px pair-mode switch and Canvas value dropping no longer decide
where the value starts. Responsive numbers of detail columns still work.

The same preview/save/reset owner used by other site settings updates connected
card pairs in place. New card pairs read the current site choice. Database
9.10.0 removes the obsolete `system_column_details.label_value_layout` column,
including its CHECK and comment. The card visibility API and result metadata
no longer return that field; the site JSON path remains the wrapping authority.
Served bundles must come from the release build that contains this change.
The complete-column visibility API follows its existing unknown-member policy:
an old request containing `label_value_layout` ignores that member, including
its former values or types, and saves the supported visibility fields normally.
Scoped dataset presentation saves retain their strict unknown-member validation.

Old `system_column_details` CSV exports can still be restored: the importer skips
only this table's retired layout header and its matching cells through its
documented `retiredCSVColumns` list. Other columns and tables retain normal
validation; new exports follow the physical schema. Label visibility, including
raw nullable `show_key_on_card_override`, still saves and verifies readback.
Visibility save failures use the existing translated `save_failed` key. The
site selector retains `label_value_layout` and its `auto`, `inline`, and `stacked`
keys. Retired `inherit`, `help`, and `readback_failed` keys and translations are
preserved: stale code sources expire after seven days, then orphan marking and
the 90-day archive window follow [the language-key lifecycle](lang_key_lifecycle.md).
