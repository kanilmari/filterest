<!-- Describes externally verified sign-in that an owner can explicitly allow. -->
<!-- Connects identity providers with internal accounts, groups and sign-in policy. -->
<!-- Keeps authentication separate from permission grants and second factors. -->
<!-- Defines the missing provider relationship without choosing a protocol. -->

# SSO Sign-In

## What it makes possible

An owner can allow single sign-on through a trusted identity provider, and
people can use that provider to sign in to Filterest. Allowing a provider and
allowing an account to use it are explicit decisions; an external identity
alone does not create an administrator or grant access to datasets.

This adds an external authentication route alongside local sign-in. Local
password and second-factor choices already exist; they are not SSO. The
[permission model](../instructions_and_documentation/Permission_Model.md)
continues to decide what a signed-in person can do.

## Concepts

- **Identity provider:** a trusted service that verifies an external identity.
- **Provider allowance:** the owner's decision to enable that provider for
  this installation, including which accounts may use it.
- **Identity link:** a verified association between a provider's stable person
  identity and one internal Filterest account. A matching display name or
  unverified email alone is insufficient to link accounts.
- **Group mapping:** an explicitly managed relationship from external groups
  to internal groups, whose rights remain owned by the permission model.

## General data model

A provider has an allowance and identity links. Each link names a provider,
its stable external identity and an internal account. Optional group mappings
connect that provider's groups to internal groups without creating a second
permission registry.

## Implementation principles

Provider sign-in must obey account eligibility, session revocation and the
installation's verification policy. Disabling a provider prevents new use of
that route; administrators must have a deliberate recovery route if the
provider is unavailable. Second-factor policy must explicitly state how
provider verification satisfies or supplements its requirements.
