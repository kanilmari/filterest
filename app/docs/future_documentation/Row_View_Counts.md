<!-- Describes an honest per-row count of distinct viewers. -->
<!-- Connects article openings, viewer identity, row permissions and card details. -->
<!-- Defines the meaning and consistency of the count without fixing a schema. -->
<!-- Keeps anonymous identity and its privacy consequences an owner decision. -->

# Row View Counts

## What it makes possible

Row view counts let the owner and readers understand how many distinct viewers
have opened a row's full-detail presentation. A viewer's first permitted opening
adds one to that row's count; further openings by the same viewer add nothing.
Each row has its own count, independent of other rows in the same dataset.

The total supplies the existing view-count detail shown in card views, including
result cards and the opened article. These presentations share the same per-row
total; the feature does not introduce a second counter.

The number measures distinct recognized viewer identities, not page impressions,
time spent reading or proof that a person read the whole row. Its accuracy and
continuity depend on the identity policy. It cannot certify a count of unique
human beings when people share identities or one person has several identities.

## Concepts

### View and counted surfaces

A **view** is a successful opening of a saved row's full-detail presentation:
the **article view**, called the **big card** in the original request. Both the
ordinary article view and Image First Article View represent the same row for
counting. Opening through a result card, a direct row link or row navigation
uses the same rule.

The view is recorded when the article actually opens, after the viewer's right
to read that row has been checked through the permission model. A denied,
missing, failed or cancelled opening contributes nothing. Anonymous viewers
must have guest read access to the row. The shared guest permission principal
does not identify all anonymous visitors as one viewer.

Displaying a result card in a listing, returning it in search results, fetching
row data in the background or opening an image-only preview is not a row view.
Reopening an article, changing its language or layout, and opening both article
presentations do not add another contribution from an already recognized viewer.

### Viewer identity and merging

A **signed-in viewer** is identified by the user account's stable identity,
independent of its name, sign-in session, device or network address. An
**anonymous viewer** is identified according to the privacy decision below.

The requested anonymous rule identifies a viewer by IP address: the same person
opening a row while signed in and anonymously from the same address counts once,
in either order. Anonymous viewing followed by signed-in viewing associates the
anonymous contribution with the user. Signed-in viewing followed by anonymous
viewing recognizes the contribution already associated with that address.
This address-based equivalence is not proof that the visitors are one person.

More generally, an **identity association** connects anonymous and signed-in
identities recognized as the same viewer under the chosen policy. A **merge**
preserves one contribution per row across those identities. If both have already
contributed to the same row, merging removes the duplicate contribution from
its total. Changing sign-in state must not create a second contribution merely
because the two kinds of identity were encountered in a different order.

## Open privacy question: anonymous identity

The owner must decide how anonymous viewers are identified before
implementation. The options below change both the personal data processed and
what the count can accurately mean. None is selected here.

| Option | Personal data and identity association | Accuracy and boundaries |
| --- | --- | --- |
| IP address | IP addresses are personal data. Recording them or using a derived identifier to associate anonymous and signed-in views requires a defined purpose, protection and retention policy; a derived identifier does not by itself make the data anonymous. | Preserves the requested same-address merge in either order. Different people behind one network address are counted as one anonymous viewer and may be associated incorrectly with an account. Changing addresses can count one anonymous person more than once, and reassigned addresses can combine unrelated visitors. |
| Short-lived, privacy-preserving visitor identifier | Uses a limited-lived pseudonymous visitor identity instead of the address as the counting key. The identifier and its association with a user can still be personal data; short lifetime and limited use reduce exposure but do not guarantee anonymity. | Distinguishes visitors sharing an address when they have separate identifiers. Merging works in either order while the same identifier is available during signed-in and anonymous viewing. Expiry, clearing browser storage or using another browser or device can count the same person again; a shared browser can combine people. This replaces the address rule and cannot guarantee merging merely because two openings share an IP address. |
| Signed-in viewers only | Stores user-linked view records, which remain personal data, without collecting an anonymous counting identity. | Counts each account once per row across sessions and devices. Anonymous openings contribute nothing and cannot be merged retrospectively without an anonymous identity. This narrows the requested feature to account-based reach and leaves anonymous readership out. |

The decision must also define how long identity associations remain usable,
what happens when identifying data expires or is removed, and how those limits
are explained with the count. A short-lived identity cannot promise permanent
recognition of an anonymous viewer. Choosing a different option must explicitly
settle the resulting change to the requested anonymous and same-address behavior.

## General data model

A central **view log** is the authority for counted contributions. The existing
row view-record store provides the integration point for this responsibility;
its presence alone is not evidence that an opening has been recorded.

| Conceptual record | Meaning and relationships |
| --- | --- |
| Row identity | The dataset's stable identity together with the row's identity, so equal row numbers in different datasets remain separate. |
| Viewer identity | A stable user reference or the anonymous identity selected by the owner, with any applicable lifetime. |
| Identity association | The relationship between a user and an anonymous identity used to recognize a viewer across sign-in states, subject to the chosen policy. |
| View record | One counted contribution relating a row to a recognized viewer, with the first qualifying opening and only the identity information needed by the policy. |
| Cached total | The row's stored number of distinct contributions after identity associations and merges, supplying its existing view-count detail. |

There is at most one contribution for each row and recognized viewer.
Repeated requests, retries and simultaneous openings cannot create additional
contributions. Associating identities preserves contributions to different rows
while collapsing duplicates for the same row.

Recording a new contribution and updating the cached total can happen in the
same transaction. Alternatively, the opening durably records the view and a
background process brings the total into step with the log. In that model the
display may briefly lag, but recording still happens at opening time. Processing
retries and identity merges must not inflate the total or lose contributions.

The total can be rebuilt from the authoritative contributions. Recording,
merging and any policy-driven removal must keep the log and total consistent,
either atomically or through recoverable background reconciliation. A cached
number is never independent evidence of additional viewers.

## Implementation principles

- **Keep authority on the server:** validate identity and row access through
  supported application operations. A browser-provided total or development
  function counter is not trusted evidence of readership.
- **Protect viewing history:** access to the aggregate does not grant access to
  individual viewer records or identity associations. Collect only information
  required by the chosen policy and define its retention and removal lifecycle.
- **Preserve honest meaning:** do not present older totals without supporting
  records as verified distinct-viewer counts. Explain identity limits and any
  delayed total in language readers can understand.
- **Use the shared presentation:** keep labels and explanations translatable,
  accessible and usable in both explicit application themes.
