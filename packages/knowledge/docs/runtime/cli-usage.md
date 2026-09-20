# m0saic CLI usage

> Regenerated 2026-07-29 from the CLI source (not published) — re-verify with
> `m0saic --help` / `grep -c '.command(' the CLI source (not published) (14 as of
> 2026-07-29, **2 of them dev-gated** — `browse-templates` and `momo`; a 15th
> command, `telemetry`, registers via a helper — see below). So: 12 public
> commands + 2 dev-gated + `telemetry`.
>
> **2026-09-16:** `doctor` (added after this snapshot, dev-gated at 0.1.0) is now
> **public** — see its row; `browse-templates` and `momo` remain the only two
> `if (DEV_MODE)` commands. Public set is locked by `PUBLIC_COMMANDS` in
> the CLI source (not published) (15 incl. `doctor`, `hello-world`).

Source of truth: [the CLI source (not published)](the CLI source (not published))
(~5,866 lines). Inline-DSL arg parsing: [the CLI source (not published)](the CLI source (not published)).
Root `COMMANDS.md` (monorepo document, not published) documents the inline-DSL shorthand + test tiers.

## Entry routing — inline-DSL mode is first-class

Before commander ever runs, `index.ts:5915-5920` inspects `process.argv[2]`:
`isInlineM0()` (`inlineDsl.ts:36-41`) treats ANY first arg that is not a flag and
not in `KNOWN_SUBCOMMANDS` as an inline m0 string and dispatches to
`handleInlineDsl` instead of `program.parseAsync`.

```bash
m0saic "2(1,1)"            # static wireframe → output.png (default mode "wire")
m0saic "2(1,1)" --anim     # animated wireframe → output.mp4
m0saic "2(1,1)" --wire     # explicit static (same as default)
m0saic layout.m0           # .m0 / .m0c paths also accepted (index.ts:5787-5805)
```

- Args after the string parse via `parseInlineArgs` (`inlineDsl.ts:123`): `-w/-h`
  (default 1920×1080), `-o`, `--fps`, `--durationMs`, `--props`, `--save-mosaic`,
  `--save-m0`, `--prefer-pretty-m0`/`--prefer-canonical-m0`, `--disable-ui`,
  `--format`, `--alpha`, `--validate-only`, `--report`, `--toolchain`, plus the
  dev-gated dump flags (below).
- The string is validated with `validateM0String` before render (index.ts:5808);
  whitespace is stripped. Always shell-quote the DSL (parens/brackets).
- Output extension is coerced to match mode (`resolveInlineOutput`,
  `inlineDsl.ts:86` — `--anim -o out.png` → `out.mp4`).
- Mode maps onto the wireframe handlers: `wire` → `handleWireframe`, `anim` →
  `handleAnimatedWireframe` (index.ts:5846-5850).

## Command table

14 `.command(` registrations in `index.ts` + `telemetry` registered by
`registerTelemetryCommand(program)` (index.ts:5784 → `utils/telemetry.ts:372`).
Two of the 14 sit inside `if (DEV_MODE) { … }` and are absent from the public
help — see the DEV-GATED rows below.

| Command (index.ts line) | What it does |
|---|---|
| `make <input>` (4143) | Primary render: template id / `.mosaic` / `.mosaicx` → video or image. Full flag surface below. |
| `hello-world` | The first render — a thin alias for `make @m0saic/hello-world/v1` (the brand card; output defaults to `hello-world.mp4`). With `--template-repo <path...>` / `--community-repo <path>` it renders the loaded repo's **front door** instead: the first repo (load order) whose `repo.helloWorld` names a template that registered, announced as `Front door: <id> — <repo>'s hello-world`; no repos, or none that name one → the core card with a one-line why. Takes `-o -w -h --fps --durationMs --props --quiet --verbose` (no engine surface). Picker: the CLI source (not published). |
| `make-wireframe` (4372) | Static wireframe PNG from `--m0 <string>` or `--mfile <path>`. |
| `make-wireframe-animated` (4448) | Animated wireframe MP4 from `--m0`/`--mfile`; extra `--disable-ui`. |
| `flatten <input>` (4531) | Inline all `type:mosaic` children of a `.mosaic`/template into one flat JSON doc — no render. |
| `resolve <input>` (4642) | `.mosaicx` recipe → resolved `.mosaic` provenance doc, no ffmpeg; `--flatten` also inlines children. |
| `list-templates` (4751) | Print registered template ids (`--json`); annotates primitive/internal/deprecated. |
| `doctor <repoDir>` | **Public since 0.2.0** (dev-gated at 0.1.0; founder ruling 2026-09-16, BURN-DOWN D5 → publish). Run the template conventions over a template repo folder — the same checks its build gate (`tools/check-registry.mjs`) runs, from outside (agents, reviewers, forks, CI on a fork): definition-time + render-time conventions (the 13 throw-posture ones incl. `latticeSmooth`) and, when the repo commits `layout-fingerprints/` or `.layout.m0` sidecars, the fingerprint diff. `--json` (one object: `ok, repo, mode, loadDiagnostics, rendered, skipped, errors, warnings, notes, fingerprints`), `--sweep` (also render on the standard 1080p canvases → `canvasEnvelope`), `--entry <path>`, `--src <dir>`. Loads through `loadTemplateRepoFromPath` under the external origin scope, so conventions RECORD rather than throw and one bad template never hides the rest. **Runs the repo's template module bodies in-process** — prints a trust warning to stderr (not under `--json`). Exit 1 on any error-severity finding or a fatal load diagnostic. It is the pack-publishing contract for community/starter authors ("the publish requirement for packs"). Impl: the CLI source (not published); locked public by `__tests__/cli.surface.test.js`. |
| `browse-templates` (4794) | **DEV-GATED** (whole command inside `if (DEV_MODE)`, 4792): interactive TTY picker (template → variant → confirm → delegates to `make`). It drives the E2E variant matrix and writes to `test-output/` — a development harness, not a user surface. |
| `momo <message…>` (5042) | **DEV-GATED** (whole command inside `if (DEV_MODE)`, 5040): relay English geometry instruction to Momo in a running Mosaic Desktop over the loopback bridge; exit 0 applied / 2 not-applied / 1 couldn't-run. |
| `open [file]` (5345) | Open a file in Mosaic Desktop, or `--template` / `--make` to open the Make page via the bridge. See below. |
| `setup` (5496) | Download + install the pinned ffmpeg toolchain (`--gpl` default / `--lgpl` / `--yes` / `--platform-key`). Idempotent: detects installed golden slot or a PATH ffmpeg with libx264. **The only path that downloads** — renders never do. TTY asks `Download the pinned GPL ffmpeg build now?`; non-TTY / `CI` need explicit approval — `--yes` (or the `--gpl` / `--lgpl` repair flags), otherwise `No terminal to ask for approval on.` + exit 1, nothing downloaded. Ends `✓ ffmpeg is ready. Now run your m0saic command again.` |
| `activate <key>` (5612) | Validate + store a license key at `~/m0saic/license.json` (`M0SAIC_PRODUCT_KEY` env wins over the file). |
| `license` (5659) | Show tier/holder/expiry; `--remove` returns to free tier. |
| `update` (5711) | Check npm for a newer release; offers `npm i -g m0saic@latest`. |
| `versions` (5750) | Print package versions + ffmpeg baseline/runtime + resolved toolchain (`--json`). |
| `telemetry` (via helper) | Subcommands `status` (default) · `set-mode <standard\|local-only\|ghost>` · `list` · `preview` · `flush` · `clear`. Since 0.2.0 PUBLISHED builds transmit (Standard mode): day summary + today-so-far rollups after renders via a detached worker, to `https://m0saic.io/api/telemetry`. Workspace builds are dormant. Gates for harnesses: `M0SAIC_TELEMETRY=ghost` (nothing recorded), `M0SAIC_TELEMETRY_ENDPOINT=off` (nothing sent), `CI` (no send unless the endpoint is set by env). Full reference: `TELEMETRY.md` at the repo root. |

> **`decode-watermark` is GONE** (removed 2026-07-28). Recovering a forensic
> watermark is now an ordinary template — `@m0saic/forensic/watermark/verify/v1`,
> run through `make` — because a CLI can't grow a bespoke command per template
> family. The old `--ffmpeg <path>` override it carried is now the template's
> `ffmpegPath` prop.

## `make` input routing (index.ts:4348-4367)

1. Extension `.mosaic` → `handleMosaicFile` — parse JSON renderable, resolve
   relative media against the file's dir, plan + render.
2. Extension `.mosaicx` → `handleMosaicxFile` (3419) — the **resolve-then-render
   branch**: absolutize asset paths → apply the doc's `runner` block as option
   defaults (explicit flags win) → sibling `.m0v` auto-discovery → route
   `--inputs`/`--input-dir` into the single `template_invocation`'s
   `props.sourceIds` (ambiguous multi-invocation → error; zero inputs on an
   input-requiring template → renders a usage-card and exits non-zero) →
   `resolveMosaicx` → write resolved doc to a tmp `.mosaic` → delegate to
   `handleMosaicFile` (3631) so the post-resolve render path is shared.
   **Two roots accepted** (2026-08-14): `mosaicx_document` and
   `mosaicx_pipeline` (a root-level template chain — see
   `templates/data-pipeline.md`). The header echoes which one it read
   (`kind: mosaicx_pipeline`). A chain root has no top-level `sources`, so the
   `--inputs` routing and the usage-card gap detection above are inert for it;
   `runner` applies to both. Same for `resolve <input>`.
   **Duration is an ASK on this path** (2026-09-05): `--durationMs ??
   wrapper.durationMs` reaches the template as `userIntent.durationMs` via
   `mosaicxUserIntent` (`mosaicxRunner.ts:405`) on both `make` and `resolve`, so a
   self-timing template FITS its walk to the length (as Make does) instead of
   being trimmed to it. Mint ledger wrappers mirroring the template's natural
   length unless the variant is deliberately pinned.
3. No extension + starts with `@` → `handleTemplateMake` — template id, merge
   `--props` over `defaultProps`, render.
4. Anything else → error, exit 1.

## Exit codes (2026-09-15)

| Code | Meaning | File at `-o`? |
|---|---|---|
| `0` | Success — the output is the render asked for. | Yes |
| `1` | Failure — plan build threw, ffmpeg exited non-zero, validation failed, zero commands. | No / unusable |
| `2` | `momo` ran but did not apply a change. | n/a |
| `3` | **RENDER DEGRADED** — the renderable carried `engine.renderStatus: "error"`, so the output is an **error mosaic**. | **Yes**, valid media |

**Why 3 exists.** A template that hits bad input does not crash: it returns
`makeErrorMosaic(...)`, a readable card stamped `engine.renderStatus: "error"`.
That card renders, so the CLI used to write it and exit 0 — a caller whose only
success test was "did a file appear at the expected path?" reported success on a
picture of an error. 3 is deliberately not 1: exit 1 means "there is no output,
retry or clean up", which is false here. The engine still never aborts on the
marker — it renders, writes the file, and *then* the CLI reports.

**Detection** (`src/utils/collectRenderErrors.ts`) walks the WHOLE renderable
tree for the marker: document level, source level, nested `children`
(recursively), and pipeline `steps` (dispatching per step, so a nested pipeline
is walked too). **One error mosaic anywhere in the tree degrades the whole run** —
a batch where 4 of 5 steps are fine still exits 3, because one deliverable is an
error card. `errors[].path` in the sidecar (`children.hero.sources[0]`,
`steps[1].sources[0]`) says which.

> ⚠️ Historical: the walker read `doc.config?.sources`, but
> `MosaicDocument.sources` was hoisted out of `config` long ago — so every
> source-level marker (exactly where `makeErrorMosaic` puts it) was invisible and
> every error-mosaic render exited 0. `mosaicxRunner` hand-promoted its error to
> doc level to work around it; both the bug and the workaround are gone.

**Classification** (`src/utils/renderOutcome.ts` — the single decision point; all
12 report call sites in `index.ts` route through it):

- **Hard errors beat engine errors.** A run with both is 1, not 3.
- A **zero-command plan** counts its engine errors as hard — there is no output
  to call degraded — so that path stays 1.
- Free vs paid tier is **orthogonal**. The marker is read off the document, not
  the file; the free-tier QR wrap runs before classification, so on free tier the
  error card ships stamped and still exits 3. A stamp failure is swallowed as a
  warning and never changes the exit code.

With `--report` the same verdict is machine-readable, so a caller that parses the
sidecar never needs the exit code and a caller that reads exit codes never needs
the JSON:

```json
{ "ok": false, "exitCode": 3, "renderStatus": "degraded",
  "renderErrorCodes": ["ENGINE_ERROR"],
  "errors": [{ "code": "ENGINE_ERROR", "message": "Quote Card: quote must not be empty", "path": "sources[0]" }] }
```

## `make` flags

**Core** — `-w/--width` and `-h/--height` are `requiredOption`s. Then:
`-o/--output` (defaults `out.mp4` / `out.png`, index.ts:172-173), `--fps` (1–120),
`--durationMs` (>0), `--format`/`--output-kind` (`video|image`),
`--alpha`/`--no-alpha`, `--props <jsonOrPath>` (inline JSON **or** `@path/to/json`
— `utils/readJsonArg.ts:18` strips the `@` and reads the file),
`--validate-only` (exit 0/1/3, no render — 3 = the renderable IS an error
mosaic; prints `Validation DEGRADED`), `--report` (`.output.json` /
`.validate.json` sidecars, both carrying `renderStatus` + `renderErrorCodes`),
`--save-mosaic [path]`, `--save-m0 [path]`,
`--keep-temp`, `--quiet`, `--verbose`, `--prefer-pretty-m0` /
`--prefer-canonical-m0` (printed-m0 form only; note: NOT `--prefer-*-m0saic`),
`--background-color <color>`, `--template-repo <path...>` +
`--template-repo-entry <file>` (external template repos), `--community-repo <path>`
(ONE checkout of the official community repo — see the community gate below).

**Encode surface** (index.ts:4231-4338, mirrors the Make page's Advanced panel;
precedence: flags > `.m0v` preset > doc-on-disk > engine default):
`--target <preset>` (`web-mp4|web-webm|alpha-mov|image-png|image-jpeg|animated-gif|audio-mp3|audio-wav`),
`--container`, `--video-codec`, `--audio-codec`, `--pixel-format`, `--bitrate`
(CRF wins on conflict), `--crf`, `--encoder-preset`, `--encoder-profile`,
`--encoder-level`, `--encoder-options <k=v,…>`, `--gop-size`, `--audio-bitrate`,
`--audio-sample-rate`, `--audio-channel-layout`, `--no-audio` (`-an`),
`--color-space`/`--color-range`/`--color-primaries`/`--color-transfer`
(metadata-only), `--metadata-title`/`-description`/`-author`/`-copyright`/`-comment`.

**Batching / multi-output**: `--inputs <files...>` (populates `sourceIds`; wins
over `--input-dir`), `--input-dir <path>` (+ `--recursive` for depth-first walk),
`--output-pattern <pattern>` (tokens `{{base}} {{ext}} {{stepName}} {{index}}
{{i}} {{date}} {{batch}} {{label}}`; collisions get `-1,-2,…`), `--batch <name>`.

**`.m0v`**: `--m0v <path>` loads a Mosaic Vocabulary file two ways — named
outputs onto `ctx.userIntent.outputs` (template-consultative) AND a post-render
merge onto the renderable **by index** when entry counts match
(index.ts:4218-4221; `BaseRenderOptions` docstring 541-557).

**Toolchain**: `--toolchain <name>` is a **global program option**
(index.ts:526), not make-specific — a named entry from `m0saic.local.json`, with
implicit `gpl`/`lgpl` golden slots merged in. Resolution precedence: `--toolchain`
flag > `M0SAIC_TOOLCHAIN` env > config `defaultToolchain` > PATH/golden fallback
(`utils/toolchainConfig.ts:129`). There is **no** `--ffmpeg` anywhere on the CLI
any more (it left with `decode-watermark`) — the equivalent is the verify
template's `ffmpegPath` prop; `--platform-key` only on `setup`.

**No-ffmpeg gate** (`utils/ensureFfmpeg.ts` via `ensureRenderToolchain()`, index.ts
~404, first thing in every render handler): resolved ffmpeg fails to probe → the
4-line `ffmpeg isn't detected.` message (points at `setup`) and **exit 1** — TTY,
piped and CI alike; no prompt, no inline download, no auto-install (founder
ruling 2026-09-16; supersedes cli-v1-publish.md Phase 2). `setup` is the only
downloader, and it too never fetches without approval (TTY prompt, or `--yes`).
Spell every `setup` hint with `cliSetupCommand()` (`utils/invocation.ts`):
`npx m0saic setup` under npx, `m0saic setup` installed.

**Perf**: `--perf [path]` writes a `.perf.json` sidecar — per-ffmpeg-command
timing rolled up by mosaic node (names the bottleneck panel/template).

**DEV-GATED** (each wrapped in `.hideHelp(!DEV_MODE)`; `DEV_MODE =
process.env.M0SAIC_DEV === "1"` at index.ts:58, compile-stripped to `false` in
the published artifact): `--dev` (commands + timings), `--print-commands`,
`--save-plan [path]`, `--save-commands [path]`. Same gating inside inline-DSL
mode (`inlineDsl.ts:148-154`). Also dev-gated: the whole `momo` command, the
whole `browse-templates` command, and `open`'s
`--agent-note`/`--agent-question`. `--save-mosaic` and `--save-m0` are NOT gated,
and neither is `doctor` (public since 0.2.0).

> Note: a dev-gated command's NAME still appears in `KNOWN_SUBCOMMANDS`
> (`inlineDsl.ts:11-29`), outside the gate — the inline-DSL router has to know
> `momo` is a subcommand and not an m0 string. So grepping a shipped tarball for
> `momo` / `browse-templates` finds hits; that is the router table, not the
> gated implementation.

## External template repos and the community gate (2026-09-16)

**Three reserved identities, exact-match, nothing else is checked:** template
namespaces `@m0saic/` and `@m0saic-dev/`, repo id `@m0saic-community`
(`index.ts:907-909`; registry compare is case-insensitive, `templateRegistry.ts:112`).
Every other namespace / repo id is open. `--template-repo` never grants anything.

**The grant.** `--community-repo <path>` says "this IS the official repo"; the
`@m0saic-dev/` grant comes only from `verifyCommunityRelease()` (`@m0saic/product`
`communityRelease.ts`) passing on the checkout's `release.json` against
`LICENSE_PUBLIC_KEYS` (`publicKeys.ts` — the licence k1 family; rotation = append
`k2`, ship, sign with `M0SAIC_SIGNING_KID=k2`; older CLIs report `unknown-kid`).
The gate runs BEFORE the entry module is imported. All gate/notice lines go to
stderr (survive `--quiet`, keep `--json` stdout clean):

- ok → `✓ community repo verified: <tag> (signed, <kid>)`
- else → `⚠  <path> is not a verified release of the official community repo
  (<reason>). Loaded as an ordinary template repo — its @m0saic-dev/ ids are
  refused. Get the official checkout: the link on m0saic.io/community` → the
  reserved ids are refused in ONE collapsed line, `⚠  [template-repo]
  TEMPLATE_ID_RESERVED_NAMESPACE: refused <N> ids in reserved namespace
  (@m0saic-dev/…): <id1>, <id2>, <id3>, …` (other rejection codes stay one line
  each) → the existing `❌ Refusing to use template repo` block → **exit 1**.

**`release.json` v1:** `{ schemaVersion: 1, tag, publishedAt, treeSha256,
signature: { kid, alg: "ed25519", sig: <base64url> } }` (`--unsigned` omits
`signature`; the legacy `{ tag, publishedAt }` reads as `missing-signature`).
Tree = every file under `dist/**` + `template-manifest.json` + `package.json`,
sorted POSIX paths, one `"<path>\0<sha256>\n"` line each; `*.json` hashed on
`JSON.stringify(JSON.parse(text))` (BOM stripped; CRLF / re-indent survive, a
key reorder does not), other files raw bytes; no symlink is ever followed.
Payload `"m0saic-community-release/v1\n<tag>\n<publishedAt>\n<treeSha256>\n"`
(`publishedAt` must be ISO 8601, else `malformed`). Ladder:
`missing-release → malformed → missing-signature → unknown-kid → bad-signature
→ symlink-in-tree / foreign-modules → tree-mismatch → ok` — signature before
tree, so `tree-mismatch` = authentic release with edited dist/manifests,
`bad-signature` = forged `release.json`; the two structural refusals
(`symlink-in-tree`: ANY symlink under `dist/**`, `dist` itself or a signed
root file; `foreign-modules`: a `node_modules` dir at the root or under
`dist/`) sit between them and carry the offending path in the notice —
`(symlink-in-tree: dist/node_modules)`, `(foreign-modules: node_modules)`.
`publishedAt` is signed but there is still no anti-rollback (an older
authentic release verifies).

**A checkout never supplies `@m0saic/*` to itself.** The loader
(`@m0saic/platform` `template-repos/hostFirstResolution.ts`, installed by
`loadTemplateRepoFromPath` before the entry import) resolves every
`@m0saic/<pkg>[/<subpath>]` require whose parent file lies under a loaded
repo root from the HOST's own `node_modules` walk — the CLI's vendored copies,
the desktop's bundle, the workspace under dev — never from the checkout. So a
clone with nothing installed loads anywhere (0.2.0 is the first CLI that
can), and a `node_modules/@m0saic/template-utils` planted beside a tree is
never evaluated, via `--community-repo` or `--template-repo` alike. Every
other specifier (`sharp`, `@twemoji/svg`, relative paths) resolves as before,
from the checkout. CommonJS only — an `.mjs` entry's static `import`s use the
ESM resolver, which has no hook.

**Minting:** `scripts/sync-community-templates.mjs --tag <tag> --out <dir>` signs
with `M0SAIC_SIGNING_KEY_FILE` (REQUIRED — no default path; production laptop
only) under `M0SAIC_SIGNING_KID` (default `k1`), self-verifies against the
embedded keys, writes `.gitattributes` (`* -text`). Unset or missing key =
refused, never a silent unsigned release; `--unsigned` = loud banner, a snapshot
no shipped CLI trusts.

**DEV seam (workspace builds only, inside `if (DEV_MODE)`):** reasons
`missing-release` / `missing-signature` are still granted — `✓ community repo:
<path> (dev build: unsigned community checkout trusted)` (the in-repo
https://github.com/m0saic-project/m0saic-community-templates/blob/main has no `release.json`) — and
`M0SAIC_COMMUNITY_TRUST_KEY_PEM` (+ `M0SAIC_COMMUNITY_TRUST_KEY_KID`, default `k1`)
adds a public key for tests. Tampered tree, forged release or unknown kid are
refused even in dev. The tarball folds `process.env.M0SAIC_DEV` to `"0"` and the
audit bans the token, so none of this ships.

**Lookalikes are a display concern** — one stderr line for UNSIGNED repos, never a
refusal: `⚠  [template-repo] <subject> is not an official m0saic namespace — only
@m0saic/ and @m0saic-dev/ are, and they are signed.` Subject: loaded publisher
namespaces starting with `@m0saic` that are not exactly the two reserved ones →
else a repoId matching `/m0saic|mosaic/i` → else `"<displayName>" (<repoId>)`.
Never for repoId exactly `@m0saic-community`: via `--template-repo` that gets
`⚠  [template-repo] repo id "@m0saic-community" is reserved for the official
community repo and this checkout is unverified — loading it under ordinary
rules.` A `--community-repo` checkout that fails the gate gets ONLY the
not-verified notice.

**Desktop:** `installVersion()` runs `validateCommunityTree` → `verifyCommunityTree`
(inline-requires `@m0saic/product`) → refuses `tag-mismatch`; failure =
`{ ok:false, error: "downloaded tree rejected: release signature not verified
(<reason>): <detail>", reason }` on the existing IPC path; `installed.json` gains
`signedBy` + `treeSha256`; seam `installVersion({ releasePublicKeys })`. The
seed/installed load path (`loadCommunityRepo`) does not re-verify; consent gate
unchanged.

Help wording for `make` / `hello-world` / `list-templates` is ONE string,
test-locked (`__tests__/cli.flags.test.js`): "…Grants the @m0saic-dev/ namespace
when its release signature verifies (unsigned or modified checkouts load as
ordinary repos); the community checkout loads only this way".

### Hardening (rounds 2 + 3, 2026-09-16)

**Host-first `@m0saic/*` resolution.** https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/template-repos/hostFirstResolution.ts (wired in `loadTemplateRepoFromPath.ts` via `registerHostFirstRepoRoot(repoRoot)` before the native `import(file://…)` of the entry): ONE wrapper around Node's real `Module._resolveFilename` (found by walking the prototype chain — under Jest `node:module` exports a subclass copy), installed once per process, persistent so render-time lazy requires are covered. A request matching `/^@m0saic\/[^/\\]+(?:\/.*)?$/` whose requesting module lies under a registered root (realpath'd) is resolved from the HOST's own `node_modules` walk — never the checkout's. Everything else (relative paths, non-`@m0saic` deps, host code) is untouched. CJS only. Consequences: a community clone loads from ANY directory with no `node_modules` (before this, `--community-repo` only worked inside the monorepo); a planted `node_modules/@m0saic/*` beside a verified tree is never evaluated, via either flag; a starter's `file:` link to `@m0saic/template-utils` resolves to the same physical package — no drift.

**Fail-closed tree verification** (`inspectReleaseTree` in `communityRelease.ts`; desktop mirror `inspectCommunityTree` in the Mosaic Desktop / Web app source (not published), run by `installVersion`). A release tree is plain files and directories, nothing else. Refused, in this order after the signature check and before the hash compare: `symlink-in-tree` (ANY symlink — file or dir — under `dist/**`, `dist` itself, a signed root file, or ANY entry at the checkout root); `special-file-in-tree` (FIFO / socket / device anywhere in the same places — a FIFO named `dist/publishers.js` shadows the signed `dist/publishers/` dir and blocks or executes whoever opens it); `foreign-modules` (a `node_modules` dir at the root or under `dist/`, matched case-insensitively). `verifyCommunityRelease` lstats `release.json` before opening it (a FIFO planted there used to hang the verifier). The hasher THROWS `ReleaseTreeError` on a special entry rather than skipping it; `signCommunityRelease` refuses to sign such a tree. The signed payload is `"m0saic-community-release/v1\n<tag>\n<publishedAt>\n<treeSha256>\n"`. The CLI notice carries the detail for these reasons — `(foreign-modules: node_modules)`; for `special-file-in-tree` the CLI does NOT load the folder at all (an ordinary load provably hangs): notice + `❌ Refusing to use template repo` + exit 1.

**Community deps.** The `@m0saic-dev/community-m` pack (the only `sharp` / `@twemoji/svg` user) was deleted as defunct on 2026-09-16; both left the community `package.json` and BOTH allowlists (`dep-allowlist.json` ↔ `TEMPLATE_REPO_DEP_ALLOWLIST`, lockstep-tested). Community templates may import only what the hosts ship: `@m0saic/{types,template-utils,dsl-stdlib,platform,dsl}` + `node:path`. A native or third-party runtime dep is a founder decision. `sharp` survives only as a root devDependency for core/templates tests.

**Accepted residual.** A third-party `--template-repo` checkout with its own `node_modules` runs its own copies of non-`@m0saic` deps — third-party code, with the notice printed; it cannot obtain a reserved identity that way (adversary-verified). DEV builds (`M0SAIC_DEV=1`, compile-stripped from the tarball) still trust an unsigned checkout for `missing-release` / `missing-signature` only; a tampered or forged tree is refused even in dev.

## Wireframe commands

`make-wireframe` / `make-wireframe-animated` take the layout as `--m0 <string>`
(inline DSL — the flag is `--m0`, not `--m0saic`) or `--mfile <path>`, plus the
same core/save/report/`--m0v`/`--output-pattern` surface as `make` (no encode
surface, no `--inputs`). Animated adds `--disable-ui` (index.ts:4504).

## `m0saic open` — pointer only

The canonical protocol (candidate file naming, agent block, iteration ritual,
`--template` hot-reload loop) lives in
[https://github.com/m0saic-project/m0saic-sandbox/blob/main/packages/sandbox/agent.md](https://github.com/m0saic-project/m0saic-sandbox/blob/main/packages/sandbox/agent.md) — read that,
not this. Shape only: `open <file>` accepts `.m0 .m0c .m0p .m0v .mosaic
.mosaicx` and routes to Mosaic Desktop (auto-detects a running dev electron on
macOS; `--app <path>` override); `open --template <id> [--props/--props-file]`
opens the Make page via the loopback bridge, hot-reloading fresh
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/dist first (`--no-reload` to skip); `open --make
<file.mosaicx>` opens an authored `.mosaicx` in Make and adopts it for the
agent loop.

## Failure modes

- `spawnSync m0saic EACCES` — the CLI isn't built/linked on this machine:
  `cd the CLI source (not published) && npm run build && npm link`.
- No ffmpeg at all → `ffmpeg isn't detected.` (4 lines), exit 1, nothing
  downloaded (`ensureRenderToolchain()`, index.ts ~404); run `m0saic setup`
  (`npx m0saic setup` under npx), then re-run. A broken golden slot prints
  `❌ Toolchain "gpl" (golden) is broken … Re-install it:  m0saic setup --gpl`.
- Free tier re-encodes every deliverable (QR stamp wrap) — codecs/durations
  change, breaking probe-based assertions. Check `npm run tier:status` first;
  full rule in the maintainers' agent contract §7.7 (not published).
- Non-zero ffmpeg exits print a core-computed failure classification after the
  exit-code line (`printFfmpegFailure`, index.ts:98) — read it before rerunning
  with `--verbose`.
- Invalid m0 strings fail fast at validation (`validateM0String`), not inside
  ffmpeg; `SPLIT_EXCEEDS_AXIS` means the split count exceeds the pixel axis —
  see `docs/handbook/feasibility-precision-quantization.md`.
