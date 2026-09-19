# mosaic.schema.json – Dev Notes

Schema last manually derived: 2026-02-25

The JSON Schema is derived from the public TypeScript types in this package,
primarily:

- mosaic-document.ts
- mosaic-source.ts
- mosaic-config.ts
- mosaic-document-pipeline.ts
- meta/*.ts
- colors/mosaicColor.ts

The TypeScript types are the canonical contract.
The JSON Schema mirrors those types for editor validation and external tooling.

---

## ⚠️ IMPORTANT

If ANY exported public type in @m0saic/types changes shape,
the schema must be reviewed and potentially regenerated.

This includes:
- Adding/removing fields
- Changing discriminated unions
- Changing enums
- Adding new source types
- Changing metadata shape

Failure to update the schema may result in:
- Editor accepting invalid files
- Editor rejecting valid files
- Ecosystem drift between TS and JSON

---

## Launch Checklist

Before a public release:

1. Review all changes in @m0saic/types
2. Diff against mosaic.schema.json
3. Re-derive schema if necessary
4. Validate sample .mosaic files
5. Commit with updated "Schema last manually derived" date

---

## Future Improvement (Optional)

Automate schema generation from TypeScript types to prevent drift.

Options:
- ts-json-schema-generator
- custom build script
- CI check that validates sample files against schema

For now, schema is manually maintained by design.