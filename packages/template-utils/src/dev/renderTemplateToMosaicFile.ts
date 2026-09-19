/**
 * ============================================================================
 * renderTemplateToMosaicFile — Dev Authoring Loop
 * ============================================================================
 *
 * Renders ANY registered template to a `.mosaic` JSON file on disk so you can
 * iterate on templates (including internal sub-templates via injection) and
 * then render the resulting `.mosaic` with the normal m0saic CLI.
 *
 * WORKFLOW:
 *   1. Author / edit template code.
 *   2. Call this helper (or the CLI tool) to materialize a .mosaic file.
 *   3. Run `m0saic make <out.mosaic>` to produce the final media.
 *
 * WRAPPER MODE (opts.wrap):
 *   Wraps the rendered doc under a simple 2-row layout so you get a title bar
 *   above the template output — useful for visual debugging.
 *
 * DEV INJECTION (opts.injectChildren):
 *   Allows dev-time injection of child renderables into the returned
 *   MosaicDocument. This exists to satisfy LOCAL-ONLY ref resolution
 *   for internal component templates (e.g., ChartFrame → plot-area).
 *
 *   Engine semantics remain unchanged:
 *     - The engine resolves `{ type: "mosaic", ref }` only against
 *       `doc.children[ref]` of the CURRENT document.
 *
 *   This helper merely injects children explicitly before writing the file.
 *
 * DEV WARNINGS (opts.warnOnMissingRefs):
 *   Detects and warns when the produced document contains unresolved
 *   `{ type: "mosaic", ref }` sources that are missing from `doc.children`.
 *   This is the most common failure mode when previewing internal components.
 *
 * STYLE NOTE:
 *   You prefer `config` (sources) to appear before `children` in serialized JSON.
 *   JS preserves insertion order for object keys, so we construct objects
 *   in the desired order wherever we rebuild docs.
 *
 * ============================================================================
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import type {
  MosaicConnectionResolver,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSecretResolver,
  MosaicTemplate,
  MosaicDocumentPipeline,
  MosaicTextSource,
} from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "@m0saic/platform/paths";

// `MosaicTemplateRenderCache` used to be exported from `@m0saic/types`; the
// type-redesign dropped the public surface (the engine context no longer
// exposes a `cache` field). Re-define the dev-time cache shape locally.
type MosaicTemplateRenderCache = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T>;
};
import { toM0String } from "@m0saic/dsl-stdlib";

import { getTemplate } from "../template/templateRegistry";
import { makeErrorMosaic } from "../sources/makeErrorMosaic";
import { renderNestedTemplate } from "../render/renderNestedTemplate";

// ---------------------------------------------------------------------------
// Dev Injection Types
// ---------------------------------------------------------------------------

/**
 * Injection spec for dev-only child resolution.
 *
 * Value may be:
 *   - A literal MosaicDocument / MosaicDocumentPipeline
 *   - A { templateId, props } spec to render and inject
 */
export type InjectRenderable =
  | MosaicDocument
  | MosaicDocumentPipeline
  | {
    templateId: string;
    props?: any;
  };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type RenderToFileOpts = {
  /** Output path for the .mosaic JSON file. */
  outPath: string;

  width?: number;
  height?: number;
  fps?: number;
  durationMs?: number;

  wrap?: boolean;
  wrapTitle?: string;

  /**
   * DEV-ONLY:
   * Inject children into returned MosaicDocument to satisfy local-only refs.
   */
  injectChildren?: Record<string, InjectRenderable>;

  /**
   * If true, recursively inject into nested MosaicDocuments.
   * Default: false
   */
  injectChildrenDeep?: boolean;

  /**
   * DEV-ONLY:
   * Warn if the produced document contains unresolved `{ type: "mosaic", ref }`
   * sources that are missing from the local `children` map.
   *
   * Default: true
   */
  warnOnMissingRefs?: boolean;

  /**
   * DEV-ONLY:
   * Optional warning sink. If unset, warnings go to console.warn.
   */
  onWarn?: (message: string) => void;

  /**
   * Optional secret resolver threaded onto the dev ctx — lets
   * capability-tier templates (fetchers) be exercised through the dev
   * authoring loop. Typically `createEnvSecretResolver()` from
   * `@m0saic/platform/secrets`. Unset → `ctx.secrets` stays absent,
   * matching prior behavior.
   */
  secrets?: MosaicSecretResolver;

  /**
   * Optional connection resolver threaded onto the dev ctx (see
   * `@m0saic/platform/host-connections`). Unset → `ctx.connections`
   * stays absent.
   */
  connections?: MosaicConnectionResolver;
};

