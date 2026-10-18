<!-- What: Describes the site's three raster-card image presentation modes. -->
<!-- Between: Connects the Appearance palette, typed site settings, and card rendering. -->
<!-- Why: Defines current per-use storage and the boundary for future controls. -->

# Card image presentation

Administrators choose a site-wide default under Appearance settings → Card layout:

- Fill and crop (cover): fill the existing card image frame, cropping where necessary.
- Whole image: fit the complete image inside the frame.
- Whole image with blurred background: fit the complete image over an enlarged, blurred copy of the same image. The background overlay uses the active application theme colour, including explicit light/dark overrides that differ from the operating system.

Changing the selector previews the choice immediately. Save appearance persists it with the other palette settings; Reset discards the unsaved draft. Finnish and English labels update in place with the application language.

The site setting is dataset_cover_theme.shared.card_image_presentation in the existing administrator-only site-presentation API. Allowed values are cover, contain and contain_blur. Older stored settings without this field load as contain and retain their other values. Dataset appearance can override that default through its administrator-only API.

Only raster photos rendered in the CARD_MEDIA slot participate. SVG and CSS logos, avatars, thumbnails, article images, gallery images and Image first media retain their existing rendering. Card dimensions do not change. There is one accessible image; the blurred copy is a decorative CSS background that follows the resolved image URL and clears if image loading fails. Stored media and captions are unchanged.

## Per-image use

Database 9.12.0 adds nullable presentation and paired focal coordinates on the
gallery link row. A library image has no shared card presentation. One use's
setting therefore leaves every other use of that file alone. Presentation
resolves from the image use, then the dataset override, then the site default,
with whole image as the fallback. Focal coordinates resolve independently from
the image use, otherwise to the center, and affect only fill-and-crop mode.

The storage and renderer are available; the per-image editor is a separate
interface change. No personal viewer level, owner-specific right or lock is
implemented. The [future extensions](../future_documentation/Card_Image_Viewer_Default_And_Smart_Crop.md)
describe those concepts and optional smart crop.

## Row-update contract

`POST /api/update-row?dataset=<parent>` accepts a separate `card_image` operation
alongside the parent row's `id`. It cannot be mixed with ordinary field updates.
The operation contains `use`, `presentation` and `focal`, plus `adopt: true` only
when explicitly adopting an unlinked image. Both nullable settings are required:
`presentation: null` inherits and `focal: null` centers. A focal point has numeric
`x` and `y` coordinates between zero and one, including the boundaries.

The delivered companion `<field>_usage` supplies the exact `use` object:
`dataset`, `row_id`, `column`, `relation_id`, `link_row_id`, and opaque `version`.
The version binds the parent and link row versions and the displayed source.
Clients return it unchanged. They must not locate an image use by URL. A source
with no gallery link has a zero link-row identifier and needs explicit adoption.
Duplicate gallery links to the same source cannot yield an unambiguous writable
identity. Reload after a save or conflict to obtain current companions.

The existing DefaultProfile applies authentication, dataset access control and
the request transaction. The handler checks parent update and gallery read and
update rights, both rows' mutation/visibility rules, field editability and
protected actor marks. Adoption also requires the gallery's add-row right. The
existing runtime route matrix supplies update/insert privileges from those
independent grants; this operation adds no LoginOnly route or broader grant.
Direct unversioned updates to the three storage columns are refused.

An adoptable local file is registered from the actual displayed parent field
under the parent lock, then its settings are saved in the same transaction.
Failure rolls both back. External addresses, files owned by another row,
unverifiable or missing files, and unavailable galleries return a conflict.
No file is moved or copied, and no other parent image field is rewritten.

Malformed values and conflicting dataset/row identities return 400, insufficient
rights return 403, and changed versions or unsupported adoption return 409.
Successful writes publish link and parent invalidations only after commit.
Presentation companions are drawn only from authorized, visible gallery rows.
Copy and restore rules for the image library remain a separate feature.
