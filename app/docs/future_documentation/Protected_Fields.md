<!-- Describes secret values held in ordinary datasets with deliberate disclosure. -->
<!-- Connects field protection, external encryption keys and access records. -->
<!-- Keeps encryption and masking distinct from ordinary field read permissions. -->
<!-- Defines durable recovery and disclosure boundaries without a physical schema. -->

# Protected Fields

## What it makes possible

Protected fields let a dataset hold secrets such as passwords, access codes or
API keys without exposing them in everyday use. Each protected value is stored
encrypted with a key kept outside the database. A copied database or database
backup alone cannot disclose the value without that key.

Lists, cards, articles, exports and search results show only a mask. Protected
values cannot be searched, sorted or filtered by their content; the row's
ordinary fields remain searchable. Routine reading does not deliver the secret
to the reader's device behind the mask.

A reader with the reveal right can deliberately show or copy one value after
a recent sign-in check. The existing
[permission model](../instructions_and_documentation/Permission_Model.md)
continues to decide whether the reader may read the dataset, row and field;
the reveal right adds a disclosure requirement within that boundary. Every
reveal and copy records the reader, time, dataset, row, field and action without
recording the secret itself.

Administrators can replace an encryption key without losing protected values.
An editor can request a strong random value when creating a protected value,
with the same storage and disclosure rules as a value they supply themselves.

The protection covers leaked databases and database backups. Someone who
controls the running server can access its keys and decrypted values; this
feature does not protect against that control.

## Concepts

- **Protected field:** a dataset field designated to hold encrypted secrets and
  to withhold their content during routine reading.
- **Protected value:** the secret belonging to one row and protected field,
  stored in encrypted form and disclosed only through an explicit action.
- **Mask:** a fixed presentation of a withheld value that does not expose its
  content or length.
- **Reveal right:** authority to request disclosure of a protected value,
  subject to ordinary reading permissions and a recent sign-in check using the
  account's existing sign-in verification.
- **Access record:** the identity and context of one reveal or copy action,
  allowing disclosure to be reviewed without retaining the disclosed value.
- **Key version:** a non-secret identity that associates encrypted values with
  the encryption key needed to read them. The key material stays outside the
  database.
- **Random generation:** an editor's request for a cryptographically strong
  random secret rather than a manually chosen value.

## General data model

| Conceptual record | Meaning and relationships |
| --- | --- |
| Field protection | The dataset and stable field identity designated for protected values. |
| Encrypted value | One row and field, its encrypted content and the key version needed for decryption. |
| Encryption key version | A non-secret identity linked to separately protected key material and the values it can decrypt. |
| Reveal authorization | The reader's reveal right resolved through the permission model for the protected field. |
| Access record | The reader, dataset, row, field, reveal or copy action and time, without secret content. |

These relationships extend ordinary dataset values and permissions without
requiring a separate vault dataset or a particular storage layout.

## Implementation principles

- **Detect tampering:** encryption must authenticate protected content so that
  changed ciphertext cannot be accepted as a valid secret.
- **Refuse unsafe disclosure:** a missing key, failed decryption or inability
  to retain the access record refuses disclosure rather than returning an
  unprotected fallback.
- **Preserve recovery across key replacement:** older encrypted backups must
  retain a recoverable relationship to their separately protected keys until
  those backups are deliberately retired.
