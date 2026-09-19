import type {
  MosaicTemplateProps,
  MosaicTemplatePropDefinition,
} from "@m0saic/types";

/**
 * Helper for defining strongly-typed propsSchema objects.
 *
 * Ensures:
 * - Every key in P has a MosaicTemplatePropDefinition
 * - "required" is always explicitly set (true or false)
 * - No extra or missing keys
 *
 * Usage:
 *   const propsSchema = definePropsSchema<MyProps>({
 *     title: { type: "string", required: true },
 *     color: { type: "string", required: false },
 *   });
 */
export function definePropsSchema<P extends MosaicTemplateProps>(
  schema: Record<keyof P, MosaicTemplatePropDefinition>
): Record<keyof P, MosaicTemplatePropDefinition> {
  return schema;
}