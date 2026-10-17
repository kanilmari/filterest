<!-- Describes revocable tokens that let programs call Filterest without a browser sign-in. -->
<!-- Connects automation access with accounts, groups and the existing permission model. -->
<!-- Keeps token authentication separate from protected fields that store secrets as data. -->
<!-- Defines token identity, scope and lifetime without choosing a wire format. -->

# API Access Tokens

## What it makes possible

An owner or an authorized user can create an access token that lets a program,
such as an import job, an integration or a site plugin, call the Filterest API
without a browser session, a sign-in form or a second-factor prompt. A token
acts on behalf of one account, so the
[permission model](../instructions_and_documentation/Permission_Model.md)
still decides what each call may read or change. A token can be limited
further, but it never gives more than its account could do.

Today general API automation signs in and keeps a session; the dedicated
API-only account already supports programmatic password sign-in with CSRF
checks, without an interactive sign-in step. Existing bearer access is limited
to system management and payment operations. Account-scoped tokens make
scheduled and server-to-server work simpler and safer to revoke. Secrets that
Filterest stores as data belong to
[protected fields](Protected_Fields.md); they do not authenticate anyone.

## Concepts

- **Access token:** a long random secret shown once at creation, identifying one
  token record. Only a verifier of the secret is retained.
- **Token owner:** the account the token acts for. An API-only account is a
  natural owner for unattended jobs.
- **Scope:** an optional narrowing to selected datasets, actions (read, insert,
  edit, delete, schema changes) or tools, applied on top of the account's rights.
- **Lifetime:** creation time, optional expiry, last use and revocation. An
  expired or revoked token is refused at once.
- **Token use record:** when, from where and for which kind of call a token was
  used, for audit and anomaly review.

## General data model

A token belongs to one account and has a name, a scope, a lifetime and use
records. Disabling or closing the account, or resetting its sign-in generation,
invalidates all of its tokens. Scopes refer to existing datasets, actions and
tools rather than defining a parallel permission registry.

## Implementation principles

A token is accepted only over an encrypted connection and only from the request
header intended for it, never from an address, a query string or a cookie, so
browsers do not send it automatically. Token secrets must be kept out of logs.
Token calls get their own rate limits. Creation, scope changes and revocation
are administrator-visible events. Owners can list and revoke every token in the
installation, and users can revoke their own.
