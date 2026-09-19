import * as fs from "fs";
import * as path from "path";
import {
  registerFont,
  resolveFontFile,
  listFontFamilies,
} from "./fontRegistry";
// Importing bundledFonts self-registers the Roboto pack.
import "./bundledFonts";

const base = (p: string) => p.replace(/\\/g, "/").split("/").pop();

describe("font registry — bundled Roboto", () => {
  it("resolves the four core combos to distinct variant files", () => {
    expect(base(resolveFontFile({ family: "Roboto" })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(
      base(resolveFontFile({ family: "Roboto", weight: 700 })!.path),
    ).toBe("Roboto-Bold.ttf");
    expect(
      base(resolveFontFile({ family: "Roboto", style: "italic" })!.path),
    ).toBe("Roboto-Italic.ttf");
    expect(
      base(
        resolveFontFile({ family: "Roboto", weight: 700, style: "italic" })!
          .path,
      ),
    ).toBe("Roboto-BoldItalic.ttf");
  });

  it("maps the CSS weight keywords (normal=400, bold=700)", () => {
    expect(base(resolveFontFile({ family: "Roboto", weight: "normal" })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(base(resolveFontFile({ family: "Roboto", weight: "bold" })!.path)).toBe(
      "Roboto-Bold.ttf",
    );
  });

  it("snaps numeric weights to the nearest available variant", () => {
    // 100..550 → 400 (Regular), 600..900 → 700 (Bold)
    expect(base(resolveFontFile({ family: "Roboto", weight: 100 })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(base(resolveFontFile({ family: "Roboto", weight: 500 })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(base(resolveFontFile({ family: "Roboto", weight: 900 })!.path)).toBe(
      "Roboto-Bold.ttf",
    );
    // nearest preserves the requested style
    expect(
      base(resolveFontFile({ family: "Roboto", weight: 900, style: "italic" })!.path),
    ).toBe("Roboto-BoldItalic.ttf");
  });

  it("walks the family stack and skips generics, falling back to bundled Roboto", () => {
    expect(base(resolveFontFile({ family: "Nope, Roboto" })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(base(resolveFontFile({ family: "Nope, sans-serif" })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(base(resolveFontFile({ family: "sans-serif" })!.path)).toBe(
      "Roboto-Regular.ttf",
    );
    expect(base(resolveFontFile({})!.path)).toBe("Roboto-Regular.ttf");
  });

  it("real variants resolve with no faux flags", () => {
    const r = resolveFontFile({ family: "Roboto", weight: 700, style: "italic" })!;
    expect(r.faux).toEqual({ bold: false, italic: false });
  });

  it("lists Roboto with its weights and styles", () => {
    const roboto = listFontFamilies().find((f) => f.family === "Roboto")!;
    expect(roboto.weights).toEqual([400, 700]);
    expect(roboto.styles.sort()).toEqual(["italic", "normal"]);
  });
});

describe("font registry — bundled JetBrains Mono", () => {
  it("resolves the four core combos to distinct variant files", () => {
    expect(base(resolveFontFile({ family: "JetBrains Mono" })!.path)).toBe(
      "JetBrainsMono-Regular.ttf",
    );
    expect(
      base(resolveFontFile({ family: "JetBrains Mono", weight: 700 })!.path),
    ).toBe("JetBrainsMono-Bold.ttf");
    expect(
      base(resolveFontFile({ family: "JetBrains Mono", style: "italic" })!.path),
    ).toBe("JetBrainsMono-Italic.ttf");
    expect(
      base(
        resolveFontFile({
          family: "JetBrains Mono",
          weight: 700,
          style: "italic",
        })!.path,
      ),
    ).toBe("JetBrainsMono-BoldItalic.ttf");
  });

  it("lists the bundled family and ships its OFL-1.1 license alongside it", () => {
    const family = listFontFamilies().find(
      (entry) => entry.family === "JetBrains Mono",
    );
    expect(family).toEqual({
      family: "JetBrains Mono",
      weights: [400, 700],
      styles: ["normal", "italic"],
    });

    const regularPath = resolveFontFile({ family: "JetBrains Mono" })!.path;
    const licensePath = path.join(
      path.dirname(regularPath),
      "JetBrainsMono-OFL-1.1.txt",
    );
    expect(fs.readFileSync(licensePath, "utf8")).toContain(
      "SIL Open Font License, Version 1.1",
    );
  });
});

describe("font registry — custom families + faux flags", () => {
  it("flags faux italic when a family has no italic variant", () => {
    registerFont({ family: "OnlyUpright", weight: 400, style: "normal", path: "/x/OnlyUpright.ttf" });
    const r = resolveFontFile({ family: "OnlyUpright", style: "italic" })!;
    expect(base(r.path)).toBe("OnlyUpright.ttf");
    expect(r.faux.italic).toBe(true);
  });

  it("flags faux bold when a family tops out lighter than the request", () => {
    registerFont({ family: "OnlyLight", weight: 300, style: "normal", path: "/x/OnlyLight.ttf" });
    const r = resolveFontFile({ family: "OnlyLight", weight: 800 })!;
    // same style exists → nearest weight, no faux (a real neighbouring weight)
    expect(r.faux.bold).toBe(false);
    // but if the only variant is the wrong style, faux.bold reflects the gap
    const r2 = resolveFontFile({ family: "OnlyLight", weight: 800, style: "italic" })!;
    expect(r2.faux.italic).toBe(true);
    expect(r2.faux.bold).toBe(true);
  });

  it("registerFont replaces an existing (family,weight,style) entry", () => {
    registerFont({ family: "Dup", weight: 400, style: "normal", path: "/a/Dup.ttf" });
    registerFont({ family: "Dup", weight: 400, style: "normal", path: "/b/Dup.ttf" });
    expect(resolveFontFile({ family: "Dup" })!.path).toBe("/b/Dup.ttf");
  });
});
