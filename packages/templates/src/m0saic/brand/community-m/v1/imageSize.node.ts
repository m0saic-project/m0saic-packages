import * as fs from "fs";
import type { ImageSize } from "./reveal";

/** Image dimensions from the PNG header (the repo commits PNG tiles). Unknown → square (only the aspect matters). */
export function readImageSize(abs: string): ImageSize {
  try {
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(24);
      const n = fs.readSync(fd, buf, 0, 24, 0);
      if (n === 24 && buf.toString("latin1", 1, 4) === "PNG" && buf.toString("latin1", 12, 16) === "IHDR") {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (width > 0 && height > 0) return { width, height };
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* fall through */
  }
  return { width: 1, height: 1 };
}
