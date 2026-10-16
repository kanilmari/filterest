<!-- README.md: contract for compiled Filterest feature components. -->
<!-- Connects feature ownership, registration, public assets and local checks. -->
<!-- Keeps cross-stack features behind explicit public boundaries. -->
<!-- No feature component is installed by this contract alone. -->

# Feature components

A **feature component** owns one compiled Filterest capability across Go and
browser code. It is not the release manifest's **composition component**, which
describes a source/build input in a release composition. This directory currently
contains only this contract; adding a real feature requires its own change.

## Layout and public boundaries

Names match `^[a-z][a-z0-9_]*$`:

```text
components/<name>/
  README.md
  backend/                 package <name>; public Go API
    internal/              implementation hidden by Go's internal boundary
    <subject>_<role>.go
    <subject>_<role>_test.go
  frontend/
    index.js               public browser entry
    lib/index.js           optional portable library entry
    <subject>_<role>.js
    <subject>_<role>.test.js
    <name>.css              one stylesheet entry
  tests/                   fixtures shared by Go and Vitest only
```

Import Go as `easelect/components/<name>/backend` with package name `<name>`.
Only [router/components.go](../backend/core_components/router/components.go)
may import a component from core Go. Other external consumers use only the
public root package, `frontend/index.js` or `frontend/lib/index.js`.
The portable `lib/index.js` depends only on libraries. Portable
`backend/reusable_components`, `frontend/reusable_components` and
`frontend/shared` never import core or feature components.

Component JS imports use relative paths, including imports from core consumers;
never import a `/frontend/` or `/components/` URL. Computed imports require an
explicit entry in the existing import registry. Components may depend on each
other only through documented public entries, without cycles. Do not import
private projects, replace modules or use symlinks inside a component.

Go and Vitest unit tests stay beside their code. Browser specifications remain
in `app/testing/e2e`, Python tests in `app/testing/python`, and migrations in
`app/server_tools/migrations` named `*_<name>_*.sql`. Update the relevant-check
map with explicit browser coverage or a justified `none` in the same change.

## Every component README records

- Routes, allowed HTTP methods, explicit pipeline profiles and stable handler names.
- `/ui/` permission literals, language keys and configuration keys, including defaults.
- Owned tables and central migrations, including retained data when disabled.
- Consumers and dependencies, their public entrypoints and dependency direction.
- How to disable the feature, its fail-closed behavior and how to remove it,
  including consumers, registrations, permissions, settings and persisted data.

## Registration and lifecycle

Each backend exports an idempotent `Register()` that uses the existing
registries: `app_registry.RegisterRoute`, `pipeline.RegisterRouteProfile`, and
the existing navigation/function registries as needed. Register routes once
(for example with `sync.Once`) and declare their methods and profiles explicitly.
`RegisterRoutes` calls the component list before replaying registered routes;
the route-manifest generator uses that same path. Regenerate the route manifest
and handler documentation whenever routes change.

Features are compiled in, without build tags or runtime plugins. Optional
features use validated runtime configuration and fail closed if their setting
cannot be read. Disabling a feature must stop its API and hide its UI; asset
availability alone never grants feature access. Migration/removal work follows
the component README's data lifecycle, not ad hoc database changes.

## Browser assets and packaging

The server serves `GET /components/<name>/frontend/<file>`; HEAD follows GET.
Only regular browser assets are public, with the same cache policy as
`/frontend/`, extension-based content types and `nosniff`. Source/config formats
such as Go, Python, SQL, environment files, Markdown and source maps are refused.
Backend, fixtures, tests (`*_test.*`, `*.spec.*`, `*.test.*`), dot paths,
directories, encoded paths, traversal and all symlinks return 404.
Other methods on asset routes return 405. Feature APIs retain their own profiles
and startup admission; only static GET/HEAD paths are exempt from that barrier.

Startup uses the sibling `components` of the canonical, resolved frontend
directory. A present sibling must be a real directory, never a symlink or file;
invalid layouts fail startup. If it is absent, startup creates nothing and
component asset requests return 404, preserving older compositions.
The dataset/alias segment `components` is reserved after existing name validation.

Vite allows the sibling source directory and bundles relative imports. Import
the component's single CSS entry from `app/frontend/styles/imports.css`; JS
must not import CSS. Docker build stages include components alongside frontend
source; runtime assets retain that sibling layout. Go source stays outside the
served `<name>/frontend/` roots. Keep translations and explicit light/dark
application themes working through the normal shared contracts.
