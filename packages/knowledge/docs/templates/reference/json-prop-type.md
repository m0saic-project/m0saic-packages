# The `"json"` prop type + typed-output templates

Two additive capabilities that unblock structured-config props and typed
data-fetcher templates. Both are **shipped and current** — verified against
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts, https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template,
and `validateTemplateProps`.

---

## 1. `type: "json"`

`"json"` is a member of `MosaicTemplatePropType`, alongside the string / number /
boolean / media / structural (`group`, `list`) and m0-family (`m0`, `m0c`, `m0p`)
entries.

### When to reach for it

Use `"json"` when a prop's value is a **structured object or array that maps to a
TypeScript interface**:

- `filter` / `sceneFilter` — a remote API's filter input passed wholesale
- `{ low, high, mode }` clip-duration configs
- `Array<MosaicTimeRangeMs>` — the multi-range clip seam (see §3)
- Per-tile decoration bundles

**Don't** use it for:

| Instead of `"json"` | Use |
|---|---|
| a primitive that merely *looks* like JSON stringified | `"string"` / `"number"` / `"boolean"` |
| an array of primitives | `"string[]"` / `"number[]"` |
| a media reference | `"media"` |
| a fixed set of named sub-fields you want as individual controls | `"group"` with `fields` |

That last row is the common mistake: a `"group"` **without** `fields` degrades to a
raw JSON bag in the editor, which is strictly worse than declaring `"json"` on
purpose.

### Validator behavior — permissive by design

`validateTemplateProps` accepts **any non-undefined value** when `type === "json"`.
The engine boundary does not parse, shape-check, or reject. That is deliberate:
editors may deliver an already-parsed object *or* a raw JSON string, and both are
legal at the boundary.

**Consequence for template authors:** render-time parsing and shape-checking is
**your** job. Call `JSON.parse` if the editor handed you a string, then validate
however you like (Zod, Ajv, hand-rolled). Do not assume you received an object.

There is intentionally no `JSON_PROP_SCHEMA_MISMATCH` diagnostic. If shape drift
becomes a recurring failure mode, wiring one up would be additive.

### `meta.constraints.jsonSchema` — an editor hint, never a gate

Optional, two forms:

| Form | Meaning |
|---|---|
| `{ ref: "<host-resolved-id>" }` | Points into a shared JSON-schema registry the host owns. Use when several templates share a payload shape. |
| inline `Record<string, unknown>` | A JSON-Schema-ish object describing the payload. |

Editors that understand the schema may render a structured form; those that don't
fall back to a plain code editor. **The engine never validates this field.**

### ⚠️ `as never` is NOT required — and existing casts are stale

Several shipped templates write `type: "json" as never`
(`charts/bar-graph/v1` + `v2`, `charts/line-chart/v1`, `internal/bars-stack`). **The
cast is unnecessary.** Those are leftovers from before `"json"` joined the union.

`definePropsSchema<P>` is typed as `Record<keyof P, MosaicTemplatePropDefinition>` —
it constrains only the *key set*, never the relationship between a prop's TS type and
its declared `type`. So this compiles clean, no casts:

```ts
type P = { barColor?: string | string[]; spec: Record<string, unknown> };

const propsSchema = definePropsSchema<P>({
  barColor: { type: "json", required: false },
  spec:     { type: "json", required: true },
});
```

(Verified 2026-07-26 with the repo's own `tsc -p https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/tsconfig.json.)
`brand/qr-stamp/video/v2` (`luminanceBuckets`) is the correct, cast-free reference.

**Do not copy the `as never` pattern into new templates**, and drop it opportunistically
when you touch one of the offenders. The same goes for the neighbouring
`type: "group" as any` casts — check whether they're still load-bearing before
propagating them.

---

## 2. The 5-generic `defineMosaicTemplate`

`MosaicTemplate` has carried 5 generics for a while; the helper now matches:

```ts
defineMosaicTemplate<
  P extends MosaicTemplateProps,
  O extends MosaicTemplateOutputs         = MosaicTemplateOutputs,
  U extends MosaicTemplateUpstreamVariables = MosaicTemplateUpstreamVariables,
  D extends MosaicTemplateUpstreamData    = MosaicTemplateUpstreamData,
  S extends MosaicTemplateSidecars        = MosaicTemplateSidecars,
>(template: MosaicTemplate<P, O, U, D, S>): MosaicTemplate<P, O, U, D, S>
```

Defaults preserve full back-compat — every existing 1-generic call site still
compiles unchanged.

**Use the full form when** your template (1) publishes typed outputs via
`outputsSchema`, (2) publishes typed sidecars via `sidecarsSchema`, or (3) reads
`ctx.upstreamData.<alias>` and wants type-checked access. Otherwise stay on
`defineMosaicTemplate<P>` — it remains the recommendation for ordinary renderables.

### Gotcha — don't narrow `U` / `D` to an empty shape

A fetcher that reads no upstream is tempted to tighten `U` / `D` to
`Record<string, never>`. **Don't.** `registerTemplate` accepts only the loose form
(`Record<string, unknown>`), and narrowing reverses contravariance — TS rejects the
registration.

Pass the loose defaults explicitly for `U` and `D`; tighten only `O` and `S`.
Consumer templates that *do* read upstream are the right place to tighten `U` / `D`,
because there the context is an **input** to the bound, not an output.

```ts
export const RepoFetcher = defineMosaicTemplate<
  Props,
  Outputs,
  MosaicTemplateUpstreamVariables,  // loose — narrowing breaks registerTemplate
  MosaicTemplateUpstreamData,       //   (contravariance)
  Sidecars
>({
  id: asTemplateId("@example/github/repo-fetcher/v1"),
  role: "data-fetcher",
  capabilities: { tier: "capability", caps: { net: { fetch: true } } },
  propsSchema: {
    apiUrl:   { type: "string", required: true },
    tokenRef: { type: "string", required: false },
    filter: {
      type: "json",
      required: false,
      meta: { constraints: { jsonSchema: { ref: "@example/repo-filter/v1" } } },
    },
  },
  defaultProps: { apiUrl: "https://api.github.com" },
  async render(props, ctx) { /* … */ },
});
```

---

## 3. Cross-references

- **Data-fetcher pattern** — `../data-pipeline.md`. The five-generic
  `defineMosaicTemplate<Props, Outputs, …, Sidecars>` signature its fetcher contract
  relies on was aspirational when first documented; it is valid TypeScript today.
- **Multi-range clip picker** — `picker: "time-ranges"` is declared on a **single**
  `type: "json"` prop whose value is `Array<MosaicTimeRangeMs>`
  (`{ startMs, endMs, label? }`, integer ms, source-relative, sorted ascending;
  overlaps allowed, empty array = no selection). Unlike the paired `"time-range"`
  picker there is no prop pairing — the editor reads and writes the whole array
  through that one prop in a single write. Boundary reader:
  `parseTimeRangesValue` in `template-utils/src/media/timeRanges.ts` — use it rather
  than hand-parsing, precisely because the value may arrive as object *or* string.
- **Prop-shape consistency** — `npm run audit:props` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates emits
  `PROPS-SHAPE.md`, a cross-template prop-shape matrix. Run it after adding a
  `"json"` prop to see how the shelf compares.
