# mosaic.schema.json

Official JSON Schema for `.mosaic` files.

This schema validates both:

- `kind: "mosaic_document"` (pure spatial renderable)
- `kind: "mosaic_pipeline"` (temporal composition of documents)

It mirrors the public TypeScript types defined in `@m0saic/types`.

> Source of truth:
> The canonical contract is the TypeScript types in this package.
> The JSON Schema exists for editor tooling, validation, and external integration.

---

## 📦 Location

```
packages/types/schemas/mosaic.schema.json
```

---

## 🧠 What It Validates

The schema validates:

- Root discriminator (`kind`)
- `version: 1`
- `MosaicConfig`
- Full `MosaicSource` union:
  - `media`
  - `text`
  - `mosaic`
  - `lavfi`
- Strict mutual exclusivity:
  - `lavfi` XOR `color`
  - pipeline step `file` XOR `ref`
- Editor metadata shapes
- Engine metadata shapes
- Placement / effects / overlay / playback props

It does **not** validate:

- The internal grammar of the `m0saic` DSL string  
  (that is handled by the runtime DSL validator)

---

## 🖥 Editor Integration (Cursor / VS Code)

Add this to your workspace `.vscode/settings.json`:

```json
{
  "files.associations": {
    "*.mosaic": "json"
  },
  "json.schemas": [
    {
      "fileMatch": ["*.mosaic"],
      "url": "./packages/types/schemas/mosaic.schema.json"
    }
  ]
}
```

This enables:

- Autocomplete
- Error squiggles
- Hover documentation
- Structural validation

---

## 🧪 CI / Runtime Validation (AJV Example)

You can validate `.mosaic` files in CI using AJV:

```ts
import Ajv from "ajv";
import schema from "@m0saic/types/schemas/mosaic.schema.json";

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

const valid = validate(mosaicFile);

if (!valid) {
  console.error(validate.errors);
  process.exit(1);
}
```

---

## 📚 Relationship to TypeScript Types

This schema mirrors:

- `MosaicDocument`
- `MosaicDocumentPipeline`
- `MosaicConfig`
- `MosaicSource`
- All associated prop types

If you change any public type shape in `@m0saic/types`,
you must update this schema accordingly.

Recommended workflow:

1. Update TypeScript types
2. Update schema
3. Validate sample `.mosaic` files
4. Publish `@m0saic/types`

---

## 🔒 Stability Policy

- `version: 1` is locked for backward compatibility.
- Breaking changes require a new schema version and new `version` discriminator.
- Minor additive fields should remain backward-compatible.

---

## 🏗 Why JSON Schema Exists

The TypeScript types already define the contract internally.

The JSON Schema exists to:

- Enable editor validation for `.mosaic`
- Allow external tools to validate files
- Support ecosystem integrations
- Provide machine-readable format documentation

It is intentionally strict (`additionalProperties: false` in most shapes)
to prevent silent typos and undefined behavior.