// ---------------------------------------------------------------------------
// Dev context builder
// ---------------------------------------------------------------------------

function buildDevCache(): MosaicTemplateRenderCache {
  const store = new Map<string, unknown>();
  return {
    get<T = unknown>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): void {
      store.set(key, value);
    },
    async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
      if (store.has(key)) return store.get(key) as T;
      const val = await compute();
      store.set(key, val);
      return val;
    },
  };
}

function buildDevCtx(
  template: MosaicTemplate<any>,
  opts: RenderToFileOpts,
): MosaicEngineContext {
  const hints = template.outputHints ?? {};

  const width = opts.width ?? hints.width ?? 1920;
  const height = opts.height ?? hints.height ?? 1080;
  const fps = opts.fps ?? hints.fps ?? 30;
  const durationMs = opts.durationMs ?? hints.durationMs ?? 2000;

  const workspaceDir = path.join(os.tmpdir(), `${M0SAIC_TMP_PREFIX}dev-render`);

  return {
    mode: "render",
    output: { width, height, fps, durationMs, workspaceDir },
    target: { width, height, fps, durationMs },
    media: {},
    ...(opts.secrets !== undefined ? { secrets: opts.secrets } : {}),
    ...(opts.connections !== undefined ? { connections: opts.connections } : {}),
    // Cache is engine-internal post-redesign; attach via intersection.
    cache: buildDevCache(),
  } as MosaicEngineContext & { cache: MosaicTemplateRenderCache };
}

// ---------------------------------------------------------------------------
// Dev Injection Helpers
// ---------------------------------------------------------------------------

async function materializeInjectedChildren(
  inject: Record<string, InjectRenderable>,
  ctx: MosaicEngineContext,
): Promise<Record<string, MosaicDocument | MosaicDocumentPipeline>> {
  const out: Record<string, MosaicDocument | MosaicDocumentPipeline> = {};

  for (const [ref, spec] of Object.entries(inject)) {
    if (!spec) continue;

    // Already concrete renderable
    if (
      (spec as any).kind === "mosaic_document" ||
      (spec as any).kind === "mosaic_pipeline"
    ) {
      out[ref] = spec as any;
      continue;
    }

    // Template spec → render it
    const { templateId, props } = spec as {
      templateId: string;
      props?: any;
    };

    const rendered = await renderNestedTemplate(templateId, props ?? {}, ctx);
    out[ref] = rendered as any;
  }

  return out;
}

/**
 * Rebuild a MosaicDocument in a stable, preferred key order:
 *   kind, version, m0, config, children, editor, engine, ...rest
 *
 * NOTE:
 *   We preserve any extra top-level fields by spreading them at the end.
 *   If you never add extras beyond editor/engine, this is still safe.
 */
function rebuildDocPreferredOrder(input: MosaicDocument): MosaicDocument {
  const {
    kind,
    version,
    m0,
    sources,
    outputs,
    assets,
    children,
    editor,
    engine,
    ...rest
  } = input as any;

  const out: any = {
    kind,
    version,
    m0,
    assets,
    sources,
    outputs,
    children,
    editor,
    engine,
    ...rest,
  };

  // Remove undefined keys to avoid noisy JSON (optional, but keeps output clean)
  if (out.children === undefined) delete out.children;
  if (out.editor === undefined) delete out.editor;
  if (out.engine === undefined) delete out.engine;

  return out as MosaicDocument;
}

