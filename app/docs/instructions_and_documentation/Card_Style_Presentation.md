<!-- Card_Style_Presentation.md -->
<!-- Defines the site card style and nullable dataset override. -->
<!-- Connects the appearance palette, card visibility editor and one card renderer. -->
<!-- Keeps persistence, inheritance and preview behavior explicit across installations. -->

# Card styles

Filterest has one ordinary card view with two presentation styles: **Glowy**
and **Plain**. The service catalog uses this same renderer, selection and article
opening path. Its moderation controls do not define another card view.

Open the appearance palette from a dataset hero. The **Card layout** block
contains two explicitly separate groups:

- **This dataset**: choose **Site default**, **Glowy**, or **Plain**, and a
  nullable maximum of one to four detail columns. **Save dataset settings**
  saves only those two overrides.
- **Site defaults**: select the style and maximum detail columns inherited by
  datasets. **Save site defaults** saves these with the other site appearance
  settings, including both themes. It does not save an unsaved dataset draft.

The same controls and renderer apply to every ordinary dataset. A dataset with
an explicit style or count keeps that choice until an administrator changes it
or selects **Site default**. Changing the site default never silently clears
dataset overrides.

| Scope | Authoritative storage | Default / inheritance |
| --- | --- | --- |
| Site style | `system_config.json_value`, key `dataset_cover_theme_config`, path `shared.card_style_variant` | `modern` (Glowy); `standard` means Plain |
| Site card field wrapping | Same JSON row, path `shared.label_value_layout` | `stacked`; `inline`, or development-only `auto` |
| Site columns | Same JSON row, path `shared.card_detail_columns` | 2; integer 1–4 |
| Dataset style | `system_dataset_appearance.overrides`, key `shared.card_style_variant` | Absent key inherits the site |
| Dataset columns | `system_dataset_appearance.overrides`, key `shared.card_detail_columns` | Absent key inherits the site |

The public API exposes the site object as `dataset_cover_theme`. These site
choices are shared by light and dark themes. Browser metadata is a projection
of these server settings, not another authority. Unsaved preview values remain
owned by the mounted palette and are not written to the database.

The dataset palette saves through administrator `POST /api/admin/dataset-appearance`
with `{dataset_uid,set,unset,shared_version,version}`. The existing card API
continues to accept nullable style/count fields, but now requires both loaded
revisions and projects nullable read fields from the override map. The complete
card editor and generic metadata writes use the same revision-protected saver.
Omitted fields are preserved; explicit null unsets a compatibility override.
Missing/stale revisions receive translated 409 refusals and retain the draft.
The physical style/count columns and their editable metadata are retired.

Site saves require their loaded `version`. Every shared and dataset writer uses
one shared-before-dataset lock order, including the absent shared-row case.
Legacy omitted shared fields still preserve stored choices. The public site
endpoint stays shared-only; authorized results carry the complete appearance
snapshot without another browser request. See [the appearance API contract](Frontend_Guide.md)
for the pending K290 mask-order limitation and later scoped-rendering work.

Each group previews immediately. Its reset returns to the latest saved settings;
leaving the palette owner releases unsaved previews. Closing the panel preserves
the current unsaved preview, as with its other controls. Site and dataset Save
failures are reported separately, so one button never implies both scopes were
saved.

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

## One card field wrapping choice for the whole site

The **Site defaults** part of **Card layout** offers **Stacked** (Allekkain)
and **Side by side** (Rinnakkain). Stacked is the default for missing or unknown
values. **Automatic** (Automaattinen) is available only when the server runs
in development mode, using the same boundary as the experimental card.
Production rejects saving Automatic and reads an older stored Automatic as Stacked.

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
