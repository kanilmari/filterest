# Filterest 9.3.22

Private login names are now separate from the names other people see, categories open
from a compact card with heading buttons, Home can carry a title, a slogan and a moving
background, and the limited database accounts lose write privileges they never needed.
The database moves from 9.9.2 to 9.10.0. Administrators whose public name was their
login name get a public name `admin_<n>` and sign in again once; their login name does
not change.

## Before you update

- **Database 9.10.0.** The update applies the 9.10.0 migrations at start where SQL
  migrations are enabled, as on production sites. Take your installation's normal
  backup first; the site update procedure does this for you.
- **Administrators' public names.** An administrator whose public name equalled the
  login name receives the next free `admin_<n>` (`auto_<n>` for the API-only automation
  account) and is signed out once. Sign in with the unchanged login name. Names that
  were public before stay as they were.
- **Database privileges are tightened at every start.** The limited database accounts
  lose direct write privileges on the account, membership and rights tables, their views
  and sequences. If a configured writer, such as an automation, an upload cache or a
  gallery, targets one of those tables, the start stops and names it. A runtime role
  with the `BYPASSRLS` attribute, ownership or other elevated attributes also stops the
  start and names the configured role; nothing is changed for you.
- **Codex CLI 0.160.0.** The chat's coding agent, the site assistant's runner and the
  worker CLI now require Codex CLI 0.160.0.
- **Docker.** The application image builds again (since 9.3.21 its frontend stage
  missed two files). Docker setup and start now need Docker Compose 2.20.0 or newer and
  Python 3.

## Names and signing in

- **Private login names.** Sign-in and recovery use the private login name, without
  case sensitivity; profiles, lists, search and mail show the public display name.
  Registration and First Run ask for both. Ordinary accounts may keep equal names unless
  an administrator turns that setting off; administrators' names always differ.
- **Login-name change and signing out other devices.** The Account profile can change
  the private login name or sign out the account's other devices, both confirmed with the
  current password. The browser that does it stays signed in, even when one of its own
  earlier requests finishes afterwards; other devices lose access at once.
- **Program accounts** keep their fixed private names and show `auto_<n>`.

## Categories

- **A compact category card.** Categories appear before the selected filters and the
  result count. Heading buttons show how many values are selected and open one
  searchable checkbox list with hit counts; Escape and the close cross return to the
  heading. The selected-filter row offers "Selected:" and "Clear all", and a search with
  no results suggests removing a category.
- **Classes and categories window.** Administrators create, rename, order and disable
  headings and values and assign them to selected rows.

## Home and appearance

- **Optional Home page** with newest readable rows per dataset, a title and slogan in
  Finnish and English, and image or MP4/WebM backgrounds of up to 50 MB that fade in
  and loop smoothly. Dataset boxes can be switched off.
- **Favourites** keep an administrator's frequently used tools under the dataset tabs.
- Dataset covers start at the top of the window and fade into the content background;
  a dataset image can be hidden without deleting it; every card field follows one
  site-wide wrapping choice; image text is edited one language at a time.

## Data and permissions

- **Creator and owner columns.** New and existing content datasets get protected
  `created_by` and `owner_id` columns; the upgrade fills them only from approved author
  columns. A read-only report, `app/server_tools/scripts/row_owner_dry_run.sql`, shows a
  site's planned changes first.
- **Saved rights and database grants stay together.** Rights changes, dataset creation,
  asset linking, automations and schema changes reconcile their database grants in the
  same transaction, and a restored site settles its permissions before it opens.
- **Live updates end with the sign-in**, deleted rows keep all their files in the
  archive, and new rows keep the keys their relations reference.

The complete list of changes is in `CHANGELOG.md`.
