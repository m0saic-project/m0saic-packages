# contributor-table — reference layouts (GCD-collapsed)

The sandbox-approved table grid, GCD-collapsed (see the "GCD-collapse search" section of the internal precision-tiers notes).
Kept as REFERENCE (the live template generates an equivalent coarse layout); these document
the collapsed geometry + the safe minimum canvas at each complexity tier.

- `layout-standard.m0` — **0.6% drift · 2,928 chars · max 4px drift** · all gutters intact.
  STANDARD layout. Safe minimum canvas ≈ **128 × 118 px**.
- `layout-lite.m0` — **1.2% drift · 1,429 chars · max 8px drift** · column/row gaps collapse.
  LITE variant (lower complexity) for very small tiles. Safe minimum canvas ≈ **80 × 59 px**.

Source layout was ~11.5K chars (pack-only, no GCD). 2.0% drift (889 chars) was rejected — the
value-column gaps became inconsistent for too little extra savings over lite.
