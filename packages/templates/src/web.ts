// ── @m0saic/templates — BROWSER ENTRY ────────────────────────────────────
//
// The web build (apps/mosaic/web, served as public JS) bundles THIS entry, not
// `./index`. It registers only the templates whose transitive imports are
// node-free, so it bundles under webpack (react-scripts) without a single
// `fs`/`path`/`child_process` reaching the browser.
//
// ⚠️  Adding a node-importing template here BREAKS `npm run build:web`. Before
//     adding a family/slug, verify it (and everything it imports) is node-clean.
//     Registration is a module side effect — importing a module registers its
//     template(s) via `registerTemplate` at module scope.
//
// EXCLUDED (node-tainted — see the route-audit plan `web-desktop-fork.md` §3):
//   • whole families: benchmark, forensic, hero, meta
//   • cherry-exclusions within otherwise-mixed families:
//       brand/qr-stamp/{still,video/v2} + media/qr/stamp-video  (node:path + fs)
//       media/logo-animate, media/watermark        (node:fs / node:path)
//       media/metadata-stamp                       (measureText → @m0saic/text fs font load)
//   Those drop to a "Desktop only" CTA in the web gallery (Phase 3b).
//   • DELIBERATELY left out although node-clean — the template's content is
//     the CLI's `--input` media (`ctx.media`), which the browser never has, so
//     a live web instance renders nothing. Leaving it out of this entry is
//     what makes copy-template-assets stamp it a DESKTOP card instead:
//       media/subtitle-burn                        (burns ctx.media subtitles)

// ── Fully node-clean families (whole barrel) ─────────────────────────────
import "./m0saic/wireframe"; // includes base/v2 — the DEFAULT Make template
import "./m0saic/hello-world"; // hello-world/v1 — the `m0saic hello-world` card (lavfi + masked tiles + svg text; no node)
import "./m0saic/primitives";
import "./m0saic/charts";
import "./m0saic/collage";
import "./m0saic/agents";
// github — everything but weekly-pulse. The pulse composes the node-only hero
// beats, so on web it could only ever be a renderLite stub; leaving it (and the
// hero/ffmpeg-pulse/runner it registers) out of this entry makes both DESKTOP
// cards with a real preview instead (founder, 2026-09-16).
import "./m0saic/github/connection";
import "./m0saic/github/repo-facts-fetcher";
import "./m0saic/github/weekly-pulse-adapter";
import "./m0saic/github/year-card";
import "./m0saic/theming";
import "./m0saic/dsl-tutorial";
import "./m0saic/social";
import "./m0saic/web";
// code/snippet-morph/v1 — node-clean since the 2026-09-05 svg-text promotion:
// every code line is an svg text source the ENGINE rasterizes, so the template
// no longer imports sharp / fs and has no renderLite — `render()` IS the
// in-browser preview (pure pipeline; the ffmpeg make is desktop-only as ever).
import "./m0saic/code";

// ── alpine — the whole barrel: every slug is node-clean. (stat-card/v1 was
//    the one exclusion, for a node:path import it no longer has — it is the
//    "Hero KPI Stat Card" and was showing as a DESKTOP card for no reason.)
import "./m0saic/alpine";

// ── brand — clean slugs (family barrel is tainted by qr-stamp/*) ─────────
// brand/community-m/v1 — the BROWSER entry (`community-m.web`), not the node
// one: same id, same beats, assembled from the same node-free modules, but
// every picture is a generated stand-in and the canvas a generated card,
// because the real Community M is files on disk. Asking for a community-m
// folder or a contributor's real .mosaic returns a "Mosaic Desktop renders
// this for real" card rather than quietly rendering something else.
import "./m0saic/brand/community-m/v1/community-m.web";
import "./m0saic/brand/logo/v1";
import "./m0saic/brand/logo/v2";
import "./m0saic/brand/logo/v3";
import "./m0saic/brand/business-card/v1";

// ── media/qr — clean slugs (family barrel is tainted by stamp-video) ─────
import "./m0saic/media/barcode/v1";
import "./m0saic/media/qr/code/v1";
import "./m0saic/media/qr/basic/v1";
import "./m0saic/media/qr/animate/v1";
import "./m0saic/media/qr/animate/v2";
import "./m0saic/media/qr/stamp/v1/qr-stamp-custom";
import "./m0saic/media/qr/rounded/v1";

// ── media — clean slugs (family barrel is tainted by logo-animate/watermark) ──
import "./m0saic/media/blur-regions";
import "./m0saic/media/highlights";
import "./m0saic/media/screencap_grid";
import "./m0saic/media/screencap_grid_aspect_safe";
import "./m0saic/media/trickplay";
import "./m0saic/media/video_to_png_sequence";

// Re-export the registry accessors so the web adapter can list/get/require
// templates without importing the node `./index` entry.
export {
  requireTemplate,
  getTemplate,
  listRegisteredTemplateIds,
} from "@m0saic/template-utils";
