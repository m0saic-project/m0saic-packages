import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { alignedPhotoRect, pieceAxisFor, pieceBeatBudget, pieceBeatLayout, roundRect, zoomFitCap, zoomPartitionCap } from "./reveal";
import { frameLayout, tileRectInStage } from "./pipeline";
import { autoZoomForTile } from "./camera";
import { readImageSize } from "./imageSize.node";

describe("reveal alignment", () => {
  const tile = { x: 1738, y: 1176, width: 350, height: 238 }; // the root tile at 4K (stage 3840×1966)
  const stage = { stageW: 3840, stageH: 1966 };
  const image = { width: 900, height: 900 };
  const focus = { x: 0.5, y: 0.443 };

  it("at zoom Z the tile's crop window is exactly the tile, magnified and centred", () => {
    const Z = 4;
    const r = alignedPhotoRect({ tile, ...stage, zoom: Z, image, focus });
    // The photo covers the tile by WIDTH (square into a wide tile): scaled 350² → 1400² on the frame.
    expect(r.width).toBeCloseTo(350 * Z);
    expect(r.height).toBeCloseTo(350 * Z);
    // The tile's window sits centred on the stage; the photo's crop offset puts the tile inside it at focus.y.
    const tileOnFrame = { x: stage.stageW / 2 - (tile.width * Z) / 2, y: stage.stageH / 2 - (tile.height * Z) / 2 };
    expect(r.x).toBeCloseTo(tileOnFrame.x);
    expect(r.y).toBeCloseTo(tileOnFrame.y - (350 - 238) * focus.y * Z);
  });

  it("zoom 1 = no camera: the photo sits over the tile at the mark's scale", () => {
    const r = alignedPhotoRect({ tile, ...stage, zoom: 1, image, focus });
    expect(r.x).toBeCloseTo(tile.x);
    expect(r.width).toBeCloseTo(350);
  });

  it("zoomFitCap keeps the whole original inside the stage with margin", () => {
    const cap = zoomFitCap({ tile, ...stage, image, focus, maxZoom: 4, margin: 80 });
    expect(cap).toBe(4); // 1400² fits in 3840×1966
    const wide = { x: 1000, y: 800, width: 900, height: 450 }; // a 2:1 tile: the square original is 900² per Z
    const capped = zoomFitCap({ tile: wide, ...stage, image, focus: { x: 0.5, y: 0.5 }, maxZoom: 4, margin: 80 });
    expect(capped).toBeLessThan(4);
    const r = alignedPhotoRect({ tile: wide, ...stage, zoom: capped, image, focus: { x: 0.5, y: 0.5 } });
    expect(r.y).toBeGreaterThanOrEqual(80 - 1);
    expect(r.y + r.height).toBeLessThanOrEqual(stage.stageH - 80 + 1);
  });

  it("roundRect keeps even sides; the piece beat parks the photo left and fits the piece right", () => {
    expect(roundRect({ x: 10.4, y: 3.6, width: 101, height: 33 })).toEqual({ x: 10, y: 4, width: 102, height: 34 });
    const photo = { x: 1220, y: 300, width: 1400, height: 1400 };
    const l = pieceBeatLayout({ frameW: 3840, frameH: 2160, photo, piece: { width: 544, height: 544 } });
    expect(l.axis).toBe("x");
    expect(l.parkedX).toBe(97);
    expect(l.parkedY).toBe(300); // a pure horizontal slide: y untouched
    expect(l.dx).toBe(97 - 1220);
    expect(l.dy).toBe(0);
    expect(l.pieceRect.x).toBeGreaterThanOrEqual(97 + 1400 + l.gap);
    expect(l.pieceRect.width).toBe(l.pieceRect.height); // square piece stays square
    expect(l.pieceRect.x + l.pieceRect.width).toBeLessThanOrEqual(3840 - 97);
    const tall = pieceBeatLayout({ frameW: 3840, frameH: 2160, photo, piece: { width: 1080, height: 1920 } });
    expect(tall.pieceRect.height).toBe(2160 - 2 * 97);
  });

  it("a photo too wide to share the width parks at the top and the piece takes the height below (pure vertical slide)", () => {
    const b = pieceBeatBudget(3840, 2160);
    const photo = { x: 400, y: 700, width: b.photoMaxW + 200, height: 600 };
    const l = pieceBeatLayout({ frameW: 3840, frameH: 2160, photo, piece: { width: 1920, height: 1080 } });
    expect(l.axis).toBe("y");
    expect(l.parked).toEqual({ ...photo, y: b.margin });
    expect(l.dx).toBe(0);
    expect(l.dy).toBe(b.margin - 700);
    expect(l.pieceRect.y).toBeGreaterThanOrEqual(b.margin + 600 + b.gap);
    expect(l.pieceRect.y + l.pieceRect.height).toBeLessThanOrEqual(2160 - b.margin);
    expect(l.pieceRect.height).toBeGreaterThanOrEqual(b.pieceMinH - 2);
  });

  it("the old failure is now a throw, never an overlap: a photo with no room on either axis is refused", () => {
    const b = pieceBeatBudget(3840, 2160);
    const photo = { x: 0, y: 0, width: b.photoMaxW + 2, height: b.photoMaxH + 2 };
    expect(pieceAxisFor(photo, b)).toBeNull();
    expect(() => pieceBeatLayout({ frameW: 3840, frameH: 2160, photo, piece: { width: 544, height: 544 } })).toThrow(/no room/);
  });

  /**
   * THE CONTRACT, exhaustively: for every tile of the M, on every frame the
   * template ships at (and the phone/square ones), for originals from 1:4
   * portrait to 4:1 panorama at every focus corner, and for every canvas
   * aspect — the partition cap finds a zoom, the parked photo and the piece
   * are separated by the gap, the piece sits inside the frame, and its area
   * on the partition axis is at least the legibility floor. ~13k layouts, pure math.
   */
  it("piece-beat partition holds for every tile × frame × original aspect × focus × piece aspect", () => {
    const frames = [
      [3840, 2160], [1920, 1080], [1280, 720], [1080, 1080], [1080, 1920], [640, 360], [360, 640],
    ] as const;
    const aspects = [0.25, 0.5, 2 / 3, 1, 1.5, 2, 4];
    const focuses = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1, y: 0 }];
    const pieces = [{ width: 1920, height: 1080 }, { width: 1080, height: 1080 }, { width: 1080, height: 1920 }];
    let checked = 0;
    for (const [frameW, frameH] of frames) {
      const layout = frameLayout(frameW, frameH);
      const b = pieceBeatBudget(frameW, frameH);
      const margin = Math.round(layout.stageH * 0.04);
      for (let tileIndex = 0; tileIndex < 33; tileIndex++) {
        const tile = tileRectInStage(tileIndex, layout);
        const want = autoZoomForTile(tile, frameW, layout.stageH);
        for (const ar of aspects) {
          const image = ar >= 1 ? { width: Math.round(1000 * ar), height: 1000 } : { width: 1000, height: Math.round(1000 / ar) };
          for (const focus of focuses) {
            const zoom = zoomPartitionCap({ tile, stageW: frameW, stageH: layout.stageH, frameW, frameH, image, focus, maxZoom: want, margin });
            expect(zoom).toBeGreaterThanOrEqual(1.02);
            expect(zoom).toBeLessThanOrEqual(want);
            const aligned = roundRect(alignedPhotoRect({ tile, stageW: frameW, stageH: layout.stageH, zoom, image, focus }));
            for (const piece of pieces) {
              const l = pieceBeatLayout({ frameW, frameH, photo: aligned, piece }); // throws = contract broken
              const p = l.pieceRect, q = l.parked;
              // separated by the gap on the partition axis, and never overlapping as rectangles
              if (l.axis === "x") expect(p.x).toBeGreaterThanOrEqual(q.x + q.width + l.gap);
              else expect(p.y).toBeGreaterThanOrEqual(q.y + q.height + l.gap);
              const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
              expect(overlap).toBe(false);
              // the piece is inside the frame, on the floor, and the slide is on one axis only
              expect(p.x).toBeGreaterThanOrEqual(b.margin);
              expect(p.y).toBeGreaterThanOrEqual(b.margin);
              expect(p.x + p.width).toBeLessThanOrEqual(frameW - b.margin);
              expect(p.y + p.height).toBeLessThanOrEqual(frameH - b.margin);
              const room = l.axis === "x" ? frameW - b.margin - p.x + (p.x - (q.x + q.width + l.gap)) : frameH - b.margin - p.y + (p.y - (q.y + q.height + l.gap));
              expect(room).toBeGreaterThanOrEqual(l.axis === "x" ? b.pieceMinW : b.pieceMinH);
              expect(l.dx === 0 || l.dy === 0).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(frames.length * 33 * aspects.length * focuses.length * pieces.length);
  });

  it("readImageSize reads a PNG header and falls back to square", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-png-"));
    const png = Buffer.alloc(24);
    png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    png.writeUInt32BE(13, 8); png.write("IHDR", 12, "latin1"); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
    fs.writeFileSync(path.join(dir, "a.png"), png);
    expect(readImageSize(path.join(dir, "a.png"))).toEqual({ width: 640, height: 480 });
    expect(readImageSize(path.join(dir, "missing.png"))).toEqual({ width: 1, height: 1 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
