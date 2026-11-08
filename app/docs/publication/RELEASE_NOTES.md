# Filterest 9.6.2

Release date: 2026-11-08. Contains the 20 commits since 9.6.1.

## Database upgrade and rollback

Database **9.13.4 → 9.13.5** is applied on the first start of 9.6.2.
The database minimum and target are both **9.13.5**. The migration adds the
site-wide boolean setting `app_log_search_terms`, off by default, and records
the database release. Replaying it preserves an existing site choice.

Take a backup before upgrading. A rollback to **9.6.1 needs the 9.13.4
database**: restore the pre-upgrade backup under a write freeze; database
changes made after that backup will be lost. If Home uses the new **No text
below title** style, select and save a supported style before downgrading to
an application that lacks it.

## Home and phone top bars

Home's **No text below title** style keeps the Serif story heading and its
short italic accent while hiding the introduction and any longer slogan.
The boxes follow the heading directly. Stored text and line-reveal preferences
are retained. Shared-link descriptions still use the cleaned description,
then the site name.

Phone top bars are 48 px tall, with edge-to-edge menu, identity/search,
search-toggle and dataset-panel cells. Home omits the panel cell. Dataset
views and Home show the site identity; articles show the translated dataset
name. Long names end in an ellipsis. The square search field has separate
clear and submit controls; the adjacent toggle hides search without clearing
it. Home retains typed search text for the current visit, offers clear when
there is text and hides empty result boxes.

## Sign-in, account page and dialogs

The account page shows signed-in users their own login name as a read-only
field. The sign-in dialog stays open on a backdrop click. Other dialogs still
close on an intentional backdrop click, while a text selection ending outside
the dialog keeps its draft. Close buttons, Escape and assistive activation
remain available according to each dialog's dismissal policy.

On the sign-in form, the privacy-consent row is one clickable label: the
checkbox, gap and text toggle it. The notice link still opens the notice
without toggling consent, and the checkbox remains required.

## Application-log privacy

Application logs leave out visitor search terms by default, including request
query strings and fragments, search-related database/provider error contents
and malformed provider replies. AI search diagnostics that can repeat search
words are suppressed. Search failures retain diagnostic identity, error class
and SQLSTATE rather than messages or response bodies.

Operators who rely on search terms in logs can restore the previous diagnostics
by enabling the site-wide boolean setting **`app_log_search_terms`** in the
existing system configuration settings view. Changes take effect **within five
minutes**. Missing, null or unreadable settings mean off; a failed refresh
returns to off. Warm reads of other settings are not held up by this setting's
refresh. The choice affects new log lines; it does not remove older logs.

## Article view, presentation choice and navigation

Article view places **Previous, Next and Close above the title at every
width**, in a bar that scrolls with the article. Previous and Next use the
displayed results and disable a direction with no neighbouring row. The
image's own arrows still change images within the same row.

The Article control in **Show content as…** is a joined split button. Its
caption follows this dataset's choice in this browser tab: Article by default,
Image-first article or Page-sized image-first article. The chevron opens a
keyboard- and touch-friendly menu with the current choice checked; choosing
opens that presentation. Tab closes the menu and continues normal focus
traversal. The choice survives reloads without changing the dataset's saved
default view.

Image-first choices use the open article's row, otherwise the first row of the
current listing, including its search, fetched afresh. An empty listing opens
nothing and reports that there are no results. A changed listing, any
application address write, navigation away or a newer choice cancels an
unfinished opening. Articles without permitted photos can open as text only,
also after reload and Forward. Article and Image-first retain the Article
right requirement; Page retains its own right. Choosing in the picker keeps
the phone filter panel open; later ordinary and photo dialogs retain their
normal dismissal behavior.

Back/Forward dataset restorations keep loading through their own hidden-field,
category and view-fallback address repairs. A newer navigation still cancels
pending work, preventing an older restoration from replacing its history or
reselecting its dataset late.

## Table cell editing

An edit is no longer interrupted or saved by a change arriving from elsewhere.
Live changes wait until the editor closes, and a saved cell stays selected
through refresh. Held changes preserve other languages when editing an
initially empty multilingual field, including in List view. Other rebuilds,
such as sorting or changing views, discard an open draft without saving it.
Readers keep the ordinary refresh timing and shared searches.

## Tests and documentation only

The concurrent-settings test uses separate maps for concurrent writers.
Browser-test work restores phone sign-in/profile coverage, records fixture
time without crediting an unidentified active test slot, adjusts a permission
test timeout, improves sign-in/re-render helpers, and ensures cleanup and
`e2e_` markers for temporary datasets, columns and generated language keys.
The nightly development pipeline removes marked language keys; fixtures may
remove their own keys sooner. The phone top-bar test follows the 52 px menu
cell. Frontend rename guidance requires name searches for callers and treats
caller maps as optional aids; documentation also records a future browser-update
proposal. These test and documentation changes have no production effect.
