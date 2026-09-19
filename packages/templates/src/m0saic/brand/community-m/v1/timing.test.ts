import type { MosaicEngineContext } from "@m0saic/types";
import { resolveProps } from "./props";
import { resolveTimeline } from "./timing";

const ctx = (pinned?: number): MosaicEngineContext =>
  ({ mode: "render", target: { width: 1280, height: 720, fps: 30, durationMs: 10000 }, output: { width: 1280, height: 720, fps: 30, durationMs: 10000, workspaceDir: "/tmp/x" }, media: {}, ...(pinned ? { userIntent: { durationMs: pinned } } : {}) }) as unknown as MosaicEngineContext;
const props = () => { const r = resolveProps({}); if (!r.ok) throw new Error(r.errors.join()); return r.value; };

describe("resolveTimeline", () => {
  it("natural = harness beats + the piece (capped)", () => {
    const t = resolveTimeline(props(), 2000, ctx());
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.timeline.pieceVisibleMs).toBe(2000);
    expect(t.timeline.totalMs).toBe(2400 + 1800 + 600 + 2 * (2000 + 900) + 2000 + 2000 + 2500);
    expect(t.timeline.popMs).toBe(450);
    expect(t.timeline.source).toBe("natural");
    const capped = resolveTimeline(props(), 60000, ctx());
    if (capped.ok) expect(capped.timeline.pieceVisibleMs).toBe(18000);
  });
  it("a pinned duration shrinks the piece first, then scales the harness; the total is exact", () => {
    const shrink = resolveTimeline(props(), 18000, ctx(18000));
    expect(shrink.ok).toBe(true);
    if (shrink.ok) { expect(shrink.timeline.totalMs).toBe(18000); expect(shrink.timeline.pieceVisibleMs).toBe(18000 - 15100); }
    const scaled = resolveTimeline(props(), 18000, ctx(6000));
    expect(scaled.ok).toBe(true);
    if (scaled.ok) { expect(scaled.timeline.totalMs).toBe(6000); expect(scaled.timeline.pieceVisibleMs).toBe(500); expect(scaled.timeline.source).toBe("pinned"); }
    const stretch = resolveTimeline(props(), 1000, ctx(20000));
    if (stretch.ok) expect(stretch.timeline.totalMs).toBe(20000);
  });
  it("refuses an impossible pin", () => {
    expect(resolveTimeline(props(), 2000, ctx(900))).toMatchObject({ ok: false });
  });
});
