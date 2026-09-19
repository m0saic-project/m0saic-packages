export const PAGE_SKELETON_CAPTURE_FORMAT = "m0saic-page-skeleton" as const;
export const PAGE_SKELETON_CAPTURE_VERSION = 1 as const;

export const PAGE_SKELETON_RECT_KINDS = [
  "block",
  "text",
  "image",
  "control",
  "divider",
] as const;

export type PageSkeletonRectKind = (typeof PAGE_SKELETON_RECT_KINDS)[number];

export type PageSkeletonCaptureViewport = {
  w: number;
  h: number;
  dpr?: number;
};

export type PageSkeletonCaptureRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  k: PageSkeletonRectKind;
  r: number;
  d: number;
};

export type PageSkeletonCaptureMeta = {
  total: number;
  dropped: number;
};

export type PageSkeletonCapture = {
  format: typeof PAGE_SKELETON_CAPTURE_FORMAT;
  version: typeof PAGE_SKELETON_CAPTURE_VERSION;
  viewport: PageSkeletonCaptureViewport;
  rects: PageSkeletonCaptureRect[];
  meta?: PageSkeletonCaptureMeta;
};

const RECT_KIND_SET = new Set<string>(PAGE_SKELETON_RECT_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`page-skeleton capture: ${path} must be an object`);
  }
  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`page-skeleton capture: ${path} must be a finite integer`);
  }
  return value;
}

function expectPositiveInteger(value: unknown, path: string): number {
  const parsed = expectInteger(value, path);
  if (parsed < 1) {
    throw new Error(`page-skeleton capture: ${path} must be at least 1`);
  }
  return parsed;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  const parsed = expectInteger(value, path);
  if (parsed < 0) {
    throw new Error(`page-skeleton capture: ${path} must be at least 0`);
  }
  return parsed;
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`page-skeleton capture: invalid JSON — ${detail}`);
  }
}

function parseViewport(value: unknown): PageSkeletonCaptureViewport {
  const viewport = expectRecord(value, "viewport");
  const parsed: PageSkeletonCaptureViewport = {
    w: expectPositiveInteger(viewport.w, "viewport.w"),
    h: expectPositiveInteger(viewport.h, "viewport.h"),
  };

  if (viewport.dpr !== undefined) {
    if (
      typeof viewport.dpr !== "number" ||
      !Number.isFinite(viewport.dpr) ||
      viewport.dpr <= 0
    ) {
      throw new Error("page-skeleton capture: viewport.dpr must be a positive finite number");
    }
    parsed.dpr = viewport.dpr;
  }

  return parsed;
}

function parseRect(value: unknown, index: number): PageSkeletonCaptureRect {
  const path = `rects[${index}]`;
  const rect = expectRecord(value, path);
  const w = expectPositiveInteger(rect.w, `${path}.w`);
  const h = expectPositiveInteger(rect.h, `${path}.h`);

  let k: PageSkeletonRectKind = "block";
  if (rect.k !== undefined) {
    if (typeof rect.k !== "string") {
      throw new Error(`page-skeleton capture: ${path}.k must be a string`);
    }
    if (RECT_KIND_SET.has(rect.k)) {
      k = rect.k as PageSkeletonRectKind;
    }
  }

  const r =
    rect.r === undefined ? 0 : expectNonNegativeInteger(rect.r, `${path}.r`);
  const maxRadius = Math.floor(Math.min(w, h) / 2);
  if (r > maxRadius) {
    throw new Error(
      `page-skeleton capture: ${path}.r must be at most ${maxRadius} for a ${w}x${h} rect`,
    );
  }

  return {
    x: expectInteger(rect.x, `${path}.x`),
    y: expectInteger(rect.y, `${path}.y`),
    w,
    h,
    k,
    r,
    d: rect.d === undefined ? 0 : expectNonNegativeInteger(rect.d, `${path}.d`),
  };
}

function parseMeta(value: unknown): PageSkeletonCaptureMeta {
  const meta = expectRecord(value, "meta");
  return {
    total: expectNonNegativeInteger(meta.total, "meta.total"),
    dropped: expectNonNegativeInteger(meta.dropped, "meta.dropped"),
  };
}

/**
 * Read the browser-capture seam. Editors may provide either parsed JSON or a
 * raw JSON string, so this boundary normalizes both and rejects malformed
 * geometry before the renderer sees it.
 */
export function parseCapture(value: unknown): PageSkeletonCapture {
  const decoded = typeof value === "string" ? parseJsonString(value) : value;
  const capture = expectRecord(decoded, "payload");

  if (capture.format !== PAGE_SKELETON_CAPTURE_FORMAT) {
    throw new Error(
      `page-skeleton capture: format must be "${PAGE_SKELETON_CAPTURE_FORMAT}"`,
    );
  }
  if (capture.version !== PAGE_SKELETON_CAPTURE_VERSION) {
    throw new Error(
      `page-skeleton capture: version must be ${PAGE_SKELETON_CAPTURE_VERSION}`,
    );
  }
  if (!Array.isArray(capture.rects)) {
    throw new Error("page-skeleton capture: rects must be an array");
  }

  const parsed: PageSkeletonCapture = {
    format: PAGE_SKELETON_CAPTURE_FORMAT,
    version: PAGE_SKELETON_CAPTURE_VERSION,
    viewport: parseViewport(capture.viewport),
    rects: capture.rects.map(parseRect),
  };

  if (capture.meta !== undefined) {
    parsed.meta = parseMeta(capture.meta);
  }

  return parsed;
}
