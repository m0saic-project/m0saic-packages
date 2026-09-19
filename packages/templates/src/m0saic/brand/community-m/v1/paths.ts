import * as path from "path";

/**
 * Where the bundled Community M seed lives: the `@m0saic/community-m`
 * workspace package (the public repo's tree, shipped inside the app). Used
 * when `communityDir` is "" so the template renders at defaults with no
 * network and no host pre-fill.
 */
export function seedCommunityDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgJson = require.resolve("@m0saic/community-m/package.json");
  return unpackedAsarPath(path.dirname(pkgJson));
}

/**
 * Inside a packaged Electron app, `require.resolve` points INTO app.asar,
 * which ffmpeg cannot open; electron-builder's `asarUnpack` mirrors the
 * files to `app.asar.unpacked/`. Same helper as brand/qr-stamp — a no-op
 * for the CLI.
 */
export function unpackedAsarPath(p: string): string {
  const inAsar = `${path.sep}app.asar${path.sep}`;
  if (!p.includes(inAsar)) return p;
  return p.split(inAsar).join(`${path.sep}app.asar.unpacked${path.sep}`);
}
