<!-- Describes subscriptions and explicit recipients in a notification model. -->
<!-- Connects readable subjects, interested users and change events. -->
<!-- Keeps notification interest separate from access and automation rules. -->
<!-- Defines missing recipient relationships without choosing delivery channels. -->

# Followers And Watchers

## What it makes possible

People can follow changes to content they may read, and authorized users can
identify watchers who should be kept informed. The notification model explains
why a person receives a notice and lets personal followers stop following.
Following or watching never grants access to the subject.

This supplies recipient relationships and delivery preferences. It extends
the existing trigger mechanism's event and action concepts without defining
another automation-rule editor. Live dataset refresh events update views;
they are not a durable personal notification inbox.

## Concepts

- **Subject:** the readable item whose changes can generate notifications.
- **Follower:** a user who chooses a personal subscription to a subject.
- **Watcher:** a user explicitly associated with the subject as a recipient,
  with the reason and authority for that association recorded.
- **Notification:** a notice of a relevant event for a particular recipient.
- **Delivery preference:** the recipient's choices about supported channels
  and which eligible events warrant a notice.

## General data model

A subscription links a user and subject with its follower or watcher role and
origin. An event relates to a subject; recipient decisions relate that event
to eligible users and their preferences. A delivery record distinguishes a
notice already delivered from one still pending, avoiding duplicates.

## Implementation principles

Check current [permissions](../instructions_and_documentation/Permission_Model.md)
before delivery and again when opening the subject. Notices must not leak
content after rights are revoked. Coordinate event sources with the shared
automation rules rather than reproducing their conditions and actions here.
Merely viewing a row, as described by [row view counts](Row_View_Counts.md),
does not silently subscribe a person or make them a watcher.
