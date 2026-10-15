<!-- Describes deliberate sharing of a canonical article address. -->
<!-- Connects browser sharing, service buttons and article QR codes. -->
<!-- Keeps recipient permissions independent of the sender's session. -->
<!-- Adds sharing controls without duplicating existing site link previews. -->

# Article Sharing

## What it makes possible

An article offers a share row with browser sharing, individual service buttons
and a QR code. All of them identify the same article through one canonical
address on the installation's own domain. A person can send the article to
another device or service without copying a temporary browsing address.

The shared address contains no session credentials or request-forgery tokens.
Recipients use their own rights under the
[permission model](../instructions_and_documentation/Permission_Model.md);
sharing does not publish private content or lend the sender's access.

## Concepts

- **Canonical article address:** the domain-aware public identity of the
  article, independent of the sender's session and temporary view state.
- **Share row:** the common place for browser sharing and per-service actions.
- **Article QR code:** a scannable representation of that same address.

## Implementation principles

Resolve the address once and use it for every share action and the QR code.
Retain the site's existing identity and wording in link previews. Sharing
controls use translated labels, keyboard access and both application themes;
browser sharing availability must not prevent use of the other actions.
