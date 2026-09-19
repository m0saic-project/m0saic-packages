/**
 * Shared prefix for every m0saic-created temporary directory.
 *
 * Why a constant: ad-hoc per-callsite prefixes (`qr-test-`, `m0saic-make-`,
 * `cronticker-test-`, …) make temp dirs indistinguishable from non-m0saic
 * folders, so cleanup tools can't safely target them. Funnelling every
 * mkdtemp call through this prefix guarantees the cleanup scanner can
 * identify m0saic folders by a single string match.
 *
 * The square brackets are deliberate visual framing — they make the
 * prefix stand out in a file manager and reduce collision risk with
 * third-party temp names. `[`, `]`, `_` are all legal in NTFS / APFS /
 * ext4 paths. They ARE shell glob metacharacters (bash, zsh, PowerShell
 * `-Path`), but the cleanup scanner uses `fs.readdir` + `String#startsWith`
 * — never shell expansion — so this is irrelevant for tooling. Manual
 * shell commands targeting these dirs need quoting (`'[m0saic]_'*`) or
 * the `-LiteralPath` PowerShell flag.
 */
export const M0SAIC_TMP_PREFIX = "[m0saic]_";

const DESCRIPTOR_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Build a `mkdtemp` prefix for a descriptor.
 *
 * The trailing dash is required by `mkdtemp`'s `prefixXXXXXX` contract;
 * mkdtemp appends 6 random chars after the prefix verbatim, and we want
 * a visual separator before them.
 *
 * Validates the descriptor at the callsite so on-disk paths stay
 * shell-safe and so typos surface immediately rather than at debug time.
 *
 * @example
 *   makeM0saicTempPrefix("qr-test")  // => "[m0saic]_qr-test-"
 *   makeM0saicTempPrefix("make")     // mkdtemp result: "[m0saic]_make-aB12Cd"
 */
export function makeM0saicTempPrefix(descriptor: string): string {
  if (typeof descriptor !== "string" || !DESCRIPTOR_RE.test(descriptor)) {
    throw new Error(
      `makeM0saicTempPrefix: descriptor must match /^[A-Za-z0-9][A-Za-z0-9_-]*$/, got ${JSON.stringify(descriptor)}`,
    );
  }
  return `${M0SAIC_TMP_PREFIX}${descriptor}-`;
}

/**
 * True iff a directory basename was created with `M0SAIC_TMP_PREFIX`.
 * Used by the cleanup scanner to decide which entries in the temp root
 * belong to m0saic.
 */
export function isM0saicTempName(basename: string): boolean {
  return typeof basename === "string" && basename.startsWith(M0SAIC_TMP_PREFIX);
}
