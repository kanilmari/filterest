<!-- Program_Accounts.md -->
<!-- Describes software-owned accounts and their private and public identities. -->
<!-- Connects API authentication, system-manager provisioning and account-name rules. -->
<!-- Exists so automation uses the shipped credential boundary rather than human accounts. -->

# Program Accounts

A program account is used by an integration or automation tool rather than a
person. It remains an ordinary permission principal with an account id and
group rights. An API-only marker controls how it signs in; it does not bypass
permissions, CSRF checks, password checks or session invalidation.

## Private Login Name And Public Display Name

Filterest currently provisions one dedicated API-only automation administrator.
Its private login name is fixed as `filterest_agent`; its public display name
is the smallest available `auto_<n>`, starting with `auto_1`. The allocator
skips values already used as display or login names, ignoring case. API status
and provisioning replies return the account id, public display name in
`username`, and `fixed_login_name:true`, never the private name or password.
Rotation retains the existing public name and account id.

An upgrade preserves every existing login name, including API-only accounts,
while assigning API-only administrators `auto_<n>` display names. The shipped
provisioner accepts only its own fixed, unambiguous automation identity; it
does not adopt a human account or an unrelated pre-existing API-only account.
It is not a general creator for arbitrarily named program accounts.

Administrators use `admin_<n>` display names by default and can change their
private names. Ordinary users can choose equal names when the site setting
**Display name may equal login name** permits it (default yes); a value chosen
as a display name is public. Administrator and automation names always differ.
The profile's login-name change and the administrator name-change API refuse
fixed automation identities. Development fixtures `test_admin`, `test_user`
and an explicitly configured local administrator also have reserved names;
they are test accounts, not production program accounts.

## Provision, Rotate And Revoke

The protected `/system/automation-account` boundary is for a trusted system
manager. GET reports non-secret status. POST with `{"password":"<new password>"}`
(no action field) creates or rotates the dedicated
account in one transaction. It enables the account, ensures administrator
membership and access, sets API-only password authentication, and advances the
authentication generation when rotating. Old sessions become invalid on their
next request. POST with `action:"revoke"` disables the account and invalidates
its sessions. The normal administrator authentication-method editor refuses
this API-only account.

The supported client helper is
`app/server_tools/agent_tools/automation_account_credentials.py`; use its
`--help` for the current ensure/rotation options. It reads the system-manager
token from an owner-only runtime environment file and maintains an owner-only
credential file (0600). Keep these under installation-owned `keys/`, outside
source and release packages. Do not create or rotate credentials with direct
SQL. Audit records describe ids and actions without credential values.

## API Sign-in And Sessions

The program signs in with a JSON POST to `/api/login`, sending its fixed private
name in the compatibility field `username`, its password, a valid CSRF token,
and the automation header `X-Filterest-Automation: 1`. The signed session carries
the account id, authentication generation and automation-channel marker.
Browser/form sign-in is refused for an API-only account; adding a header does
not replace the password or CSRF proof. The existing API client supplies the
automation channel when configured for this account.

Human accounts can use **Sign out other devices** or change their login name
with their current password in the Account profile; the current sign-in
continues while the others expire on their next request. The system-manager
rotation/revocation above is the automation account's credential lifecycle.
Owner-directed account mail and protected credential files are deliberate
private-name channels; public responses, new cookies and new logs carry no
separate private name. Already public names retained in pre-upgrade history
are not erased by the migration.

The separate administrator sign-in address belongs to slice 4 and is not
implemented by the name-separation work. Program clients currently use
`/api/login`; see [Permission Model](Permission_Model.md#account-names-and-account-maintenance)
and [API CRUD Examples](API_CRUD_Examples.md#login-names-display-names-and-session-control)
for the shared account rules.
