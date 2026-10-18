# Route authorization matrix: expected outcomes

`route_auth_matrix_expectations.jsonl` holds one line per registered route, keyed by `path` + `handler` exactly as
in `app/frontend/generated/backend_route_manifest.json` (production scenario). The matrix test fails on a registered
route that has no line, and on a line whose route no longer exists. Every new route needs a reviewed expectation.
The file is maintained by the security review and refreshed as a whole. Do not edit it by hand.

Fields:
- `methods`, `profile_production`, `dataset_scoped_default`, `conditional_source`;
- `expect`, the outcome per persona; for grant-dependent routes per `nogrant` / `granted`, plus `other_dataset`;
- `class`, `reason_code`, `csrf_required_for_unsafe_methods`, `wl164_guest_direct`, `wl164_guest_via_grant`;
- `conditional_profile`, only on routes absent in production that a setting can enable.

There are no expected-failure fields. Every row states the outcome the code must give now, and a field outside this
list fails the test.

## Personas
| Persona | Meaning |
|---|---|
| `anon` | no cookies; the site has `login_to_browse=true` |
| `guest` | no cookies; the site has `login_to_browse=false`. The auth stage makes it the shared guest account, user 1 |
| `user` | signed in, member of `users`, `admin_access_allowed=false`, valid fingerprint and device cookies |
| `admin` | signed in, member of group 1, `admin_access_allowed=true`, valid cookies |

## Request style
- API-style requests: `Accept: application/json` and no `Sec-Fetch-Mode: navigate`. The sign-in answer is then
  403 JSON with `auth_failure: true`. A browser document GET to a non-`/api/` path gets a 303 to `/login?…` instead.
- Unsafe methods carry a valid CSRF token from `/api/csrf-token` in the same session.
- Dataset-scoped routes name the fixture dataset in the query (`?dataset=<name>`).

## Outcome classes
| Class | Assert |
|---|---|
| `PASS` | the pipeline reached the handler: no 403 auth_failure, no access/admin 403, no 405 from the method contract |
| `SIGNIN` | 403 JSON `auth_failure: true` |
| `DENY` | 403 without `auth_failure` (access control or admin check) |
| `HANDLER_REFUSES_GUEST` | the pipeline passes, then the real handler refuses user 1 with 401 or 403, given valid inputs. Some handlers validate the body or fixture first and answer 400, so send valid ones |
| `ABSENT` | absent from the production route table. Assert on the registered route list, not an HTTP status: an unregistered path falls through to the public `/` prefix route (GET gets root behaviour, other methods 405). `conditional_source` says when it is registered, and `conditional_profile` its profile then |
| `SECRET` | refused for every persona without a valid service token, provider signature or single-use code |
| `SYSTEM_TOKEN` | 403 unless the direct peer is permitted, no forwarding headers are present, and the manager bearer token matches |
| `SYSTEM_NETWORK` | 403 for a public peer or a public forwarded client (loopback, private and link-local peers are allowed). The test environment must not set `EASELECT_SYSTEM_ENDPOINTS_ALLOW_PUBLIC` |
| `FIRST_RUN` | not pending → 303 `/login` for everyone; pending → GET serves the form, and POST checks origin, then the setup code (403 without it, 429 when throttled), then session CSRF |

## Rules by profile
| Profile | anon | guest | user | admin |
|---|---|---|---|---|
| public | PASS | PASS | PASS | PASS (special rows by `reason_code`) |
| sign_out | PASS (CSRF still required) | PASS | PASS | PASS |
| login_only | SIGNIN | PASS as user 1, or HANDLER_REFUSES_GUEST | PASS | PASS |
| default / access_control_no_tx | SIGNIN | `nogrant` DENY · `granted` PASS | same as guest | PASS |
| admin / admin_no_tx | SIGNIN | DENY | DENY | PASS |
| absent in production | ABSENT | ABSENT | ABSENT | ABSENT |

`reason_code` `admin_profile_handler_capability`: admin passes the pipeline, and some of these handlers also require the
separate update capability (layer B).

## Fixtures
- **Two layers.** Layer A registers the real route table with stub handlers under the real handler names and
  profiles, to test pipeline decisions deterministically. Layer B uses real handlers, only for the rows whose
  outcome is decided by the handler (`HANDLER_REFUSES_GUEST`, `SECRET`, `SYSTEM_*`, `FIRST_RUN`, storage).
- **The grant fixture** for every default/admin route:
  - `nogrant`: the function row exists, and no non-admin group holds it;
  - `granted`: the guests group and `users` hold it, as a NULL-target grant for tableless routes, or on fixture
    dataset A for scoped ones;
  - `other_dataset`: the grant exists only on A and the request names B.
- **Admins** pass through the startup admin grants: the tableless routes' grants and every registered
  dataset/function pair. Register the fixture datasets before that provisioning runs, or run it again after creating
  them.
- **Cross-cutting:**
  - every non-public route with an unsafe method answers 403 "missing CSRF token" for guest, user and admin when the
    token is absent;
  - an undeclared standard method answers 405 only after the pipeline lets the request through, because the method
    check sits inside it. Test it as a persona that passes (admin with a valid CSRF token). OPTIONS, TRACE and
    CONNECT are refused earlier by the firewall.
