<!-- README.md: versioned guarded application-update admission contract. -->
<!-- Connects administrator requests, authentication evidence and future worker pickup. -->
<!-- Owns this new component's protocol and lifecycle without adding an update executor. -->
<!-- The general group/route model remains in Permission_Model.md. -->

# Guarded application-update admission (WL157 S3.1)

The administrator routes under `/api/admin/application-update` record intent;
they do not execute updates or display a button. GET at the base path reads a
signed installation-specific offer and the latest job; GET `jobs/{id}` reads
ordered sanitized progress. POST `reauthentication` checks a password and the
account's configured factor; POST `requests` and POST `jobs/{id}/decisions`
require its single-use proof and the separately granted update capability.
All five routes retain the full administrator pipeline, including CSRF, in
production and development. The normal lazy transaction buffers responses;
202 is released only after the intent, proof consumption and audit commit.

Version-one contracts live in `backend/core_components/application_updates/`;
the generated Go contract mirror, route manifest and stable endpoint wrappers
use them. Events carry their own protocol version and monotonic sequence; jobs
retain a separate terminal result. An idempotency key is scoped to actor and
operation (decisions also to job); changed content conflicts, while an identical retry returns the
original response without consuming another proof or renewing its deadline.
Offers bind composition, source, old/target release and image identities,
database route, trust revision and verifier evidence. They must be verified,
compatible, ready and unexpired. Executor enablement and availability require
an operator-published heartbeat less than one minute old. An absent control
row fails closed; bootstrap supplies neither a control row nor an update grant.

Proofs expire at five minutes and bind actor, authentication generation,
sign-in identity/deadline, action, offer/job, installation, release/cutover,
manifest, exact image, evidence revision and digest. Proof issuance truncates
the application clock to PostgreSQL's UTC microsecond precision before deriving
expiry; storage cannot future-date creation or extend the five-minute window.
The returned expiry matches the stored deadline. The database stores only
token hashes. Private job and decision rows retain the actor's revocation
evidence in `authorization_context`; the private proof binding uses the same
JSON key. Audit context stores a `sign_in_sha256` reference instead of the raw
sign-in identifier. Context never grants authority without the live rechecks below.
Persistent actor and trusted-IP limits allow five attempts per
five minutes even when authentication or the request transaction fails. Queued
requests and decisions expire at ten minutes; a request expiry records
`nothing_changed` and releases the active slot. Accept/refuse requires a
reopened job awaiting administrator acceptance and fresh exact evidence;
admission never marks it accepted or finalizes it.

Future manager pickup must hold the runtime-grant barrier and call the queued
authorization rechecks before maintenance or decision consumption. They check
current enabled administrator state, explicit grant, generation, sign-out,
sign-in deadline, queue expiry, executor availability and current evidence.
S4 must persist authoritative execution and consumption in its protected host
journal outside database restoration scope, then mirror sanitized results here.
The web process receives no service-control privilege or signing key. Before
reopening, recovery follows K292's automatic verified restoration; after
reopening, refusal or repair preserves new writes and proceeds forward.

Admission's three migrations join the already open, unreleased DB 9.10.2 and
sort before its `20261009000099` owner. Its bootstrap and schema snapshot are
regenerated together. Later work joining this unreleased release must also
sort before that owner; a released version opens a new database version.


## Explicit capability and recent authentication

The application-update capability (`capability.application_update`, permission
identity `/capabilities/application-update`) is explicit-only. Neither bootstrap
nor either startup administrator grant backfill grants it. Missing-right and
development administrator-recovery fallbacks refuse update routes. Use the
existing permission editor to grant it through a separate group: a browser
administrator cannot acquire their own effective update right by changing a
grant, a membership, or function metadata. The shared policy write guard compares
effective authority before and after every such mutation and rolls the whole
transaction back on self-grant. Initial provisioning therefore requires another
administrator outside the receiving group, or a reviewed operator migration;
there is no browser exception for the first administrator.

An enabled administrator with this right may request an update and accept or
refuse it, including their own requested update (K293). Other administrators
can read the offer, progress and outcome. Admission requires recent password
verification and the account's configured PIN, TOTP or email factor through
the existing authentication services. Email verification uses a distinct
`application_update` OTP purpose in storage and email, so a login code cannot
authorize an update. Update email requires provider acceptance in every mode;
development console delivery, missing settings and send failures return the
translated reauthentication refusal. Issuance replaces any previous challenge
with an expired hash, activates only the matching hash after delivery succeeds,
and deletes it on delivery failure. Failed deletion still leaves it expired;
delayed delivery results cannot activate or delete a newer resend. Codes and
provider-controlled diagnostics never reach update logs or public responses.
Ordinary session renewal never counts as recent authentication.
