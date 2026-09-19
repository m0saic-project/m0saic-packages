/**
 * Container-level metadata atoms written into the rendered output file.
 *
 * Maps to ffmpeg `-metadata key="value"` flags. Each container honors a
 * subset of these:
 *
 * - **mp4 / mov** — title, description, author (artist), copyright,
 *   comment, encoder (iTunes-compatible `ilst` atoms).
 * - **webm / mkv** — all fields (full Matroska tag support).
 * - **mp3** — title, author (artist), copyright, comment (ID3v2 tags).
 * - **wav** — title, author, comment (LIST INFO chunk; limited).
 * - **png** — limited; comment maps to `tEXt` chunk.
 * - **jpeg / gif** — limited or unsupported.
 *
 * Distinct from {@link MosaicFileMeta}, which describes the source
 * `.mosaic` / `.m0v` *artifact*. `MosaicContainerMetadata` describes
 * the *rendered* output.
 *
 * # Canonical brand-config use case
 *
 * Brand-stable atoms (author, copyright, encoder) typically live in
 * a shared `.m0v` that the CLI loads as default user input;
 * per-video atoms (title, description, comment) live on each
 * `.mosaic` in `outputs.<key>.metadata`. The CLI merges `.m0v`
 * defaults into User intent (CLI flags > `.m0v` defaults within
 * that tier), then User > Template > Engine default per the
 * the internal rendering-model-contract notes precedence
 * ladder — so a brand sets author + copyright once and every doc
 * inherits them while individual `.mosaic` files override title
 * for themselves.
 */
export type MosaicContainerMetadata = {
  /** Title atom. */
  title?: string;

  /** Description / synopsis atom. */
  description?: string;

  /** Author / artist atom (mapped to container-specific field). */
  author?: string;

  /** Copyright atom. */
  copyright?: string;

  /** Free-form comment / note atom. */
  comment?: string;

  /**
   * Encoder string atom. When omitted, ffmpeg writes its own encoder
   * banner; an explicit value overrides it.
   */
  encoder?: string;
};
