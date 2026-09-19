// IMPORTANT: side-effect import that registers all templates
import "./m0saic";

// Re-export registry helpers
export {
  requireTemplate,
  getTemplate,
  listRegisteredTemplateIds,
} from "@m0saic/template-utils";

// Optional: still export template modules/types
export * from "./m0saic";
export * from "./repo";
// Which ids the BROWSER entry registers (node-only reader of web-template-ids.json).
export * from "./webTemplateIds";
