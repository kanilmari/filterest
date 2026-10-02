# Missing Media Check

The missing media files check reports pictures and attachments that rows use but
storage no longer has. A lost file is otherwise silent: the row stays, the page
shows no picture, and nobody learns that the file left the disk. The check finds
such rows, says how far it looked, and stores its answer for an administrator.

It only reports. It never repairs, moves, recreates or deletes anything.

## 1. Where It Lives

- **Screen:** the media maintenance administration tool (Fix Media Subfolders)
  ends with the *Missing media files* section. It shows every setting, a
  *Check now* button and the stored result of the last run.
- **Endpoint:** `/api/admin/missing-media-check` (administrator profile). `GET`
  returns the settings, their accepted ranges, the sampling methods, whether a
  run is in progress and the last result; `POST` with `{"action":"run"}` starts
  a run and `{"action":"save_settings","settings":{…}}` stores the settings.
- **Settings:** the `system_config` row `missing_media_check`, a JSON object
  edited with the JSON editor (`value_type` 5), so it is also visible in the
  settings view. Migration `20260929000004_add_missing_media_check_setting.sql`
  creates it on every installation.
- **Result:** the `system_config` row `missing_media_check_last_result`, written
  by the first run and replaced by every later one.
- **Code:** `app/backend/core_components/missing_media_check/` and
  `app/frontend/core_components/admin_tools/missing_media_check_*.js`.

## 2. What It Checks

The check reads the application's own list of datasets that can hold media: every
registered file-upload relation, that is every `<parent>_assets` table (see
[Asset_Linking_Architecture.md](Asset_Linking_Architecture.md)). For each row
whose stored value names a file, it looks for that file in every size folder the
storage route can serve (`original`, `300`, `1000`, `2160`). A row counts as
missing only when none of them holds the file, because the route falls back
between sizes.

- Canonical and retired flat filenames resolve to the owning row's folder
  `<table_uid>/<row_id>/`; the retired `<table_uid>_<row_id>_<child_id>.ext`
  form is marked as such.
- A storage address such as `/storage/117/5/original/photo.jpg` resolves to the
  folder the storage route serves it from, here `117/5`.
- Media library references (`/storage/media/<uuid>/…`) resolve to the asset's
  own folder.
- A value that names no place in storage is reported as an unresolvable
  reference rather than failing the run.

A dataset planned for a full read is read only up to the rows counted at the
start; rows added during the run are left for the next run, and the dataset then
counts as not read completely.

A second pass, the card picture pass, then reads every picture field of every
dataset: the card picture `cached_image`, the other named picture fields
(`dtt_card_picture.CardPictureFields`) and every column whose card role is an
image. A card can show a picture that no gallery row names; without this pass
such a file went unnoticed when it went missing. Each non-empty value is looked
for in the same way. An external address names no stored file and is skipped.
The pass reports three lists:

- **Missing card pictures:** no size folder holds the file, or the value names
  no place in storage.
