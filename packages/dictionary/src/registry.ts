/**
 * Dictionary registry — merges entries from multiple dictionary sources.
 *
 * The official dictionary is pre-registered. External dictionaries
 * (private, community, custom) register via `registry.register(source)`.
 *
 * @example
 * import { registry } from "@m0saic/dictionary";
 * import { source as myDict } from "my-custom-dictionary";
 * registry.register(myDict);
 *
 * // Now registry.all includes entries from both dictionaries
 * registry.all.forEach(e => console.log(e.id));
 */

import type {
  MosaicDictionaryEntryResolved,
  MosaicDictionarySource,
  MosaicRankSet,
  MosaicMaskSetFile,
} from "@m0saic/types";

export class DictionaryRegistry {
  private sources: MosaicDictionarySource[] = [];
  private _all: MosaicDictionaryEntryResolved[] | null = null;
  private _byId: Record<string, MosaicDictionaryEntryResolved> | null = null;

  /**
   * Register a dictionary source. Entries from this source are merged
   * into the registry's unified view.
   *
   * Each entry gets `assetsBase` stamped from the source's `assetsBasePath`
   * so that `resolveM0saic` and preview images resolve to the correct URL.
   */
  register(source: MosaicDictionarySource): void {
    for (const entry of source.all) {
      entry.assetsBase = source.assetsBasePath;
    }

    const existingIds = new Set(this.sources.flatMap((s) => s.all.map((e) => e.id)));
    for (const entry of source.all) {
      if (existingIds.has(entry.id)) {
        console.warn(
          `[dictionary] ID collision: "${entry.id}" from "${source.name}" ` +
            `shadows an entry from a previously registered source.`,
        );
      }
    }

    this.sources.push(source);
    this._all = null;
    this._byId = null;
  }

  /** All entries merged from all registered sources. */
  get all(): MosaicDictionaryEntryResolved[] {
    if (!this._all) {
      this._all = this.sources.flatMap((s) => s.all);
    }
    return this._all;
  }

  /** All entries keyed by ID. Last-registered source wins on collision. */
  get byId(): Record<string, MosaicDictionaryEntryResolved> {
    if (!this._byId) {
      this._byId = {};
      for (const source of this.sources) {
        Object.assign(this._byId, source.byId);
      }
    }
    return this._byId;
  }

  /** Look up a rank set across all sources. */
  getRankSet(entryId: string, name: string): MosaicRankSet {
    for (const source of this.sources) {
      if (source.byId[entryId]) {
        return source.getRankSet(entryId, name);
      }
    }
    throw new Error(`Entry "${entryId}" not found in any registered dictionary source.`);
  }

  /** Look up a mask set across all sources. */
  getMaskSet(entryId: string, name: string): MosaicMaskSetFile {
    for (const source of this.sources) {
      if (source.byId[entryId]) {
        return source.getMaskSet(entryId, name);
      }
    }
    throw new Error(`Entry "${entryId}" not found in any registered dictionary source.`);
  }
}

/** Global dictionary registry. */
export const registry = new DictionaryRegistry();
