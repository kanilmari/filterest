# Filterest 9.3.19

Signing out now holds, and a sign-in has a last moment it cannot pass.

## Signing out stays signed out

Signing out only expired the three cookies in the browser, and the server kept no
record of it. A request that was already in flight in another tab finished
afterwards, wrote all three back, and the person held working credentials they
believed they had given up. The sign-out itself handed one back too: the session
store signs whatever the session still holds every time it is written, and telling
the browser to delete a cookie does not stop that, so the reply to a sign-out
carried a valid, newly signed sign-in.

Each sign-in now carries its own unguessable identity inside the signed cookie. A
sign-out writes that identity into one small table -- no user, no address, no
browser details -- and every boundary that checks a sign-in refuses it from then
on. This ends one browser's sign-in, not the account: signing out on a phone
leaves the same person's desktop alone.

Signing out is now a POST carrying the token only this application's own pages
hold, so another site cannot cause one by sending a browser to a link.

## A sign-in has a last moment

A sign-in was renewed on every visit, so one used daily never ended. Every sign-in
is now given, when it begins, the moment it ends: read from the database's own
clock, carried inside the signed cookie, and never rewritten afterwards. Changing
the setting governs sign-ins made after the change and never extends one already
given.

How long a sign-in may last is one setting, `absolute_sign_in_limit`, holding
whether the limit is on, the unit and the amount. The default is thirty days.

## What this means for people using a site

Everyone signed in at the time of the upgrade signs in once more, because a
sign-in made before this carries neither an identity nor a deadline. After that,
every sign-in ends at most thirty days after it began.

A tab left open from before the upgrade runs the previous page code and its sign-out
button will fail until the page is reloaded. Reload open tabs after the upgrade.

## Twenty internal relationships restored

An installed site was born without twenty of the links Filterest declares between
its own bookkeeping tables, because the install package shipped none of them. They
are restored, and the install package now ships them.

## Also

A piece of the session cookie is no longer written to the log, and a long-running
tool whose sign-in ends can sign in again instead of failing every later call.
