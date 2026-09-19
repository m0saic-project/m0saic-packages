import type {
  MosaicDocument,
  MosaicTextSource,
  MosaicTextLayer,
  MosaicColor,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";

function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "?");
}

function wrapLines(msg: string, maxCols: number): string[] {
  const words = msg.replace(/\r\n/g, "\n").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxCols) line = next;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function truncateLine(s: string, maxCols: number): string {
  if (s.length <= maxCols) return s;
  if (maxCols <= 3) return s.slice(0, maxCols);
  return s.slice(0, maxCols - 3) + "...";
}

export function makeErrorMosaic(
  message: string,
  opts: {
    width: number;
    height: number;
    title?: string;
    backgroundColor?: MosaicColor;
    textColor?: MosaicColor;

    /** Optional machine-ish code for UI/debug */
    errorCode?: string;
  }
): MosaicDocument {
  const W = opts.width;
  const H = opts.height;

  const title = opts.title ?? "Template Error";
  const bg = opts.backgroundColor ?? "#000000";
  const fg = opts.textColor ?? "#ffffff";

  // Font sizes scale with the frame — and are capped by its HEIGHT too, so a
  // tiny or squat canvas (a 64×64 data-carrier tile, a 1920×64 strip) still
  // gets a card whose lines fit instead of 16px type stacked over itself.
  // Make previews scale the canvas up to the stage, so proportional type
  // reads fine there; the old 16/12px floors were the overlap seen on
  // repo-facts-fetcher at 64×64 (founder, 2026-09-13).
  // The width clamp (16..40 / 12..22) is the legible floor for ordinary
  // canvases and is unchanged there; the height cap only bites below ~130px
  // tall, where the floor itself was the bug.
  const titleFont = Math.max(4, Math.min(clamp(Math.round(W / 22), 16, 40), Math.round(H * 0.14)));
  const bodyFont = Math.max(3, Math.min(clamp(Math.round(W / 34), 12, 22), Math.round(H * 0.09)));

  // vertical layout — the body starts BELOW the title's own line box, never
  // at a fixed fraction the title can grow past. (0.18 is the historical
  // start and still wins on every canvas the cap doesn't touch.)
  const titleY = 0.06;
  const bodyStartY = Math.max(0.18, (titleY * H + titleFont * 1.25) / H);

  // derive wrapping + line budget from frame + font
  const maxCols = clamp(Math.floor((W * 0.88) / (bodyFont * 0.62)), 8, 140);
  const lineHeightPx = bodyFont * 1.25;
  // 0.74·H when the body starts at 0.18 (the historical budget); less when
  // the title pushed the body down.
  const usableHeightPx = Math.max(0, H * (1 - bodyStartY - 0.08));
  const maxLines = clamp(Math.floor(usableHeightPx / lineHeightPx), 1, 24);

  const lines = wrapLines(message.trim(), maxCols)
    .map((l) => truncateLine(l, maxCols))
    .slice(0, maxLines);

  const stepY = lineHeightPx / H; // fraction per line

  const layers: MosaicTextLayer[] = [];

  layers.push({
    content: { kind: "literal", text: asciiOnly(`ERROR: ${title}`) },
    style: { fontSize: titleFont, fontColor: fg } as any,
    placement: {
      hAlign: "left",
      vAlign: "top",
      xExpr: "w*0.06",
      yExpr: `h*${titleY}`,
    } as any,
  });

  for (let i = 0; i < lines.length; i++) {
    layers.push({
      content: { kind: "literal", text: asciiOnly(lines[i]) },
      style: { fontSize: bodyFont, fontColor: fg } as any,
      placement: {
        hAlign: "left",
        vAlign: "top",
        xExpr: "w*0.06",
        yExpr: `h*${(bodyStartY + i * stepY).toFixed(6)}`,
      } as any,
    });
  }

  const src: MosaicTextSource = {
    type: "text",
    visual: { backgroundColor: bg },
    layers,

    // ✅ engine-marked failure: UI can disable Make deterministically
    engine: {
      renderStatus: "error",
      renderError: {
        message: `${title}: ${message}`.trim(),
        code: opts.errorCode,
      },
    },
  };

  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: toM0String("F", "makeErrorMosaic"),
    sources: [src],
    // Boundary law (gate 28): a root document always carries its canvas.
    size: { width: W, height: H },
    // Error cards have no soundtrack by definition. Without this, an error
    // doc rendered as VIDEO (the CLI honors the user's -o .mp4) inherits
    // the plan's anullsrc silence default and ships a silent audio track —
    // the gate-20 class through the error path (caught on search-typing at
    // gate 27, fixed fleet-wide here at gate 28).
    audio: { mode: "off" },
  };
}