- **Card pictures kept from another row's folder:** the card picture points into
  the folder of another row. [The card picture rule](Asset_Linking_Architecture.md#4-the-card-picture-rule)
  keeps such a picture until an administrator clears the card picture field
  (owner decision K121, 30.9.2026); the check only lists them.
- **Pictures that could not be checked:** a disk or permission error hid whether
  the file exists. They are not reported as missing.

The gallery pass plans with four fifths of the row limit, so the card pass always
has at least a fifth, and it may also read what the gallery pass left unused. A
card picture is placed exactly as the card picture rule places it. The pass runs
under the run's time limit and is complete only when it read every value.

With `report_unused_files` the check also lists stored files no recognised
reference uses: no checked gallery row and no picture field names them. A row of
any dataset can point into any folder, so the list is made only when every
dataset was read completely and the card pass was complete. Otherwise the result
withholds it and says why (`unused_files_withheld`: `datasets_incomplete` or
`card_pass_incomplete`). A picture linked only from free text, for example
inside a description, is not a recognised reference, so the list is one to
verify before anything is removed; the check itself deletes nothing. The
dataset-level `dataset_media` folder is never reported.

## 3. Settings

| Setting | Meaning |
|---|---|
| `enabled` | Switches the whole check off, on demand and automatically. |
| `max_total_rows_checked` | The most rows one run reads, shared between datasets in proportion to their size. |
| `min_rows_per_dataset` | The smallest sample of each dataset while the row limit allows it. |
| `sampling` | How the rows of a dataset too large to read completely are picked: `even` (evenly from the oldest to the newest row) or `random` (with a recorded seed). |
| `max_run_seconds` | The most time one run may take. |
| `run_after_update` | Runs once by itself after an application or database update. |
| `run_on_startup` | Runs at every server start. |
| `startup_delay_seconds` | How long an automatic run waits after the server has started. |
| `exact_count_max_rows` | How many rows of one dataset are counted exactly before the count is estimated. |
| `report_unused_files` | Also lists stored files no recognised reference uses. |
| `max_reported_missing` | How many missing files the stored result lists; each card picture list has the same limit. |
| `max_reported_unused_files` | How many files no recognised reference uses the stored result lists. |

The defaults and the allowed ranges are stated once, in the backend, and this
page does not repeat them: the defaults are `DefaultSettings` and the ranges are
`settingLimits` (`backend/core_components/missing_media_check/missing_media_settings_reader.go`).
Saving clamps a value into its range, the screen's number fields show the same
ranges through the endpoint, and the migration writes the same default object,
which a test keeps equal to `DefaultSettings`. The settings object's
`schema_version` is 2; the result has its own, described in section 6. The check
runs after updates and not at every start.

The 9.9.2 update brings every installation to that: a site that already stores the
setting keeps every other value it stored and gains the new keys with their
defaults, but its two run choices become `run_after_update` on and
`run_on_startup` off, whatever it stored before (owner decision K122, 30.9.2026).
Two exceptions remain: a site that switched the whole check off with `enabled`
keeps it off, and a stored value that is not a settings object is left for the
administrator, as below. An administrator may choose every start again afterwards;
the application reads the stored choice and the update does not repeat.

A stored value that is not a settings object is not an error of the screen: the
endpoint answers with the defaults and names the problem (`settings_problem`), and
the check does not run on it until the settings are saved again.

## 4. When It Runs

| Trigger | Starts when |
|---|---|
| `manual` | An administrator presses *Check now*. |
| `update` | The server starts on an application version or database version the last result did not check, or no result exists, and `run_after_update` is on. |
| `startup` | The server starts without an update and `run_on_startup` is on. |

Every result records the application version, the database version and, for
information only, the build id. An update is recognised by the two versions,
never by the build id: every native rebuild has a new build id without being an
update. Startup maintenance passes these values in when it starts the check;
the check reads no version files of its own. Automatic runs wait
`startup_delay_seconds` first, and only one run exists at a time.

## 5. How Much It Reads

1. **Count.** Each dataset's media rows are counted up to
   `exact_count_max_rows + 1`. Past that bound the count is the larger of what was
   counted and PostgreSQL's own table estimate, and the dataset is marked as
   estimated. An estimated dataset is never reported as fully checked.
2. **Share.** The row limit is divided in proportion to dataset size, each
   dataset raised to its minimum where the limit allows. When everything fits,
   every dataset is read completely. When there are more datasets than rows in
   the limit, the result says so.
3. **Read.** A dataset planned in full is read in id order, a page of 1 000 rows
   at a time. Any other dataset is sampled across its whole id range: `even`
   spreads the sample points evenly from the oldest id to the newest, so the
   newest rows are checked as surely as the oldest; `random` draws them from a
   seed that the result stores, so the same sample can be repeated. Each point
   reads the first media row at or after it, 500 points per statement; a row two
   points land on is checked once, and the result counts the rows actually
   checked.
4. **Stop.** Every statement runs under the run's time limit, and so do the card
   picture pass and the unused-file walk. A run that reaches the limit says so,
   and a pass or walk it cut short is marked incomplete.

## 6. What The Result Says

The screen shows who started the last run, when (in the reader's own time zone),
on which versions, how many datasets and rows it checked of how many, how many
card pictures it checked and found missing, and every missing gallery file up to
the listing limit. It says that every checked file was found only when neither
pass found a missing file. Notices say each way a run fell short: more datasets
than the row limit, a minimum that did not fit, the time limit, a sample instead
of every row, estimated counts, a card picture pass that did not read every
picture field, lists cut short, an unfinished unused-file walk, an unused-file
list withheld with its reason, or a failed run. A withheld list shows "not looked
for" instead of a count.

A disclosure holds the details: the run's errors, the datasets of which not a
single row was checked with the reason (storage folder not found, rows could not
be counted or read, time limit, no rows left in the limit), a table of every
dataset with its rows, planned and checked rows, missing files and whether it was
checked completely, and the three card picture lists. Each list shows its count
and says when it was cut at the listing limit; the kept list adds that such a
picture stays until an administrator clears the card picture field. The list of
files no recognised reference uses comes last, with the reminder that a picture
linked only from free text is not recognised.

A run that fails or stops unexpectedly is stored too, marked failed with its
reason, using a save deadline of its own.

The result's `schema_version` is 3. Version 2 added the installation a run
checked, the sampling method, estimated counts, unreached datasets, failed runs
and the unused-file walk status. Version 3 added the card picture pass
(`card_pictures_checked`, `card_pass_complete`, the lists `missing_card_pictures`,
`kept_card_pictures` and `unchecked_card_pictures` with their counts, and
`card_lists_truncated`) and `unused_files_withheld`. Results of schema 1 and 2
still render with what they hold.

## 7. What It Never Does

- It never writes to a dataset or to storage. Every statement of a run goes
  through a read-only querier that refuses to write.
- It never deletes a row whose file is gone, and never recreates, moves or
  repairs a file. Repairing folders and thumbnails stays with the media
  maintenance tool's own actions.
- It never runs on settings it cannot read, and never runs twice at once.
- It is not a backup check: a file that exists but is damaged counts as present.
