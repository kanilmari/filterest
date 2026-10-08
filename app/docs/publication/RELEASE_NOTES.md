# Filterest 9.3.23

Category lists now open over the results like a select list, a heading can require all
selected values, values without current hits stay visible but dimmed, and Home's slogan
can span several lines. The database moves from 9.10.0 to 9.10.1, which only adds
Finnish and English texts.

## Before you update

- **Database 9.10.1.** The update applies three migrations at start where SQL
  migrations are enabled, as on production sites: Finnish and English texts for the
  category match choice and for the shared dropdown lists, and the version record. Table
  structures do not change, and texts that already exist are kept as they are. Take
  your installation's normal backup first; the site update procedure does this for you.

## Categories

- **Lists over the results.** A heading's list opens over the results like a select
  list, through the same dropdown the other lists use, instead of pushing the results
  down. It keeps hit counts, search, the close button, focus return to the heading and
  the 20-value limit. On a short screen or with an on-screen keyboard the whole list
  stays inside the visible area and scrolls.
- **"At least one" or "All selected".** Headings whose rows can have several values
  offer both, restored through the address; counts for "All selected" show the matches
  with the candidate value added. Readable values with no current hits stay visible,
  dimmed and selectable.
- **Counts on large datasets** no longer slow down with each selected value: with 20
  values selected on 100,000 rows a listing took about 49 seconds and now takes about 4.

## Lists and keyboard

- Escape in a dropdown list inside a form window closes only the list; it used to close
  the whole window. Enter on a list's Exclude button excludes the value instead of
  selecting it, and keyboard navigation keeps the focused value in view.
- The column filters' search field, selection counts, empty-results text and clear
  button follow the page language.

## Home

- Home settings edit the slogan's Finnish and English text in multi-line fields, and
  Home shows the line breaks typed there.

The complete list of changes is in `CHANGELOG.md`.
