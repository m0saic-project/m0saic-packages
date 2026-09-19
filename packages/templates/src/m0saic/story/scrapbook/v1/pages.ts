import type { ClaimImageLike } from "./placeholder";
import { standInPhotoUrl } from "./placeholder";
import type { ResolvedProps } from "./props";

/**
 * What the film is actually made of: an ordered list of pages, each a
 * picture and (maybe) a line about it.
 *
 * The two props are index-aligned lists rather than a list of objects
 * because that is what the editor can bind: a note is `notes[i]`, editable
 * in place on the page it belongs to. It also means either can arrive
 * first — write the words before the pictures exist, or the other way.
 */
export type Page = {
  index: number;
  /** The picture: a file the author supplied, or a generated stand-in. */
  image: ClaimImageLike;
  /** The line under it. Empty = a wordless page, which is allowed. */
  note: string;
  /** True when nothing real backs this page yet. */
  standIn: boolean;
};

/** How many pages to lay out when no pictures have arrived yet. */
export const STAND_IN_PAGES = 4;

/** A stand-in line, so the layout is judged with words in it rather than blanks. */
function standInNote(i: number, hasPhotos: boolean): string {
  if (hasPhotos) return "";
  return [
    "the summer everything changed",
    "she never let me carry anything",
    "we drove until the map ran out",
    "and then there were four of us",
  ][i % 4];
}

/**
 * Resolve pages from the props. With no photos the film is laid out with
 * stand-ins so its pacing can be judged before any real picture exists;
 * with photos, the count follows the photos and the notes fill in beside
 * them (a missing note is a wordless page, never an error).
 */
export function resolvePages(p: ResolvedProps): Page[] {
  const photos = p.photos.filter((s) => typeof s === "string" && s.trim() !== "");
  const count = photos.length > 0 ? photos.length : STAND_IN_PAGES;
  return Array.from({ length: count }, (_, i) => {
    const real = photos[i];
    return {
      index: i,
      image: real ? { kind: "file" as const, path: real } : { kind: "data-uri" as const, uri: standInPhotoUrl(i, p.paperColor) },
      note: typeof p.notes[i] === "string" ? p.notes[i] : standInNote(i, photos.length > 0),
      standIn: !real,
    };
  });
}
