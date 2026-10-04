# Filterest 9.3.21

Signing in survives a browser update, each browser tab keeps its own view and open
article, a card's picture is no longer lost or switched by itself, and a row's title
no longer reaches the page before the row is read with the person's rights. The update
signs everyone out once.

## Signing in survives a browser update

After a browser updated itself, signing in could stop at "Invalid CSRF token. Reload the
page." on every site, and every site had signed the person out. A session that replaced
one the server could not read was saved without the session cookie's settings, so the
browser kept a second session cookie under a folder such as `/api` beside the site-wide
one; the browser could also show a stored copy of the sign-in page whose token had gone
stale; and the browser's fingerprint contained its version number, so an update looked
like another browser.

A replacement session now gets the same cookie settings as every other session, and a
second session cookie under such a folder is cleared while the site-wide one is kept.
The sign-in page and the response that hands out its token now tell the browser not to
store them. A sign-in,
verification-code or password-reset request that meets a stale token fetches the
session's current token and tries once more, keeping what the person typed. The
fingerprint leaves version numbers out, and a signed-in session whose browser no longer
matches ends in one clean sign-out instead of passing the person back and forth between
the sign-in page and the application. Because the fingerprint changes, **the update
signs everyone out once**.

## A row's title stays out of the page until the row is read with rights

The server writes the browser tab title and the link-preview title into a page before
anything is authorised. At a row's address those titles could include the row's own
title without checking whether the person may read that row. A row's address now
carries the dataset's own title; the application still shows the row's title once it
has read the row with the person's rights. On a site that requires signing in, a
visitor who has not signed in is sent to the sign-in page first.

## Views and open articles

- **Each browser tab keeps its own view and open article.** With the same site open in
  two tabs, opening a new tab or choosing a view in one could close the article that was
  open in the other, or change its view. Each tab now remembers its own view and the row
  it has open; sorting, filters and paging stay shared by all of the site's tabs.
  Reloading an article's page brings back its related-rows tab, whether the related rows
  were open, and the scroll position. A link straight to an article opens even when the
  browser refuses a tab memory of its own.
- **A dataset opens in the view its address names, otherwise in its default.** A dataset
  whose default view was the card view sometimes opened as articles, because the browser
  remembered the view and the open article from an earlier visit. A newly loaded page now
  shows the view its address names, otherwise the dataset's default, and forgets the
  articles left open on earlier visits, while sorting stays.

## A card's picture follows one rule and is no longer lost

A card's picture could be the only reference to a picture file still on disk: uploading a
new picture overwrote that reference, and deleting the new picture then emptied it, so
the card lost its picture for good. An upload also made itself the card picture, while
the next gallery change chose again by another rule, so a card's picture could switch
back by itself.

Now one rule chooses the card picture everywhere: the picture marked as the main one,
otherwise the gallery's first. A new picture goes to the end of the gallery, so it
becomes the card picture only on a row that has none, and a card picture the gallery does
not hold is kept rather than lost. The article opens on the picture the card shows.
After the update, the application brings cards whose picture the old rule chose to the
new rule when it starts, and finishes any it could not reach at later starts. Two
changes to one gallery at once wait for each other, a CSV restore never writes over a
picture the rule keeps, and deleting a gallery item no longer moves into deleted storage
a file that the same row's other pictures or its card picture still use.

## Also

- **A row counts as your own only when the dataset says who owns it.** An own-row
  exception, such as "must be approved unless the row is your own", could identify the
  wrong owner. A dataset now gives that exception only through a named owner column that
  the database confirms links to the users table; the users table and the service
  catalog keep their existing rules.
- **Storage cleanup never touches the shared picture library.** The administrator routes
  that archive and prune unknown storage folders now consider only folders named by a
  dataset number, so they can no longer move the whole media library into deleted storage.
- **The missing-media check samples a whole dataset.** By default it runs once after each
  application or database update instead of at every start, and a check that was
  switched off stays off. It samples a large dataset evenly by default, reads card
  pictures and picture fields too, and its texts are language keys. Its report shows the
  adjustable limits, notices when a limit cut a run short and per-dataset results, and it
  lists a file as unused only after every gallery and picture field was read in full.

## Database 9.9.2

The update moves the database from 9.9.1 to 9.9.2. 9.9.2 changes no table: it adds the
second version of the missing-media check's setting and its texts.
