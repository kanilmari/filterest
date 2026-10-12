<!-- AI_Setup_Choices.md: describes one owner-controlled AI setup choice flow. -->
<!-- Connects first-run setup and administration with existing provider and language capabilities. -->
<!-- Keeps AI use optional, purpose-specific and explicit about outbound data. -->
<!-- Defines the missing unified choice and manual translation handoff without business offers. -->

# AI Setup Choices

A future feature unifying AI choices during setup and later administration.

## What it makes possible

AI setup choices let the owner decide, during first-run setup, whether the
installation uses artificial intelligence and for what. Conversation and agent
features and semantic search are chosen separately: each can be off, use a
provider account the owner already has, or use a compatible self-hosted model
service. Choosing one use does not enable another.

Keys can be entered in the same step or later. Skipping AI never blocks setup
or ordinary dataset use, and the choices remain editable in administration.
A selected service that still needs credentials is shown as needing setup,
rather than as ready to use.

Each choice explains what information it sends outside the installation and
where it goes. A self-hosted service has a stated processing location too;
self-hosting alone does not mean the service runs on the same computer.

Automatic translation is an explicit choice. When it is off, creating a
dataset or adding a column offers a manual translation step for its names in
every site language. The owner can supply and review those names without a
model service, so multilingual behaviour never depends on AI.

## Concepts

- **AI use:** a purpose the owner can enable independently, such as
  conversation and agent features, semantic search or automatic translation.
- **Service choice:** off, an owner's provider account, or a self-hosted
  service compatible with the selected use.
- **Connection readiness:** whether the chosen service has the credentials
  and configuration needed to use it; distinct from the owner's choice.
- **Data disclosure:** the information sent for an AI use and the processing
  destination, explained before that use is enabled.
- **Manual translation step:** the creation-time opportunity to edit dataset
  or column names across the site's enabled languages without automatic
  translation.

## Current foundations

The existing [first-run setup](../../../README.md#installation-and-first-start)
establishes the administrator and sign-in settings without a unified AI choice
step. Separate provider-key forms already exist for chat and embedding
management; [protected installation settings](../../../README.md#installation-options)
and [embedding management](../instructions_and_documentation/Core_Workflows.md#2-refreshing-embeddings)
describe the current credentials and search configuration boundaries.

The [semantic-search privacy boundary](../../../README.md#semantic-search-privacy-boundary)
already requires dataset and field approval for external embeddings. Existing
[agent availability and site policy](../instructions_and_documentation/Coding_Agent.md#site-policy-and-availability)
remain separate authorization requirements.

[Manual language-key editing](../instructions_and_documentation/lang_key_lifecycle.md#22-admin-ui--direct-table-editing)
and [creation-time labels](../instructions_and_documentation/lang_key_lifecycle.md#23-tablefoldercolumn-creation)
already support multilingual names. The missing capability is a single setup
and administration choice flow, including a manual translation handoff during
dataset or column creation when automatic translation is off.

## Implementation principles

- **One configuration authority:** setup and administration read and change
  the same validated choices. Extend existing provider configuration and key
  handling rather than creating a second credential store or setting system.
- **Consent does not grant access:** an installation-level AI choice cannot
  enable external embeddings for a dataset or field, widen an agent's rights,
  or bypass the ordinary permission model.
- **No silent provider fallback:** a disabled use, missing credential or
  unavailable service must not redirect content to another service. Report the
  specific readiness problem and leave ordinary dataset work available.
- **Preserve authored language values:** the manual step uses the existing
  translation editor and language-key lifecycle, retaining authored copy when
  automatic translation is enabled or disabled later.
- **Consistent interface:** choices, disclosures and readiness explanations
  use language keys and work in the application's explicit light and dark
  themes, including with translated copy in place.
