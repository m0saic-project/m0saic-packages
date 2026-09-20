# skills/ — DSL & engine mental models

Operational skills layered on the handbook. **The handbook is canonical** — a doc
here that restates grammar is a checklist form of the same rules, and on any
conflict [`../handbook/`](../handbook/README.md) wins.

## Grammar & construction (emitting valid m0)

- [`structural-construction.md`](structural-construction.md) — the build-time
  rule checklist (count-exactness, overlay discipline, trailing-passthrough).
- [`m0saic-string-generation.md`](m0saic-string-generation.md) — programmatic
  generation: builders first, unified transforms, validate, repair loop.
- [`dsl-stdlib-method-catalog.md`](dsl-stdlib-method-catalog.md) — pointer to
  the full stdlib catalog (colocated with the package).

## Geometry & semantics (what the parser does)

- [`axis-and-geometry.md`](axis-and-geometry.md) — split axes, `splitEven`
  remainders, rect propagation.
- [`passthrough-semantics.md`](passthrough-semantics.md) — `0` donation runs,
  claimants, carry scoping.
- [`overlay-semantics.md`](overlay-semantics.md) — **the overlay anchor**:
  attachment, bodies, deferred paint order.
- [`zero-overlay-analysis.md`](zero-overlay-analysis.md) — the `0{}` phantom
  operator (rarely needed; read overlay-semantics first).

## Identity & parsing

- [`identity.md`](identity.md) — StableKey, the five axes, selection policies.
- [`parse-apis.md`](parse-apis.md) — which parse API to use + the
  frames→sources bridge.

## Authoring surfaces

- [`labels-and-masks.md`](labels-and-masks.md) — labels/masks across
  dictionary → generator → editor → disk.
- [`text-in-templates.md`](text-in-templates.md) — text sources, rasterizer
  choice, sizing traps.
- [`more-atoms-not-bigger-atoms.md`](more-atoms-not-bigger-atoms.md) — the
  ffmpeg scaling contract (capacity grows with atom COUNT).