function injectIntoDoc(
  doc: MosaicDocument,
  injected: Record<string, MosaicDocument | MosaicDocumentPipeline>,
): MosaicDocument {
  // Merge children, but rebuild in preferred key order (config before children)
  const merged: MosaicDocument = {
    ...doc,
    children: {
      ...(doc.children ?? {}),
      ...injected,
    },
  };

  return rebuildDocPreferredOrder(merged);
}

function injectDeep(
  node: MosaicDocument | MosaicDocumentPipeline,
  injected: Record<string, MosaicDocument | MosaicDocumentPipeline>,
): MosaicDocument | MosaicDocumentPipeline {
  if (!node || typeof node !== "object") return node;

  if ((node as any).kind === "mosaic_document") {
    const d = node as MosaicDocument;

    // Recurse into child MosaicDocuments only
    const nextChildren: Record<string, any> = {};
    for (const [k, v] of Object.entries(d.children ?? {})) {
      nextChildren[k] = injectDeep(v as any, injected);
    }

    const merged: MosaicDocument = {
      ...d,
      children: {
        ...nextChildren,
        ...injected,
      },
    };

    return rebuildDocPreferredOrder(merged);
  }

  return node;
}

// ---------------------------------------------------------------------------
// Dev Warning: Missing local refs
// ---------------------------------------------------------------------------

type MissingRef = {
  /** Path to the document in the tree (for debugging). */
  docPath: string;
  /** The missing ref key. */
  ref: string;
};

function extractMosaicRefsFromSources(doc: MosaicDocument): string[] {
  const sources = doc.sources;
  if (!Array.isArray(sources)) return [];

  const refs: string[] = [];
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    if ((s as any).type === "mosaic") {
      const ref = (s as any).ref;
      if (typeof ref === "string" && ref.length > 0) refs.push(ref);
    }
  }
  return refs;
}

function findMissingLocalRefs(root: MosaicDocument, rootLabel: string): MissingRef[] {
  const missing: MissingRef[] = [];

  function visit(doc: MosaicDocument, docPath: string): void {
    const refs = extractMosaicRefsFromSources(doc);
    const children = doc.children ?? {};

    for (const ref of refs) {
      if (!(ref in children)) {
        missing.push({ docPath, ref });
      }
    }

    for (const [key, child] of Object.entries(children)) {
      if (child && typeof child === "object" && (child as any).kind === "mosaic_document") {
        visit(child as MosaicDocument, `${docPath} -> children["${key}"]`);
      }
    }
  }

  visit(root, rootLabel);
  return missing;
}

