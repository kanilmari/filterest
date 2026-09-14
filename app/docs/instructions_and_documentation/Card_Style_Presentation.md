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
| Site columns | Same JSON row, path `shared.card_detail_columns` | 2; integer 1–4 |
| Dataset style | `system_db_tables.card_style_variant` | NULL inherits the site |
| Dataset columns | `system_db_tables.card_detail_columns` | NULL inherits the site |

The public API exposes the site object as `dataset_cover_theme`. Both site
choices are shared by light and dark themes. Browser metadata is a projection
of these server settings, not another authority. Unsaved preview values remain
owned by the mounted palette and are not written to the database.

Dataset saves use the existing protected `POST /api/card-visibility/update`
with `scope: "dataset_presentation"`, `table_name`, and only the supplied
`card_style_variant` / `card_detail_columns` overrides. One SQL update preserves
omitted values under the row lock and returns the actual nullable stored values;
it never replays a cached column-visibility payload. Explicit null restores
inheritance. Invalid types, unknown fields and an empty patch are rejected.
Schema caches are invalidated after commit. The ordinary Card visibility
editor retains its existing complete-column save contract and optional style
override; an omitted columns setting remains unchanged.

Site settings retain their existing separate transaction. Old clients omitting
style or count preserve the latest stored value. Null is valid only for dataset
inheritance, not for a concrete site default.

Each group previews immediately. Its reset returns to the latest saved settings;
leaving the palette owner releases unsaved previews. Closing the panel preserves
the current unsaved preview, as with its other controls. Site and dataset Save
failures are reported separately, so one button never implies both scopes were
saved.

The upgrade converts old `standard` metadata to inheritance and retains explicit
`modern` values. The old schema did not record whether `standard` was selected by
an administrator or supplied automatically. This one-time transition implements
the approved glowy default for all previously plain datasets; administrators
can subsequently choose an explicit Plain override. New datasets inherit without
a database column default.

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
