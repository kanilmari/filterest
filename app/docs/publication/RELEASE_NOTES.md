# Filterest 9.4.1

This patch improves Finnish card and filter bar text, gives administrators
control over article sections and action buttons for each group, and makes
Home's identity and navigation clearer on phones. It includes the changes since
9.4.0 and requires database 9.11.1, upgraded from 9.11.0.

## Before you update

- **Review article permissions before rollout.** When these permissions are
  first created on an installation, users and guests keep the **Details**
  section but lose **Images**, **Attachments**, **Related rows**, **Task
  progress**, and the **Edit**, **Edit language versions**, and **Delete**
  buttons until an administrator grants them. Administrators retain access.
  These defaults apply only at each permission's first creation; later grants
  and revocations persist across restarts and upgrades. Use the existing
  group-rights editor to choose which sections and buttons each group sees.
- **Database 9.11.1 is a text-only patch.** One migration seeds 23 card and
  filter bar language keys, followed by the database version record. It fills
  missing or blank translations and also replaces exact English fallback text
  in non-English locales; other nonblank authored wording is preserved. It
  changes no database structure or dataset row values. Back up and rehearse the
  update through the normal startup migration path before production rollout.
  Application 9.4.1 requires the completed 9.11.1 target and minimum.

## Article views and group permissions

The shared article and opened-card sections and row action buttons now follow
eight separate, site-wide group visibility permissions. The existing editor
names them in Finnish, English, Chinese and Cantonese. Anonymous visitors now
receive their guest group's current UI grants from the server before articles
render. Failed or stale permission bootstrap hides gated tools; signing in or
out replaces the permission set.

The article text and its large image remain visible under the existing article
access rules. Section visibility does not replace server-side row permissions:
showing Edit or Delete does not grant permission to perform those actions.
Individual related-row tabs and initially open section settings keep their
existing behavior.

## Cards and filter bar text

Sort selections and options, result counts, field-view editing headings, and
generated creator and owner name labels follow the selected interface language.
Result counts and text/AI search breakdowns use their own translation keys, so
existing site headings retain their wording. Add-row buttons and titles use the
same translated dataset name as its tab.

Empty card values, including dates in opened cards, now show one em dash with a
translated tooltip and accessible label. Zero and false remain visible values.
The database seed supplies Finnish, English, Chinese and Cantonese copy through
the existing language dictionaries and supported locale representations.

## Home presentation and article-link API

Home keeps the full site name beside its icon and menu toggle; tabs and
administrator actions give way when space is limited. Phones show dataset
destinations as equal-width stacked buttons. Home text fits within 16 px gutters
through 700 px while keeping its saved line alignment, and wider windows cap
saved side margins proportionally. The menu opens below the complete header
and remains reachable for closing and reopening. When resizing hides a focused
destination, focus moves to the visible menu toggle. The menu also remains
reachable after logout, and dragging an administrator's navigation tab keeps
the current view in place until the drop.

Sharp 128 px replicas of the original site icons improve Home and phone
identity rendering. Page heads offer both original and larger sizes with the
existing site selection and fallback rules.

Home article buttons now exist **server-side**. Administrators can configure an
ordered, revision-protected list of up to ten article targets through the
administrator API. Home's response returns only targets the current viewer may
open, with current translated header labels, including when newest-row boxes
are disabled. Unavailable targets appear only in administrator diagnostics.
The setting defaults to an empty list and needs no migration. **Rendering these
buttons on Home and the administrator picker come in a later release.**

## Source maintenance

The login-name source guard recognizes the reviewed DB 9.11.1 snapshot while
retaining earlier released snapshots. Three browser specifications now follow
already deliberate product behavior; those test changes introduce no separate
production behavior.
