import metadataJson from "./metadata.json";
import { m0saic as m0 } from "./m0saic";
import type {
  MosaicDictionaryEntry,
  MosaicDictionaryEntryResolved,
} from "@m0saic/types";

const metadata = metadataJson as unknown as Omit<MosaicDictionaryEntry, "m0">;

export const entry: MosaicDictionaryEntryResolved = {
  ...metadata,
  m0,
};

export default entry;
