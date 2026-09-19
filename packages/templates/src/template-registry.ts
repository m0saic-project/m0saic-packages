/**
 * Authoring registry for official built-in templates.
 *
 * Each entry provides the metadata needed to generate template-manifest.json.
 * This is the single source of truth for browse metadata (title, description,
 * tags, preview paths) for the official template pack.
 *
 * ALL registered templates belong here — including internal ones — so that
 * preview assets and repo metadata are resolved for every template.
 */
import type { MosaicTemplateRepoManifestEntry } from "@m0saic/types";

export type OfficialTemplateRegistryEntry = Omit<
  MosaicTemplateRepoManifestEntry,
  "templateKey"
> & {
  /** The template's id field (= templateKey in manifest). */
  templateId: string;
  /** Named export from dist/index.js (must match barrel export). */
  exportName: string;
};

export const templateRegistry: OfficialTemplateRegistryEntry[] = [
  // ── Hello (the CLI's first render) ────────────────────────
  {
    slug: "hello-world",
    templateId: "@m0saic/hello-world/v1",
    exportName: "HelloWorld",
    title: "Hello, World",
    description:
      "The Home screen as a greeting: the brand-pattern field sweeps in rect by rect, a navy card rises with the M, the wordmark and your greeting. Zero inputs — the first render on a fresh install (m0saic hello-world).",
    tags: ["hello", "brand", "animated", "intro", "card"],
  },

  // ── Web ────────────────────────────────────────────────────
  {
    slug: "page-skeleton",
    templateId: "@m0saic/web/page-skeleton/v1",
    exportName: "PageSkeleton",
    title: "Page Skeleton",
    description:
      "Paste anonymous geometry captured from any webpage and render an editable skeleton-loading still or looping shimmer/pulse video.",
    tags: ["web", "skeleton", "loading", "capture", "wireframe", "animated", "designers", "developers", "landing-page", "mockup"],
  },

  // ── Wireframe ──────────────────────────────────────────────
  {
    slug: "wireframe-v2",
    templateId: "@m0saic/wireframe/base/v2",
    exportName: "WireframeV2",
    title: "Wireframe",
    description:
      "Standard wireframe for auto-gen docs. Single-pass: each m0 frame is one masked color tile (border + text as glyph outlines).",
    tags: ["wireframe", "docs-only", "designers", "developers", "layout", "blueprint"],
  },
  {
    slug: "wireframe",
    templateId: "@m0saic/wireframe/base/v1",
    exportName: "Wireframe",
    title: "Wireframe v1 (deprecated)",
    description:
      "Nested-cell wireframe baseline. Deprecated in favor of @m0saic/wireframe/base/v2 (single-pass); kept for perf comparison and reference.",
    tags: ["wireframe", "docs-only"],
  },
  {
    slug: "wireframe-animated",
    templateId: "@m0saic/wireframe/animated/v1",
    exportName: "AnimatedWireframe",
    title: "Animated Wireframe (deprecated)",
    description:
      "Sequential cell reveal of any m0 layout (number, size, aspect ratio, m0 header). Deprecated in favor of @m0saic/dsl-tutorial/v1 — the geometry walk explains the layout instead of only revealing it; kept as the lightweight reveal for small-to-mid layouts.",
    tags: ["wireframe", "animated", "docs-only"],
  },
  {
    slug: "wireframe-cell",
    templateId: "@m0saic/wireframe/cell/v1",
    exportName: "WireframeCell",
    title: "Wireframe Cell",
    description: "Single numbered wireframe cell with optional text overlay.",
    tags: ["wireframe", "docs-only"],
  },

  // ── Brand ──────────────────────────────────────────────────
  {
    slug: "brand-logo-v1",
    templateId: "@m0saic/brand/logo/v1",
    exportName: "TheMosaicM",
    title: "The M0saic M Logo (v1, deprecated)",
    description: "Deprecated in favor of @m0saic/brand/logo/v3 (M0saic Brand Marks). Bitmap-only render of the canonical m0saic M.",
    tags: ["brand", "logo"],
  },
  {
    slug: "brand-logo-v2",
    templateId: "@m0saic/brand/logo/v2",
    exportName: "TheMosaicMV2",
    title: "The M0saic M Logo (v2, deprecated)",
    description: "Deprecated in favor of @m0saic/brand/logo/v3 (M0saic Brand Marks), a superset. Rect/bitmap render of the canonical m0saic M.",
    tags: ["brand", "logo"],
  },
  {
    slug: "brand-logo-v3",
    templateId: "@m0saic/brand/logo/v3",
    exportName: "TheMosaicMV3",
    title: "M0saic Brand Marks",
    description: "Renders any m0saic brand mark — the M (rects or bitmap), the m0 logotype, or the m0saic pattern — with an animated reveal. Supersedes the v1/v2 M-logo templates.",
    tags: ["brand", "logo", "marks", "designers", "marketers", "intro", "sting"],
  },
  {
    slug: "brand-community-m-v1",
    templateId: "@m0saic/brand/community-m/v1",
    exportName: "CommunityMV1",
    title: "Community M — Provenance",
    description: "Your tile's provenance video: the Community M with its identity, a zoom into your tile, your original image, your own canvas, then back to the M.",
    tags: ["brand", "community-m", "provenance", "animated", "designers", "developers", "community", "open-source"],
  },
  {
    slug: "business-card",
    templateId: "@m0saic/brand/business-card/v1",
    exportName: "BusinessCard",
    title: "Business Card",
    description: "The m0saic business card, print-ready: US 3.5 x 2 in at 300 DPI on MOO's bleed box (1098 x 648 px; Vistaprint / FedEx presets too) — brand field + M lockup and your contact on the front, a live-rendered shipped template with a QR to Mosaic Web on the back. One render, two PNGs.",
    tags: ["brand", "print", "card", "business-card", "still", "qr", "founders", "marketers", "developers"],
  },
  {
    slug: "qr-code",
    templateId: "@m0saic/media/qr/code/v1",
    exportName: "QrCode",
    title: "QR Code",
    description:
      "Scannable QR from any text (URL, plain string, or structured payload). Defaults to the branded look — circle modules on a light card with the m0saic M carved in the centre; swap the centre asset and URL to make it yours. Square/rounded/circle module styles, light/dark/transparent card, optional spawn animation (Output mp4). The one standalone QR template.",
    tags: ["brand", "qr", "marketers", "designers", "link"],
  },
  {
    slug: "brand-qr",
    templateId: "@m0saic/media/qr/basic/v1",
    exportName: "BrandQr",
    title: "QR Basic (v1, deprecated)",
    description:
      "Deprecated in favor of @m0saic/media/qr/code/v1 (QR Code) — its square module style is byte-identical. Kept as the plain-path reference.",
    tags: ["brand", "qr"],
  },
  {
    slug: "barcode",
    templateId: "@m0saic/media/barcode/v1",
    exportName: "Barcode",
    title: "Barcode",
    description:
      "Scannable 1D barcode (Code 128, EAN-13, UPC-A). Orange bars on light, dark, or transparent backgrounds. Optional human-readable digit caption underneath.",
    tags: ["media", "barcode", "designers", "marketers", "print", "label"],
  },
  {
    slug: "qr-rounded",
    templateId: "@m0saic/media/qr/rounded/v1",
    exportName: "QrRounded",
    title: "QR Rounded (v1, deprecated)",
    description:
      "Deprecated in favor of @m0saic/media/qr/code/v1 (QR Code) — same engine; circle/roundedSquare styles + the centre cutout live there as Style / Center Asset groups. Kept as the styled-path reference.",
    tags: ["brand", "qr"],
  },
  {
    slug: "qr-animate-tile-spawn",
    templateId: "@m0saic/media/qr/animate/v1",
    exportName: "QrAnimate",
    title: "QR — Animated Tile Spawn (internal)",
    description:
      "Internal: deterministic per-tile spawn-in animation for a pre-baked QR m0 string. Engine-internal — feeds the committed qr-animate brand assets (build-qr-rendered.cjs) the attribution stamps play.",
    tags: ["brand", "qr", "animated", "internal"],
  },
  {
    slug: "qr-animate",
    templateId: "@m0saic/media/qr/animate/v2",
    exportName: "QrAnimateV2",
    title: "QR Spawn (v2, deprecated)",
    description:
      "Deprecated in favor of @m0saic/media/qr/code/v1 (QR Code) — the spawn is its Output mp4 mode (envelope under Animation) and the caller-SVG hatch is advanced.svg. Kept as the spawn reference.",
    tags: ["brand", "qr", "animated"],
  },
  {
    slug: "qr-stamp-custom",
    templateId: "@m0saic/media/qr/stamp/v1",
    exportName: "QrStampCustom",
    title: "QR Stamp",
    description:
      "Drop a QR onto any image or video. Same engine as the auto post-render attribution watermark, exposed for direct use — adaptive light/dark card, entrance fade, corner/size/margin knobs.",
    tags: ["brand", "qr", "stamp", "custom", "marketers", "creators", "animated", "link", "video"],
  },
  {
    slug: "qr-stamp-still",
    templateId: "@m0saic/brand/qr-stamp/still/v1",
    exportName: "QrStampStill",
    title: "QR Brand Attribution — Image (internal)",
    description:
      "The official m0saic attribution stamp for IMAGE deliverables — the exact template the free tier runs on every rendered image. Stamps the m0saic QR card (light or dark, picked by a one-shot brightness probe of the corner region) in the bottom-right corner. Exists solely for that hook; to stamp your own media, use QR Stamp.",
    tags: ["brand", "qr", "watermark", "still", "internal"],
  },
  {
    slug: "qr-stamp-video",
    templateId: "@m0saic/media/qr/stamp-video/v1",
    exportName: "QrStampVideo",
    title: "QR Stamp — Video (v1, deprecated)",
    description:
      "Deprecated in favor of @m0saic/media/qr/stamp/v1 (QR Stamp) — same adaptive-crossfade engine, plus image support. Render-time gleam retired by design (bake decoration into the input media). Kept as the reference adaptive video stamp.",
    tags: ["brand", "qr", "watermark", "adaptive"],
  },
  {
    slug: "qr-stamp-video-animated",
    templateId: "@m0saic/brand/qr-stamp/video/v2",
    exportName: "QrStampVideoV2",
    title: "QR Brand Attribution — Video (internal)",
    description:
      "The official m0saic attribution stamp for VIDEO deliverables — the exact template the free tier runs on every rendered video. Plays the committed qr-animate brand mark in one or more time windows scaled to clip duration; each window's light/dark card is picked from a region luminance probe. Exists solely for that hook; to stamp your own media, use QR Stamp.",
    tags: ["brand", "qr", "watermark", "animated", "internal"],
  },

  // ── Charts / demos / benchmark (standalone-previewable) ────
  {
    slug: "bar-graph-v1",
    templateId: "@m0saic/charts/bar-graph/v1",
    exportName: "ChartsBarGraph",
    title: "Bar Graph",
    description:
      "Canonical bar graph data-viz primitive supporting vertical/horizontal, with first-class animation and presets.",
    tags: ["charts", "bar-graph", "chart", "data-viz"],
  },
  {
    slug: "donut-v2",
    templateId: "@m0saic/charts/donut/v2",
    exportName: "DonutV2",
    title: "Donut Chart (bitmap)",
    description:
      "Experimental bitmap donut chart — proportional ring + center total. Superseded by @m0saic/charts/donut/v4.",
    tags: ["charts", "donut", "distribution", "data-viz"],
  },
  {
    slug: "benchmark-run",
    templateId: "@m0saic/benchmark/run/v1",
    exportName: "BenchmarkRun",
    title: "Benchmark — Run",
    description:
      "Runs the m0saic render benchmark suite and renders a live status HUD (scenarios, wall-clock, score).",
    tags: ["benchmark", "performance", "diagnostics", "capability", "developers", "animated"],
  },
  {
    slug: "benchmark-report",
    templateId: "@m0saic/benchmark/report/v1",
    exportName: "BenchmarkReport",
    title: "Benchmark — Report",
    description:
      "Packages a benchmark session's benchmark.json (written by @m0saic/benchmark/run/v1) into the standard shareable results video: machine-specs header, three headline KPIs, and a per-scenario render-time bar chart composed from the charts pack.",
    tags: ["benchmark", "performance", "diagnostics", "report", "developers", "animated"],
  },
  // ── Hero ───────────────────────────────────────────────────
  {
    slug: "ffmpeg-pulse-title",
    templateId: "@m0saic/hero/ffmpeg-pulse/title/v1",
    exportName: "FfmpegPulseTitle",
    title: "Weekly Pulse · Title",
    description:
      "FFmpeg Weekly Pulse — title beat. The opening hero card: logo + wordmark, a big WEEKLY PULSE title, a summary subtitle, date + week pills, and the m0saic.io watermark over the signature rectangle scatter. Aspect-adaptive.",
    tags: ["hero", "ffmpeg-pulse", "title", "beat"],
  },
  {
    slug: "ffmpeg-pulse-kpi-overview",
    templateId: "@m0saic/hero/ffmpeg-pulse/kpi-overview/v1",
    exportName: "FfmpegPulseKpiOverview",
    title: "Weekly Pulse · KPI Overview",
    description:
      "FFmpeg Weekly Pulse — KPI Overview beat. A logo-left header cluster + an aspect-adaptive grid of KPI stat cards (4×2 desktop, 2×4 square/mobile) + a WEEK/period footer over the signature scatter. Grid driven by pulse.kpis.",
    tags: ["hero", "ffmpeg-pulse", "kpi-overview", "beat"],
  },
  {
    slug: "ffmpeg-pulse-activity-trend",
    templateId: "@m0saic/hero/ffmpeg-pulse/activity-trend/v1",
    exportName: "FfmpegPulseActivityTrend",
    title: "Weekly Pulse · Activity Trend",
    description:
      "FFmpeg Weekly Pulse — Activity Trend beat (Beat 2). The KPI-Overview chrome wrapping a commits-over-time line chart + a rail of derived stat tiles. Aspect-adaptive.",
    tags: ["hero", "ffmpeg-pulse", "activity-trend", "beat"],
  },
  {
    slug: "ffmpeg-pulse-top-contributors",
    templateId: "@m0saic/hero/ffmpeg-pulse/top-contributors/v1",
    exportName: "FfmpegPulseTopContributors",
    title: "Weekly Pulse · Top Contributors",
    description:
      "FFmpeg Weekly Pulse — Top Contributors beat (Beat 3). The shared beat chrome wrapping a ranked contributor table (commits/additions/deletions, green/red diff) + a rail of aggregate stat tiles. Aspect-adaptive (table reflows to stacked cards on mobile).",
    tags: ["hero", "ffmpeg-pulse", "top-contributors", "beat"],
  },
  {
    slug: "ffmpeg-pulse-changes-breakdown",
    templateId: "@m0saic/hero/ffmpeg-pulse/changes-breakdown/v1",
    exportName: "FfmpegPulseChangesBreakdown",
    title: "Weekly Pulse · Changes Breakdown",
    description:
      "FFmpeg Weekly Pulse — Changes Breakdown beat (Beat 4). The shared beat chrome wrapping a changes-by-subsystem donut (ring + legend + center total) + a rail of aggregate stat tiles. Aspect-adaptive.",
    tags: ["hero", "ffmpeg-pulse", "changes-breakdown", "beat"],
  },
  {
    slug: "ffmpeg-pulse-contributions",
    templateId: "@m0saic/hero/ffmpeg-pulse/contributions/v1",
    exportName: "FfmpegPulseContributions",
    title: "Weekly Pulse · Contributions",
    description:
      "FFmpeg Weekly Pulse — Contributions beat (Beat 5). The shared beat chrome wrapping a GitHub-style contribution heatmap (commits by weekday × trailing weeks) + a rail of aggregate activity stat tiles. Aspect-adaptive.",
    tags: ["hero", "ffmpeg-pulse", "contributions", "heatmap", "beat"],
  },
  {
    slug: "ffmpeg-pulse-notable-commits",
    templateId: "@m0saic/hero/ffmpeg-pulse/notable-commits/v1",
    exportName: "FfmpegPulseNotableCommits",
    title: "Weekly Pulse · Notable Commits",
    description:
      "FFmpeg Weekly Pulse — Notable Commits beat. The shared beat chrome wrapping a commit feed (kind icon + title + PR + area + reviewers + signal bar) + a rail of maintainer stat tiles. Aspect-adaptive.",
    tags: ["hero", "ffmpeg-pulse", "notable-commits", "beat"],
  },
  {
    slug: "ffmpeg-pulse-fin",
    templateId: "@m0saic/hero/ffmpeg-pulse/fin/v1",
    exportName: "FfmpegPulseFin",
    title: "Weekly Pulse · Fin",
    description:
      "FFmpeg Weekly Pulse — Fin (closing card). Centered headline + subhead, a KPI strip of the week's signature numbers, and a QR to the full report, over the signature scatter. Aspect-adaptive.",
    tags: ["hero", "ffmpeg-pulse", "fin", "beat"],
  },
  {
    slug: "ffmpeg-pulse-runner",
    templateId: "@m0saic/hero/ffmpeg-pulse/runner/v1",
    exportName: "FfmpegPulseRunner",
    title: "Weekly Pulse · Runner",
    description:
      "FFmpeg Weekly Pulse — the runner. Sequences all eight beats into one cross-faded MosaicDocumentPipeline. Aspect-adaptive; per-beat durations as props.",
    tags: ["hero", "ffmpeg-pulse", "runner", "pipeline", "developers", "marketers", "github", "changelog", "showcase"],
  },
  {
    slug: "ffmpeg-pulse-scatter-bake",
    templateId: "@m0saic/hero/ffmpeg-pulse/scatter-bake/v1",
    exportName: "FfmpegPulseScatterBake",
    title: "Weekly Pulse · Scatter Bake (internal)",
    description:
      "Internal bake harness — renders the FFmpeg Weekly Pulse rectangle scatter + L→R reveal full-canvas for baking to a flat video the beats reference as one source.",
    tags: ["hero", "ffmpeg-pulse", "scatter", "bake", "internal"],
  },
  {
    slug: "bar-graph",
    templateId: "@m0saic/charts/bar-graph/v2",
    exportName: "ChartsBarGraphV2",
    title: "Bar Graph",
    description:
      "Canonical bar graph: vertical/horizontal, grid + L-axes, value + category labels, presets, grow-in animation. Tight-rect geometry — each bar a rect that hugs its drawn height (flat single doc, no nested composition).",
    tags: ["charts", "bar-graph", "chart", "data-viz", "analysts", "marketers", "report"],
  },
  {
    slug: "stat-card",
    templateId: "@m0saic/charts/stat-card/v1",
    exportName: "StatCard",
    title: "KPI Stat Card",
    description:
      "Canonical KPI stat card: label, dominant value, delta (arrow + signed change), and sublabel. Building block of the repo-tracker hero.",
    tags: ["charts", "stat-card", "kpi", "data-viz", "analysts", "marketers", "metric"],
  },
  {
    slug: "donut",
    templateId: "@m0saic/charts/donut/v4",
    exportName: "DonutV4",
    title: "Donut Chart",
    description:
      "Canonical donut chart: proportional ring + dominant center total. v4 makes the premium sliver sweep ratio via a self-framed coarse-quantize, so it composes at any canvas while keeping the smooth sweep + tight rasters.",
    tags: ["charts", "donut", "distribution", "data-viz", "analysts", "marketers", "share"],
  },
  {
    slug: "donut-v3",
    templateId: "@m0saic/charts/donut/v3",
    exportName: "DonutV3",
    title: "Donut Chart v3 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/charts/donut/v4. Its premium sliver sweep packs tight bboxes via placeRects on the full canvas, so precision tracks the canvas (slope 1.04). Kept as a reference for the self-framed coarse-quantize rebuild.",
    tags: ["charts", "donut", "distribution", "data-viz"],
  },
  {
    slug: "donut-v1",
    templateId: "@m0saic/charts/donut/v1",
    exportName: "Donut",
    title: "Donut Chart v1 (deprecated)",
    description:
      "Canonical donut chart: proportional ring + dominant center total. Deprecated in favor of @m0saic/charts/donut/v4 — v1 masks every slice as a full-canvas tile (the slow antipattern), kept as the reference 'bad' example.",
    tags: ["charts", "donut", "distribution", "data-viz"],
  },
  {
    slug: "line-chart",
    templateId: "@m0saic/charts/line-chart/v1",
    exportName: "ChartsLineChart",
    title: "Line Chart",
    description:
      "Canonical line-chart data-viz primitive: multi-series, full axis/line/point control, and transparent/solid/image backgrounds. The base every dashboard/report composes.",
    tags: ["charts", "line-chart", "data-viz", "analysts", "marketers", "trend"],
  },
  {
    slug: "line-chart-chrome",
    templateId: "@m0saic/charts/line-chart/internal/chrome/v1",
    exportName: "Chrome",
    title: "Line Chart — Chart Chrome (internal)",
    description:
      "Internal: renders the line chart's chrome (header, tick gutters, gridlines, axis lines) as real m0 geometry via weightedSplit; the parent overlays the animated line.",
    tags: ["charts", "line-chart", "internal", "chrome"],
  },
  {
    slug: "bar-graph-bar-cell",
    templateId: "@m0saic/charts/bar-graph/internal/bar-cell/v1",
    exportName: "BarCell",
    title: "Bar Graph \u2014 Bar Cell (internal)",
    description:
      "Internal: composes track + BarFill + optional labels for a single bar.",
    tags: ["charts", "bar-graph", "internal", "bar-cell"],
  },
  {
    slug: "bar-graph-bar-fill",
    templateId: "@m0saic/charts/bar-graph/internal/bar-fill/v1",
    exportName: "BarFill",
    title: "Bar Graph \u2014 Bar Fill (internal)",
    description:
      "Internal leaf: sole owner of FFmpeg expressions for animated bar fill.",
    tags: ["charts", "bar-graph", "internal", "bar-fill", "animation"],
  },
  {
    slug: "bar-graph-bars-stack",
    templateId: "@m0saic/charts/bar-graph/internal/bars-stack/v1",
    exportName: "BarsStack",
    title: "Bar Graph \u2014 Bars Stack (internal)",
    description:
      "Internal: layout container that arranges N BarCell children along the layout axis.",
    tags: ["charts", "bar-graph", "internal", "bars-stack"],
  },
  {
    slug: "bar-graph-chart-frame",
    templateId: "@m0saic/charts/bar-graph/internal/chart-frame/v1",
    exportName: "ChartFrame",
    title: "Bar Graph \u2014 Chart Frame (internal)",
    description:
      "Internal: rounded card surface + inset PlotArea, with preset token resolution.",
    tags: ["charts", "bar-graph", "internal", "frame"],
  },
  {
    slug: "bar-graph-labels",
    templateId: "@m0saic/charts/bar-graph/internal/labels/v1",
    exportName: "Labels",
    title: "Bar Graph \u2014 Labels (internal)",
    description:
      "Internal: renders global chart labels (title/subtitle) and owns formatting rules.",
    tags: ["charts", "bar-graph", "internal", "labels", "text"],
  },
  {
    slug: "bar-graph-plot-area",
    templateId: "@m0saic/charts/bar-graph/internal/plot-area/v1",
    exportName: "PlotArea",
    title: "Bar Graph \u2014 Plot Area (internal)",
    description:
      "Internal: data rectangle containing gridlines, baseline, and the bars stack.",
    tags: ["charts", "bar-graph", "internal", "plot-area"],
  },

  // ── Alpine (friendly mobile-marketing data-viz pack) ───────
  {
    // slug "bar-graph" coexists with charts/bar-graph — pack-scoped uniqueness.
    slug: "bar-graph",
    templateId: "@m0saic/alpine/bar-graph/v1",
    exportName: "AlpineBarGraph",
    title: "Alpine Bar Chart",
    description:
      "Alpine horizontal bar chart — friendly mobile-marketing card: white rounded surface, category rail, rounded bars, inline values, value-tick band. Standalone Alpine brand flavor (not a re-skin of charts/bar-graph).",
    tags: ["alpine", "bar-graph", "chart", "data-viz", "analysts", "developers", "dashboard", "report"],
  },
  {
    slug: "donut",
    templateId: "@m0saic/alpine/donut/v3",
    exportName: "AlpineDonutV3",
    title: "Alpine Donut Chart",
    description:
      "Alpine donut chart — friendly mobile-marketing card: proportional ring, center value + label, side legend. v3's premium mode does the full clockwise radial SWEEP (self-framed coarse-quantize — a smooth draw-on that still composes at any canvas); light mode stays the composable per-segment path.",
    tags: ["alpine", "donut", "distribution", "data-viz", "analysts", "marketers", "dashboard", "share"],
  },
  {
    slug: "donut-v1",
    templateId: "@m0saic/alpine/donut/v1",
    exportName: "AlpineDonut",
    title: "Alpine Donut Chart v1 (deprecated)",
    description:
      "Deprecated. Packs each sector's bbox via absolute placeRects on the full canvas, so precision tracks the canvas (slope 1.04). Kept as a 'what not to do' reference for the mask-in-a-ring-cell rebuild.",
    tags: ["alpine", "donut", "distribution", "data-viz"],
  },
  {
    slug: "donut-v2",
    templateId: "@m0saic/alpine/donut/v2",
    exportName: "AlpineDonutV2",
    title: "Alpine Donut Chart v2 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/donut/v3. Rebuilds the ring as a ratio cell (sectors are masks filling the cell in ring-local coords) so it composes at any canvas without the absolute-placement precision blowup. v3 keeps this ratio ring but upgrades premium from a per-segment fade to the full clockwise radial sweep.",
    tags: ["alpine", "donut", "distribution", "data-viz"],
  },
  {
    slug: "line-chart",
    templateId: "@m0saic/alpine/line-chart/v2",
    exportName: "AlpineLineChartV2",
    title: "Alpine Line Chart",
    description:
      "Alpine line/area chart — friendly mobile-marketing card: soft area fill, rounded line, point markers, value rail, left→right draw-on. Standalone Alpine brand flavor. v2 rebuilds the geometry as a ratio layout (plot marks are masks filling a ratio plot cell) so it composes at any canvas without the absolute-placement precision blowup.",
    tags: ["alpine", "line-chart", "chart", "data-viz", "analysts", "developers", "trend", "dashboard"],
  },
  {
    slug: "line-chart-v1",
    templateId: "@m0saic/alpine/line-chart/v1",
    exportName: "AlpineLineChart",
    title: "Alpine Line Chart v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/line-chart/v2. Places every mark as an absolute placeRects cell-local mask on the full canvas, so precision tracks the canvas (slope 1.08). Kept as a 'what not to do' reference for the mask-in-a-cell rebuild.",
    tags: ["alpine", "line-chart", "chart", "data-viz"],
  },
  {
    slug: "kpi-card",
    templateId: "@m0saic/alpine/kpi-card/v2",
    exportName: "AlpineKpiCardV2",
    title: "Alpine KPI Card",
    description:
      "Alpine KPI / stat card — friendly mobile-marketing card: muted label, count-up value, soft delta pill (arrow + change), sublabel, optional sparkline. Standalone Alpine brand flavor. v2 rebuilds the sparkline as a ratio band so the whole card composes at any canvas without the absolute-placement precision blowup.",
    tags: ["alpine", "kpi", "stat-card", "data-viz", "analysts", "marketers", "metric", "dashboard"],
  },
  {
    slug: "kpi-card-v1",
    templateId: "@m0saic/alpine/kpi-card/v1",
    exportName: "AlpineKpiCard",
    title: "Alpine KPI Card v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/kpi-card/v2. The chrome was ratio, but the sparkline is placed via absolute placeRects bboxes so precision tracks the canvas (slope 1.04). Kept as a reference for the mixed ratio-chrome / absolute-sparkline case.",
    tags: ["alpine", "kpi", "stat-card", "data-viz"],
  },
  {
    slug: "stat-card",
    templateId: "@m0saic/alpine/stat-card/v1",
    exportName: "AlpineStatCard",
    title: "Hero KPI Stat Card",
    description:
      "Hero-styled KPI stat card (Alpine pack): rounded dark card, green accent icon + label, dominant count-up value, SVG-triangle delta (green up / red down) + sublabel. The KPI tile for the FFmpeg Weekly Pulse beats.",
    tags: ["alpine", "stat-card", "kpi", "hero", "dark", "analysts", "marketers", "metric", "number"],
  },
  {
    slug: "contributor-table",
    templateId: "@m0saic/alpine/contributor-table/v1",
    exportName: "AlpineContributorTable",
    title: "Alpine Contributor Table",
    description:
      "Alpine contributor table — friendly mobile-marketing card: a ranked multi-column table (rank · avatar · name + arbitrary value columns), icon + title header, top-N accent wash, count-up values. Alpine-light by default; the FFmpeg hero uses preset:\"dark\".",
    tags: ["alpine", "contributor-table", "ranking", "table", "data-viz", "developers", "analysts", "team", "open-source"],
  },
  {
    slug: "commit-feed",
    templateId: "@m0saic/alpine/commit-feed/v2",
    exportName: "AlpineCommitFeedV2",
    title: "Alpine Commit Feed",
    description:
      "Alpine commit feed — friendly mobile-marketing card: a scannable list of notable commits (kind icon + title + PR, area chip + author + reviewers + date) with a signal status bar. Alpine-light by default; the FFmpeg hero uses preset:\"dark\". v2 rebuilds the geometry as a ratio layout (nested proportional splits) so it composes at any canvas without the absolute-placement precision blowup.",
    tags: ["alpine", "commit-feed", "feed", "list", "data-viz", "developers", "analysts", "git", "changelog"],
  },
  {
    slug: "commit-feed-v1",
    templateId: "@m0saic/alpine/commit-feed/v1",
    exportName: "AlpineCommitFeed",
    title: "Alpine Commit Feed v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/commit-feed/v2. Packs every row element as an absolute placeRects rect, so precision tracks the canvas (slope 1.00) and it pins its parent when nested. Kept as a 'what not to do' absolute-list reference.",
    tags: ["alpine", "commit-feed", "feed", "list", "data-viz"],
  },
  {
    slug: "progress-card",
    templateId: "@m0saic/alpine/progress-card/v1",
    exportName: "AlpineProgressCard",
    title: "Alpine Progress Card",
    description:
      "Alpine progress card — friendly mobile-marketing card: a list of goal rows, each a label + value over a rounded track with a colored fill grown to its fraction. Standalone Alpine brand flavor.",
    tags: ["alpine", "progress", "goals", "data-viz", "analysts", "marketers", "goal", "milestone"],
  },
  {
    slug: "leaderboard",
    templateId: "@m0saic/alpine/leaderboard/v1",
    exportName: "AlpineLeaderboard",
    title: "Alpine Leaderboard",
    description:
      "Alpine leaderboard — friendly mobile-marketing card: a ranked list with gold/silver/bronze rank badges, names, count-up values, and a soft podium tint. Standalone Alpine brand flavor.",
    tags: ["alpine", "leaderboard", "ranking", "data-viz", "analysts", "creators", "top-10"],
  },
  {
    slug: "heatmap",
    templateId: "@m0saic/alpine/heatmap/v2",
    exportName: "AlpineHeatmapV2",
    title: "Alpine Heatmap",
    description:
      "Alpine heatmap — friendly mobile-marketing card: a rows×cols grid of rounded cells on a single-hue intensity scale, with row/column labels and a Less→More legend. Generalizes the GitHub contribution calendar. Standalone Alpine brand flavor. v2 rebuilds the geometry as a ratio layout (gutterless grid + gaps as source insets) so it composes at any canvas without the absolute-placement precision blowup.",
    tags: ["alpine", "heatmap", "matrix", "data-viz", "analysts", "developers", "activity", "calendar"],
  },
  {
    slug: "heatmap-v1",
    templateId: "@m0saic/alpine/heatmap/v1",
    exportName: "AlpineHeatmap",
    title: "Alpine Heatmap v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/heatmap/v2. Packs every cell/label/legend swatch as an absolute placeRects rect on a per-pixel snap grid, so precision tracks the canvas and coprime cell pitches pin it to ~100%. Kept as a 'what not to do' absolute-grid reference.",
    tags: ["alpine", "heatmap", "matrix", "data-viz"],
  },
  {
    slug: "timeline",
    templateId: "@m0saic/alpine/timeline/v2",
    exportName: "AlpineTimelineV2",
    title: "Alpine Timeline",
    description:
      "Alpine timeline — friendly mobile-marketing card: a milestone timeline with a spine + dots, each event a date + title + description. Standalone Alpine brand flavor. v2 rebuilds the geometry as a ratio layout (nested proportional splits) so it composes at any canvas without the absolute-placement precision blowup.",
    tags: ["alpine", "timeline", "milestones", "data-viz", "analysts", "marketers", "roadmap"],
  },
  {
    slug: "timeline-v1",
    templateId: "@m0saic/alpine/timeline/v1",
    exportName: "AlpineTimeline",
    title: "Alpine Timeline v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/timeline/v2. Packs the spine, dots and text as absolute placeRects rects, so precision tracks the canvas (slope 1.04) and it pins its parent when nested. Kept as a 'what not to do' absolute-list reference.",
    tags: ["alpine", "timeline", "milestones", "data-viz"],
  },
  {
    slug: "treemap",
    templateId: "@m0saic/alpine/treemap/v2",
    exportName: "AlpineTreemapV2",
    title: "Alpine Treemap",
    description:
      "Alpine treemap — friendly mobile-marketing card: value-sized rounded tiles (squarified) filling the card, each labelled with its name + share, tiles fading in biggest→smallest. Standalone Alpine brand flavor. v2 rebuilds the geometry as a ratio layout (squarified nested splits + gap-as-inset) so it composes at any canvas without the absolute-placement precision blowup.",
    tags: ["alpine", "treemap", "proportion", "data-viz", "analysts", "developers", "breakdown", "composition"],
  },
  {
    slug: "treemap-v1",
    templateId: "@m0saic/alpine/treemap/v1",
    exportName: "AlpineTreemap",
    title: "Alpine Treemap v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/alpine/treemap/v2. Flattens the squarified layout to an absolute placeRects rect list, so precision tracks the canvas (slope 1.04). Kept as a 'what not to do' reference for the nested-split + gap-inset rebuild.",
    tags: ["alpine", "treemap", "proportion", "data-viz"],
  },

  // ── Primitives ─────────────────────────────────────────────
  {
    slug: "grid",
    templateId: "@m0saic/primitives/grid/v2",
    exportName: "PrimitiveGridV2",
    title: "Primitive \u2014 Grid",
    description:
      "Composable gridline overlay primitive (horizontal/vertical/both) \u2014 thin fixed-px strips at proportional offsets; nests cleanly at any canvas.",
    tags: ["primitive", "grid", "developers", "layout"],
  },
  {
    slug: "grid-v1",
    templateId: "@m0saic/primitives/grid/v1",
    exportName: "PrimitiveGrid",
    title: "Primitive \u2014 Grid v1 (deprecated)",
    description:
      "Deprecated in favor of @m0saic/primitives/grid/v2. Single-axis path launders absolute px positions through a per-pixel placeRects split \u2014 renders standalone but SILENTLY DROPS when nested at many canvases. Kept as a 'what not to do' reference.",
    tags: ["primitive", "grid"],
  },

  // ── Collage (layout-solver contact sheets) ─────────────────
  {
    slug: "image-collage",
    templateId: "@m0saic/collage/image-collage/v1",
    exportName: "ImageCollage",
    title: "Image Collage",
    description:
      "Packs any set of photos into a designed contact sheet: searched layout, hero / portrait / panorama cells sized to each image, even pixel gutters, soft crop budget; big sets page into one PNG per sheet.",
    tags: ["collage", "images", "layout-solver", "contact-sheet", "creators", "designers", "photos", "grid", "social"],
  },
  {
    slug: "spread-grid-mock",
    templateId: "@m0saic/collage/spread-grid-mock/v1",
    exportName: "SpreadGridMock",
    title: "Spread Grid Mock (internal)",
    description:
      "Internal: layout-contract dogfood — a fixed 6x4 spread grid baked at 1920x1080 whose cells quantize past the uniform-thumbnail tolerance; the first debugLayout adopter, swept by audit:layout-envelope.",
    tags: ["collage", "grid", "internal", "layout-contract"],
  },

  // ── Social (share-ready social graphics) ───────────────────
  {
    slug: "quote-card",
    templateId: "@m0saic/social/quote-card/v1",
    exportName: "QuoteCard",
    title: "Quote Card",
    description:
      "Pull-quote social card — auto-wrapped quote, accent bar, attribution with an optional circular avatar; hand-tuned light/dark presets; lossless PNG still, aspect-safe from square to stories.",
    tags: ["social", "quote", "card", "pull-quote", "promo", "creators", "marketers", "testimonial"],
  },

  // ── Code (developer-facing visual tools) ──────────────────
  {
    slug: "code-snippet-morph",
    templateId: "@m0saic/code/snippet-morph/v1",
    exportName: "SnippetMorphV1",
    title: "Code Snippet Morph",
    description:
      "Turn ordered TypeScript or JavaScript states into a deterministic editor-frame video with syntax highlighting and line-aware morphs — CodeSlides polish as a real deliverable, without screen recording.",
    tags: ["code", "developer", "animation", "snippet", "developers", "diff", "tutorial"],
  },

  // ── Media ──────────────────────────────────────────────────
  {
    slug: "screencap-grid-info-pane",
    templateId: "@m0saic/media/screencap_grid/internal/info_pane/v1",
    exportName: "InfoPane",
    title: "Screencap Grid \u2014 Info Pane (internal)",
    description:
      "Internal subtemplate: renders the filename + metadata info pane for the screencap grid.",
    tags: ["media", "screencap", "internal"],
  },
  {
    slug: "screencap-grid",
    templateId: "@m0saic/media/screencap_grid/v2",
    exportName: "ScreencapGridV2",
    title: "Screencap Grid",
    description:
      "Displays formatted ffprobe info in a top pane with a rows x cols grid of the same media below. Renders a static PNG contact sheet or an animated MP4 grid via the Output knob. v2 lays the pane and tiles out as exact pixel rects via inset-recovery placement (placeInsetPieces), so tile gaps are pixel-exact at every canvas.",
    tags: ["media", "screencap", "grid", "creators", "developers", "contact-sheet", "thumbnails", "video"],
  },
  {
    slug: "screencap-grid-v1",
    templateId: "@m0saic/media/screencap_grid/v1",
    exportName: "ScreencapGrid",
    title: "Screencap Grid (v1, deprecated)",
    description:
      "Deprecated in favor of @m0saic/media/screencap_grid/v2. Realizes the tile gap as gridCellInset fractions against the IDEAL cell size, which the engine floors against the QUANTIZED cells — gaps wobble between gapPx and 0 under the content-driven info pane. Kept as the 'ideal-cell gap inset' reference.",
    tags: ["media", "screencap", "grid"],
  },
  {
    slug: "subtitle-burn",
    templateId: "@m0saic/media/subtitle-burn/v1",
    exportName: "SubtitleBurn",
    title: "Subtitle Burn",
    description:
      "Reads subtitle cues from an MKV/MP4's embedded subtitle stream and burns them onto the video as m0saic text overlays.",
    tags: ["media", "subtitles", "captions", "creators", "educators", "animated", "accessibility", "video"],
  },
  {
    slug: "screencap-grid-aspect-safe",
    templateId: "@m0saic/media/screencap_grid_aspect_safe/v1",
    exportName: "ScreencapGridAspectSafe",
    title: "Screencap Grid — Aspect Safe",
    description:
      "Per source video, picks a coordinated landscape + portrait grid pair (same cell count, cells steered to the wanted shape — landscape/square/portrait presets or an exact ratio, default landscape 16:9) via aspectSafeGrid and emits both as a 2-step multi-output pipeline. Renders static PNG contact sheets or animated MP4 grids via the Output knob; tile gaps are pixel-exact via inset-recovery placement.",
    tags: ["media", "screencap", "grid", "aspect-safe", "multi-orientation", "creators", "developers", "contact-sheet", "thumbnails", "video"],
  },
  {
    slug: "scroll-wall",
    templateId: "@m0saic/media/scroll_wall/v1",
    exportName: "ScrollWallV1",
    title: "Scroll Wall",
    description:
      "An endless scrolling wall of clips: 1-4 rows of video/image tiles slide sideways forever (optionally alternating direction) and loop seamlessly at whole cycles. Every tile is a real DSL cell at full native resolution; the pan is per-tile overlay motion, not a camera crop.",
    tags: ["media", "wall", "scroll", "loop", "montage", "creators", "marketers", "animated", "video"],
  },
  {
    slug: "frame-stripper",
    templateId: "@m0saic/media/video_to_png_sequence/v1",
    exportName: "FrameStripper",
    title: "Frame Stripper",
    description:
      "Drop a video, get every frame as a numbered PNG sequence (frame_0001.png, frame_0002.png, ...).",
    tags: ["media", "frames", "png-sequence", "extract", "developers", "creators", "video"],
  },
  {
    slug: "media-watermark",
    templateId: "@m0saic/media/watermark/v1",
    exportName: "WatermarkV1",
    title: "Watermark",
    description:
      "Stamp your logo or wordmark onto any image or video — 9 positions or an exact m0 rect, ratio-true sizing, opacity control. Point it at a folder for one watermarked output per input.",
    tags: ["media", "watermark", "brand", "batch", "creators", "marketers", "animated", "logo", "overlay", "video"],
  },
  {
    slug: "metadata-stamp",
    templateId: "@m0saic/media/metadata-stamp/v1",
    exportName: "MetadataStampV1",
    title: "Metadata Stamp",
    description:
      "Stamp each video's creation date (read from its metadata) onto the video as a small chip — 9 positions, deterministic date formats. Point it at a folder for one stamped output per input; files without metadata use your fallback text or pass through clean.",
    tags: ["media", "stamp", "date", "metadata", "batch", "utility", "creators", "animated", "timestamp", "overlay", "video"],
  },
  {
    slug: "highlights",
    templateId: "@m0saic/media/highlights/v1",
    exportName: "Highlights",
    title: "Highlight Clips",
    description:
      "Pick a video, mark one or more time ranges, and get each range as its own clip — mp4 or webm, audio intact, one render for the whole batch.",
    tags: ["media", "clips", "highlights", "promo", "multi-output", "creators", "marketers", "animated", "trailer", "teaser", "video"],
  },
  {
    slug: "blur-regions",
    templateId: "@m0saic/media/blur-regions/v1",
    exportName: "BlurRegions",
    title: "Easy Blur",
    description:
      "Pick a video or image, draw boxes over what should stay hidden — faces, plates, names — and get the same media back with those regions blurred or pixelated. Audio untouched.",
    tags: ["media", "blur", "privacy", "redact", "pixelate", "creators", "animated", "face-blur", "anonymize", "video"],
  },
  {
    slug: "trickplay",
    templateId: "@m0saic/media/trickplay/v1",
    exportName: "Trickplay",
    title: "Trickplay Sheets",
    description:
      "The seek-preview thumbnails players show while scrubbing: sprite sheets at a fixed interval, plus a WebVTT storyboard and a Jellyfin/DASH-compatible JSON manifest. Point it at a folder for one sheet set per video.",
    tags: ["media", "trickplay", "storyboard", "batch", "developers", "creators", "video-player", "sprite", "streaming"],
  },
  {
    slug: "logo-animate",
    templateId: "@m0saic/media/logo-animate/v1",
    exportName: "LogoAnimateV1",
    title: "Logo Animate",
    description:
      "Drop in an SVG logo — get an animated logo video. The SVG becomes real m0 geometry (one cell per shape, silhouette masks), animated per-tile: assemble-in, seamless loop, progress fill, breathing glow, or shimmer.",
    tags: ["media", "logo", "animation", "svg-to-mosaic", "brand", "designers", "marketers", "animated", "svg", "intro"],
  },

  // \u2500\u2500 Forensic \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  {
    slug: "forensic-watermark-video-v1",
    templateId: "@m0saic/forensic/watermark/video/v1",
    exportName: "ForensicWatermarkVideoV1",
    title: "Forensic Watermark (Video)",
    description:
      "Embed an invisible per-render payload (subscriber/install ID or UUID) into a video using a BCH-coded spatial-cell watermark. The output keeps the source's size, frame rate, duration and audio; the mark survives YouTube-grade re-encodes. Emits a `.watermark.json` sidecar carrying the recovery keys; check a delivered copy with `@m0saic/forensic/watermark/verify/v1`.",
    tags: ["forensic", "watermark", "provenance", "attribution", "creators", "developers", "animated", "invisible", "video"],
  },
  {
    slug: "forensic-watermark-verify-v1",
    templateId: "@m0saic/forensic/watermark/verify/v1",
    exportName: "ForensicWatermarkVerifyV1",
    title: "Forensic Watermark — Verify",
    description:
      "Check a delivered video against its `.watermark.json` and render a report card: PASS / MISMATCH / FAIL / ERROR, the recovered payload, ECC headroom and confidence, plus the reason. Emits a `watermarkCheck` sidecar with the same result as JSON.",
    tags: ["forensic", "watermark", "verify", "provenance", "attribution", "creators", "developers", "video"],
  },

  // ── DSL Tutorial (animated geometry-walk teaching template) ─
  {
    slug: "dsl-tutorial",
    templateId: "@m0saic/dsl-tutorial/v1",
    exportName: "DslTutorial",
    title: "DSL Tutorial",
    description:
      "Animated, IDE/debugger-style tutorial that walks the m0 DSL parse + geometry step by step: animated canvas with camera-follow, an inspector showing the live rect (X/Y/W/H/Z) over the hidden engine state (split arity, quantization remainder, passthrough carry), and a live syntax-highlighted DSL string with narration. Light/dark, any aspect, speed-controlled.",
    tags: ["dsl-tutorial", "tutorial", "wireframe", "docs", "animated", "developers", "onboarding"],
  },
  {
    slug: "dsl-tutorial-chrome",
    templateId: "@m0saic/dsl-tutorial/chrome/v1",
    exportName: "DslChrome",
    title: "DSL Tutorial — Chrome (internal)",
    description:
      "Internal: IDE header / status bar chrome (baked logo, title, Speed + Step pills, status bar) for the dsl-tutorial template.",
    tags: ["dsl-tutorial", "internal", "chrome"],
  },
  {
    slug: "dsl-tutorial-canvas",
    templateId: "@m0saic/dsl-tutorial/canvas/v1",
    exportName: "DslCanvas",
    title: "DSL Tutorial — Canvas (internal)",
    description:
      "Internal: animated geometry-walk canvas (numbered tiles reveal in order + active-tile highlight) for the dsl-tutorial template.",
    tags: ["dsl-tutorial", "internal", "canvas"],
  },
  {
    slug: "dsl-tutorial-inspector",
    templateId: "@m0saic/dsl-tutorial/inspector/v1",
    exportName: "DslInspector",
    title: "DSL Tutorial — Inspector (internal)",
    description:
      "Internal: live geometry inspector (X/Y/W/H/Z values mutating with the walk + Kind/Status chips) for the dsl-tutorial template.",
    tags: ["dsl-tutorial", "internal", "inspector"],
  },
  {
    slug: "dsl-tutorial-string",
    templateId: "@m0saic/dsl-tutorial/string/v1",
    exportName: "DslString",
    title: "DSL Tutorial — String (internal)",
    description:
      "Internal: live syntax-highlighted m0 string with a stepping caret + position ruler, or the narration banner, for the dsl-tutorial template.",
    tags: ["dsl-tutorial", "internal", "string"],
  },

  // ── Meta (templates about mosaic itself) ───────────────────
  {
    slug: "meta-post-mortem-v1",
    templateId: "@m0saic/meta/post-mortem/v1",
    exportName: "PostMortem",
    title: "Post-Mortem (Session Replay)",
    description:
      "Renders a sandbox session as a watchable video — chat thread on the left, candidate wireframes on the right. Pillar C MVP; visuals iterate via dogfooding.",
    tags: ["meta", "session", "post-mortem", "sandbox"],
  },
  {
    slug: "meta-camera-debug-v1",
    templateId: "@m0saic/meta/camera-debug/v1",
    exportName: "CameraDebug",
    title: "Camera Debugger",
    description:
      "Gray-box wireframe of any layout with the camera's crop viewport drawn as a red rectangle — paste a raw MosaicCamera to verify any template's camera math, or use the built-in follow-walk recipe (smooth pan or snap-per-settle rings).",
    tags: ["meta", "camera", "debug", "motion"],
  },
  {
    slug: "meta-fixture-fetcher-v1",
    templateId: "@m0saic/meta/fixture-fetcher/v1",
    exportName: "FixtureFetcher",
    title: "Fixture Fetcher (internal)",
    description:
      "Deterministic capability-layer proof fixture: publishes a fixed payload as an aliased data source (pipeline-step-0 data-fetcher shape); optional secretRef resolves via ctx.secrets to a derived non-secret marker. No network, no fs. Regression anchor for the F1 data-pipeline plumbing.",
    tags: ["meta", "fixture", "data-fetcher", "internal"],
  },
  {
    slug: "meta-upstream-echo-v1",
    templateId: "@m0saic/meta/upstream-echo/v1",
    exportName: "UpstreamEcho",
    title: "Upstream Echo (internal)",
    description:
      "Consumer proof fixture: reads ctx.upstreamData/upstreamVariables, renders a solid-color tile, and mirrors the received upstream into sidecars for byte-assertable verification. Declares upstream schemas to exercise the resolver's schema guard.",
    tags: ["meta", "fixture", "upstream", "internal"],
  },
  {
    slug: "meta-hot-reload-smoke-v1",
    templateId: "@m0saic/meta/hot-reload-smoke/v1",
    exportName: "HotReloadSmoke",
    title: "Hot-Reload Smoke (internal)",
    description:
      "Internal: the template hot-reload canary — a solid color square whose fill is a module constant (not a prop default), so a stale color can only mean the app is running stale template code.",
    tags: ["meta", "internal", "hot-reload", "dev"],
  },

  // ── GitHub (data connector) ────────────────────────────────
  {
    slug: "github-repo-facts-fetcher-v1",
    templateId: "@m0saic/github/repo-facts-fetcher/v1",
    exportName: "RepoFactsFetcher",
    title: "GitHub Repo Facts (fetcher)",
    description:
      "Capability-tier data fetcher: publishes a normalized GithubRepoFacts sheet (commits, contributors, activity, stars, coverage) under the alias githubRepoFacts. Replay mode (default) is network-free + deterministic; live mode fetches a repo/window over the GitHub REST API with a recorded coverage/degradation ladder. Feeds the weekly-pulse-adapter.",
    tags: ["github", "data-fetcher", "connector", "data"],
  },
  {
    slug: "github-weekly-pulse-adapter-v1",
    templateId: "@m0saic/github/weekly-pulse-adapter/v1",
    exportName: "WeeklyPulseAdapter",
    title: "Weekly Pulse Adapter",
    description:
      "Pure core-tier adapter: reads the upstream githubRepoFacts block and derives the WeeklyPulse sheet (adaptive KPIs, activity + heatmap, contributors, changes-by-area, notable commits) that the ffmpeg-pulse beats consume. Zero network/clock/randomness; requires an upstream repo-facts producer.",
    tags: ["github", "adapter", "pulse", "data", "developers"],
  },
  {
    slug: "agents-commit-feed-v1",
    templateId: "@m0saic/agents/commit-feed/v1",
    exportName: "AgentCommitFeedV1",
    title: "Agent Commit Feed",
    description: "Who wrote this week's commits — a commit feed colour-coded by author (human vs coding agent) with the agent-authored share, a proportion bar and a legend. The alpine commit feed nested under its own card; composes at any canvas.",
    tags: ["github", "commits", "agents", "ai", "developers", "devrel", "engineering-leaders", "alpine", "animated"],
  },
  {
    slug: "agents-trace-timeline-v1",
    templateId: "@m0saic/agents/trace-timeline/v1",
    exportName: "TraceTimelineV1",
    title: "Agent Trace Timeline",
    description: "What the agent did on a run — a waterfall of tool calls: the tool and its target per lane, a latency bar on a shared time axis, tokens per hop, and status colours for errors, retries and cache hits. Alpine card, composes at any canvas.",
    tags: ["agents", "trace", "timeline", "waterfall", "observability", "latency", "tokens", "developers", "sre", "alpine", "animated"],
  },
  {
    slug: "github-year-card-v1",
    templateId: "@m0saic/github/year-card/v1",
    exportName: "YearCardV1",
    title: "GitHub Year Card",
    description: "A developer's year on GitHub on one card: the 7×53 contribution calendar with month and weekday labels and a Less→More legend, four KPI tiles (commits, pull requests, stars, top language) and the handle + year in the header. Gutterless grid with lattice-exact gaps; composes at any canvas.",
    tags: ["github", "contributions", "calendar", "heatmap", "year", "developers", "vanity", "share", "alpine", "animated"],
  },
  {
    slug: "github-weekly-pulse-v1",
    templateId: "@m0saic/github/weekly-pulse/v1",
    exportName: "GithubWeeklyPulse",
    title: "GitHub Weekly Pulse",
    description:
      "The self-contained, app-runnable Weekly Pulse: fetches a GitHub repo's week from prop input (repo + window + token), derives the pulse sheet, and renders all 8 beats — one capability-tier template, no pipeline wiring. Replay mode (default) is network-free; live mode fetches over the GitHub REST API and degrades to an error frame on failure.",
    tags: ["github", "hero", "ffmpeg-pulse", "pulse", "live", "developers", "analysts", "weekly", "report"],
  },

  // ── Theming (design-token producer) ────────────────────────
  {
    slug: "theming-v1",
    templateId: "@m0saic/theming/v1",
    exportName: "Theming",
    title: "Theming — Token Producer",
    description:
      "Design-token producer: publishes one ThemeTokens set (dark | light | high-contrast) onto ctx.upstreamVariables for downstream templates. Standalone it renders an aspect-adaptive Theme-Tokens sheet; as an intermediate pipeline step it emits pure data and re-skins a chain by swapping one prop.",
    tags: ["theming", "tokens", "producer", "design-system", "designers", "developers", "palette"],
  },

  // ── Story (agentic-video: narrated multi-chapter pipelines) ─
  {
    slug: "narrated-chapters",
    templateId: "@m0saic/story/narrated-chapters/v1",
    exportName: "NarratedChapters",
    title: "Narrated Chapters",
    description:
      "Chaptered, narration-timed story video from a story.json manifest — title/section cards, per-chapter scenes, and one deliverable per aspect (landscape/portrait) from a single invocation. Omit props for the built-in demo story.",
    tags: ["story", "chapters", "narrated", "pipeline", "agentic", "creators", "educators", "social", "voice-over", "explainer"],
  },
  {
    slug: "scrapbook",
    templateId: "@m0saic/story/scrapbook/v1",
    exportName: "ScrapbookV1",
    title: "Scrapbook",
    description:
      "A short personal film: a few pictures, a line each, pinned askew on paper and drifting past to music. Lays itself out with stand-in pages until your own photos arrive.",
    tags: ["story", "personal", "photos", "animated", "creators", "social", "memories", "photo-album"],
  },
];