function formatMissingRefsWarning(templateId: string, missing: MissingRef[]): string {
  const byPath = new Map<string, string[]>();
  for (const m of missing) {
    const arr = byPath.get(m.docPath) ?? [];
    arr.push(m.ref);
    byPath.set(m.docPath, arr);
  }

  const lines: string[] = [];
  lines.push(`[m0saic][dev] Unresolved local mosaic refs while rendering "${templateId}".`);
  lines.push(`These refs appear in a document's sources but are missing from that same document's children map.`);
  lines.push(`Fix: injectChildren at the correct ownership level (or wire children in the template graph).`);
  lines.push("");

  for (const [docPath, refs] of byPath.entries()) {
    const unique = Array.from(new Set(refs));
    lines.push(`- ${docPath}`);
    for (const r of unique) lines.push(`  - missing ref: "${r}"`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function renderTemplateToMosaicFile<TProps>(
  templateId: string,
  props: TProps,
  opts: RenderToFileOpts,
): Promise<{ outPath: string }> {
  const template = getTemplate(templateId);

  if (!template) {
    const errDoc = makeErrorMosaic(
      `Template "${templateId}" not found in registry.`,
      { title: "Template Not Found", width: 1920, height: 1080 },
    );

    const outPath = path.resolve(opts.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(errDoc, null, 2), "utf8");
    return { outPath };
  }

  const ctx = buildDevCtx(template, opts);

  let result: MosaicRenderableFile;

  try {
    result = await template.render(props as any, ctx);
  } catch (err: any) {
    result = makeErrorMosaic(
      `Template render threw: ${String(err?.message ?? err)}`,
      { title: templateId, width: ctx.output.width, height: ctx.output.height },
    );
  }

  // Normalize: extract a MosaicDocument (pipelines written directly).
  let doc: MosaicDocument;

  if (result.kind === "mosaic_document") {
    doc = result as MosaicDocument;
  } else {
    // Pipeline — write directly; wrapper not supported.
    const outPath = path.resolve(opts.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
    return { outPath };
  }

  // Ensure durationMs + fps land on the doc (for CLI consumption).
  // Post-flatten: render config lives flat on the doc.
  doc = rebuildDocPreferredOrder({
    ...doc,
    durationMs: doc.durationMs ?? ctx.target.durationMs,
    fps: doc.fps ?? ctx.target.fps,
  });

  // -------------------------------------------------------------------------
  // DEV CHILD INJECTION
  // -------------------------------------------------------------------------

  if (opts.injectChildren && Object.keys(opts.injectChildren).length > 0) {
    const injected = await materializeInjectedChildren(opts.injectChildren, ctx);

    doc = opts.injectChildrenDeep
      ? (injectDeep(doc, injected) as MosaicDocument)
      : injectIntoDoc(doc, injected);
  }

  // -------------------------------------------------------------------------
  // DEV WARNING: Missing local refs
  // -------------------------------------------------------------------------

  const warnOnMissingRefs = opts.warnOnMissingRefs ?? true;
  if (warnOnMissingRefs) {
    const missing = findMissingLocalRefs(doc, `root("${templateId}")`);
    if (missing.length > 0) {
      const msg = formatMissingRefsWarning(templateId, missing);
      (opts.onWarn ?? console.warn)(msg);
    }
  }

  // -------------------------------------------------------------------------
  // Optional Wrapper (DEV)
  // -------------------------------------------------------------------------
  //
  // Wrapper is NOT a layout. It must not change the template's geometry.
  // We render the template full-canvas, then paint a debug title as an overlay.
  //
  // Implementation: F{F}
  // - Base F: "inner" (the real template output)
  // - Overlay F: a text source positioned as a thin top banner via overlay exprs
  //
  // This avoids brittle weighted-split DSL and keeps nested mosaics deterministic.

  if (opts.wrap) {
    const title = opts.wrapTitle ?? templateId;

    // Banner height: ~5–6% of 1080p (≈64px). Expressed tile-relative for portability.
    // Use 0.06 by default; you can tune later.
    const BANNER_H = 0.06;

    doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F{F}", "renderTemplateToMosaicFile/wrapper"),
      durationMs: ctx.target.durationMs,
      fps: ctx.target.fps,
      sources: [
          // Base: the full-canvas template output
          { type: "mosaic", ref: "inner" },

          // Overlay: debug title, clipped to a thin top band.
          // NOTE: This assumes your overlay pipeline supports:
          // - xExpr/yExpr offsets (tile-local)
          // - enable
          // If you don't have clip/crop yet, we still place it near the top and
          // rely on small font size/padding; adding a crop mask is optional later.
          {
            type: "text",
            style: {
              fontSize: 24,
              fontColor: "#9ca3af",
              fontFamily: "Arial, sans-serif",
            },
            layers: [{ content: { kind: "literal", text: title } }],
            // Keep the text render transparent; we are overlaying it.
            visual: { backgroundColor: "#00000000" },

            // Placement within its own rendered buffer doesn't matter much if you
            // position via overlay exprs; keep it simple.
            placement: { hAlign: "center", vAlign: "top" },

            // Overlay mechanics: position into a top banner region.
            // We are overlaying onto the *full-canvas* base.
            overlay: {
              xExpr: "0",
              // Small top inset: 1% of H (tune as desired)
              yExpr: "H*0.01",
              enable: "1", // always on
            },
          } as MosaicTextSource,
        ],
      children: { inner: doc },
    };
  }

  const outPath = path.resolve(opts.outPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2), "utf8");

  return { outPath };
}