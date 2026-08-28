# Dataset-surface filterbar providers

This folder contains the public, product-generic extension seam for specialized
dataset filterbars. A provider is an internal frontend contract, not a user
agreement: it tells the generic filterbar host which implementation may build
the controls for one explicitly selected dataset surface.

The first contract version intentionally has a narrow responsibility:

- the standard full filterbar is the built-in fallback;
- an optional provider is selected by a stable provider key supplied with
  dataset metadata;
- every provider can require one or more server-owned capability keys;
- the specialized provider activates only when both the provider key and all
  required capabilities are present;
- missing, incompatible, or failing providers fall back to the standard
  filterbar;
- every successful builder returns a `destroy()` lifecycle callback so the
  generic host retains teardown ownership.

The host never checks a dataset name or a specialized view name. Future backend
work should expose provider and capability keys from a reviewed dataset-to-view
capability relation. It must not accept arbitrary endpoint URLs, SQL, or
browser-supplied capability claims as configuration.

Provider capabilities describe presentation and interaction support; they are
not permissions. Backend authorization must still protect every read and write
operation regardless of which provider the browser renders.

## Public/private boundary

This folder is under `app/frontend/core_components/`, so it is intentionally part
of the generated public Filterest source. It may contain only the generic
contract, registry, standard adapter, and their tests.

Maintainer-only or project-private provider implementations belong in the
embedding application's private source tree, outside Filterest. A private module
may import and register this public contract; the public core must never import
that private implementation or mention its view/dataset key.

## Next integration slice

The first specialized provider should register from its private entry point and
receive its explicit provider/capability metadata from the backend. Later
contract versions can add fixed contribution slots, provider-owned query
adapters, shared selection, and namespaced URL/state fields after those
behaviors have a real vertical-slice consumer.
