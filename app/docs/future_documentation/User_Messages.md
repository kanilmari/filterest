<!-- Describes private chat messages exchanged between Filterest users. -->
<!-- Connects internal account identities with conversations and participants. -->
<!-- Keeps interpersonal communication distinct from dataset AI conversations. -->
<!-- Defines a small missing messaging capability without a transport design. -->

# User Messages

## What it makes possible

Users can exchange chat messages with one another inside Filterest and return
to their conversation later. This is interpersonal communication, distinct
from the existing dataset assistant chat and from comments attached to data.

A conversation is readable only by its authorized participants. A message or
its notification never grants access to a dataset or row mentioned in it;
linked content retains the recipient's own rights under the
[permission model](../instructions_and_documentation/Permission_Model.md).

## Concepts

- **Conversation:** the shared context for messages between users.
- **Participant:** an internal account allowed to take part in a conversation.
- **Message:** authored content with a sender and sending time within that
  conversation.
- **Read position:** a participant's place in the conversation, allowing new
  messages to be distinguished from messages already read.

## General data model

A conversation relates its participants to an ordered set of messages. Each
message belongs to one conversation and sender. Read positions belong to
participants rather than being shared conversation state.

## Implementation principles

The server checks participation on every read and send. Notification delivery
can reuse [followers and watchers](Followers_And_Watchers.md) concepts without
making private messages public or forwarding their contents to an AI service.
