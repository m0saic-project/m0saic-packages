import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicRenderableFile,
  MosaicXDocument,
} from "@m0saic/types";

/**
 * Browser-safe sibling of `absolutizeManifestPathsInPlace`
 * (`./loadMosaicDocument.ts`). That original uses `node:path` and is
 * deliberately excluded from the browser barrel; the web Compose editor
 * needs the same normalization at OPEN time (a `.mosaic`/`.mosaicx`/
 * pipeline opened from one directory and saved to another would
 * otherwise silently orphan its relative asset paths — the engine
 * absolutizes only at render time, in the Electron main process).
 *
 * Same contract as the node version, kept in lockstep:
 *   - mutates the input tree;
 *   - only `kind: "file"` asset entries with a non-empty RELATIVE path
 *     are rewritten; absolute paths, `url` / `data-uri` kinds untouched
 *     (which also makes the pass idempotent);
 *   - recurses `children` (mosaic / mosaicx / pipeline) and
 *     `pipeline.steps[].file`; `step.ref` is an external resolver key
 *     and is skipped.
 *
 * Path math is pure string work so it runs in the renderer. Paths come
 * from the host OS's own dialogs/drops, so both POSIX (`/…`) and
 * Windows (`C:\…`, `C:/…`, UNC `\\…`) absolute forms are recognized —
 * strictly wider than `path.isAbsolute`, which is locked to the
 * current platform.
 */
export function absolutizeManifestPathsWeb(
  renderable: MosaicRenderableFile,
  definitionFilePath: string,
): void {
  const baseDir = dirnameOfPath(definitionFilePath);
  if (!baseDir) return;
  visitRenderable(renderable, baseDir);
}

/** POSIX `/…`, Windows drive `C:\…` / `C:/…`, or UNC `\\server\…`. */
export function isAbsoluteFilePath(p: string): boolean {
  return /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(p);
}

function dirnameOfPath(filePath: string): string | null {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (idx <= 0) return null;
  return filePath.slice(0, idx);
}

/**
 * Join + normalize `.` / `..` segments against an absolute base dir,
 * emitting separators in the base dir's own style so a Windows-picked
 * file keeps Windows-shaped paths.
 */
function resolveAgainstDir(baseDir: string, relPath: string): string {
  const sep = baseDir.includes("\\") && !baseDir.includes("/") ? "\\" : "/";
  const stack = baseDir.split(/[\\/]/);
  // A POSIX base ("/a/b") splits to ["", "a", "b"] — the leading empty
  // segment preserves the root slash on rejoin.
  for (const seg of relPath.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // Never pop past the root (drive letter / leading empty segment).
      if (stack.length > 1) stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join(sep);
}

function visitRenderable(node: unknown, baseDir: string): void {
  if (node == null || typeof node !== "object") return;
  const kind = (node as { kind?: string }).kind;
  if (kind === "mosaic_document" || kind === "mosaicx_document") {
    visitMosaic(node as MosaicDocument | MosaicXDocument, baseDir);
  } else if (kind === "mosaic_pipeline" || kind === "mosaicx_pipeline") {
    // Same walk for the source form: a `mosaicx_pipeline`'s step files
    // carry the same asset manifests, resolved or not.
    visitPipeline(node as MosaicDocumentPipeline, baseDir);
  }
}

function visitMosaic(doc: MosaicDocument | MosaicXDocument, baseDir: string): void {
  const assets = (doc as { assets?: unknown }).assets;
  if (assets != null && typeof assets === "object" && !Array.isArray(assets)) {
    const map = assets as Record<string, unknown>;
    for (const id of Object.keys(map)) {
      const entry = map[id];
      if (
        entry != null &&
        typeof entry === "object" &&
        (entry as { kind?: string }).kind === "file"
      ) {
        const e = entry as { path?: unknown };
        if (
          typeof e.path === "string" &&
          e.path.length > 0 &&
          !isAbsoluteFilePath(e.path)
        ) {
          e.path = resolveAgainstDir(baseDir, e.path);
        }
      }
    }
  }

  const children = (doc as { children?: unknown }).children;
  if (children != null && typeof children === "object" && !Array.isArray(children)) {
    for (const child of Object.values(children as Record<string, unknown>)) {
      visitRenderable(child, baseDir);
    }
  }
}

function visitPipeline(pipe: MosaicDocumentPipeline, baseDir: string): void {
  const steps = (pipe as { steps?: unknown }).steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const file = (step as { file?: unknown })?.file;
      if (file != null) visitRenderable(file, baseDir);
      // step.ref is an external resolver key; resolved by caller.
    }
  }
}
