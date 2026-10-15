<!-- Describes account closure and the revocation evidence it requires. -->
<!-- Connects account eligibility with existing server-side sign-in revocation. -->
<!-- Keeps closed accounts from retaining access on another device. -->
<!-- Defines remaining closure and audit requirements without a deletion policy. -->

# Account Closure

## What it makes possible

A person can close their account through an explicit, verified action. Closure
immediately makes every sign-in of that account unusable, including the
initiating sign-in. Other devices receive the existing session-ended notice
when they next contact the server; an open live connection follows the existing
session recheck behavior. Closure also prevents signing in again unless the
account is deliberately restored under an authorized policy.

This extends the [account and permission model](../instructions_and_documentation/Permission_Model.md#account-names-and-account-maintenance)
and existing server-side revocation. It does not define erasure of authored
content, retention periods or transfer of ownership.

## Concepts

- **Closed account:** an account no longer eligible to sign in or act.
- **Account-wide revocation:** invalidation of every existing sign-in, with no
  surviving device exception.
- **Revocation evidence:** an audit entry identifying the affected account,
  responsible actor, cause and time without recording credentials.

## Implementation principles

Closure and its revocation evidence must succeed together before success is
reported. Reuse the existing server-side session checks and translated
session-ended notice rather than inventing another device-sign-out mechanism.

Sign out other devices already records a specific security audit action.
Password-change flows have general request auditing but still need explicit
revocation evidence. Extend that evidence consistently for password changes
and closure; a generic successful request alone does not describe which
account's sign-ins were revoked or why.
