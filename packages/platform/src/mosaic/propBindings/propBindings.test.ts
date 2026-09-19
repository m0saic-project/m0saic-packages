import type { MosaicTemplatePropDefinition } from "@m0saic/types";
import {
  bindingCompanion,
  bindingOnClear,
  bindingSeedDraft,
  bindingRange,
  classifyBindableProp,
  isListPropType,
  isMediaPropType,
  isRectPickerProp,
  isRectListPickerProp,
  propDefinitionAtPath,
  resolveBindableProp,
  type PropSchemaMap,
} from "./propBindings";

const def = (
  type: MosaicTemplatePropDefinition["type"],
  meta?: MosaicTemplatePropDefinition["meta"],
  fields?: Record<string, MosaicTemplatePropDefinition>,
): MosaicTemplatePropDefinition => ({ type, required: false, ...(meta ? { meta } : {}), ...(fields ? { fields } : {}) });

// Strict record here (every key present) so the assertions can index it; the
// predicate itself accepts the wider PropSchemaMap (Partial schemas).
const SCHEMA: Record<string, MosaicTemplatePropDefinition> = {
  title: def("string"),
  count: def("number"),
  labels: def("string[]"),
  values: def("number[]"),
  on: def("boolean"),
  preset: def("string", { constraints: { oneOf: ["dark", "light"] } }),
  accent: def("string", { constraints: { isColor: true } }),
  picked: def("string", { control: { options: { source: "x" } as any } }),
  handle: def("string", { control: { optionsFromConnection: { kind: "github" } as any } }),
  secret: def("string", { ui: { hidden: true } }),
  titles: def("group", undefined, { title: def("string"), sub: def("string", { constraints: { oneOf: ["a"] } }) }),
  payload: def("json"),
};

const _widen: PropSchemaMap = SCHEMA; // a strict schema is a valid PropSchemaMap
void _widen;

describe("propDefinitionAtPath", () => {
  it("resolves top-level and dotted paths through group fields", () => {
    expect(propDefinitionAtPath(SCHEMA, "title")).toBe(SCHEMA.title);
    expect(propDefinitionAtPath(SCHEMA, "titles.title")).toBe(SCHEMA.titles.fields!.title);
  });
  it("misses unknown keys, non-group descent, empty segments and no schema", () => {
    expect(propDefinitionAtPath(SCHEMA, "nope")).toBeUndefined();
    expect(propDefinitionAtPath(SCHEMA, "title.x")).toBeUndefined();
    expect(propDefinitionAtPath(SCHEMA, "titles.nope")).toBeUndefined();
    expect(propDefinitionAtPath(SCHEMA, "titles.")).toBeUndefined();
    expect(propDefinitionAtPath(SCHEMA, "")).toBeUndefined();
    expect(propDefinitionAtPath(undefined, "title")).toBeUndefined();
  });
});

describe("classifyBindableProp", () => {
  it("binds free-text strings and numbers", () => {
    expect(classifyBindableProp(SCHEMA.title)).toBe("string");
    expect(classifyBindableProp(SCHEMA.count)).toBe("number");
  });
  it("ignores an index on a scalar", () => {
    expect(classifyBindableProp(SCHEMA.title, 3)).toBe("string");
  });
  it("binds list ELEMENTS only with a non-negative integer index", () => {
    expect(classifyBindableProp(SCHEMA.labels, 0)).toBe("string");
    expect(classifyBindableProp(SCHEMA.values, 4)).toBe("number");
    expect(classifyBindableProp(SCHEMA.labels)).toBeNull();
    expect(classifyBindableProp(SCHEMA.values, -1)).toBeNull();
    expect(classifyBindableProp(SCHEMA.values, 1.5)).toBeNull();
  });
  it("color-valued strings are kind color (a picker), incl. list elements and structured leaves", () => {
    expect(classifyBindableProp(SCHEMA.accent)).toBe("color");
    expect(classifyBindableProp(def("string", { control: { colorPicker: true } }))).toBe("color");
    expect(classifyBindableProp(def("string[]", { constraints: { isColor: true } }), 2)).toBe("color");
    expect(classifyBindableProp(def("string[]", { constraints: { isColor: true } }))).toBeNull();
    expect(classifyBindableProp(def("json" as never), { path: [0, "color"], kind: "color" })).toBe("color");
  });

  it("refuses closed pickers, hidden props and other types", () => {
    expect(classifyBindableProp(SCHEMA.preset)).toBeNull();
    expect(classifyBindableProp(SCHEMA.picked)).toBeNull();
    expect(classifyBindableProp(SCHEMA.handle)).toBeNull();
    expect(classifyBindableProp(SCHEMA.secret)).toBeNull();
    expect(classifyBindableProp(SCHEMA.on)).toBeNull();
    expect(classifyBindableProp(SCHEMA.payload)).toBeNull();
    expect(classifyBindableProp(SCHEMA.titles)).toBeNull();
    expect(classifyBindableProp(undefined)).toBeNull();
  });
});

describe("resolveBindableProp / isListPropType", () => {
  it("resolves a dotted binding to its def and kind", () => {
    expect(resolveBindableProp(SCHEMA, { propKey: "titles.title" })).toEqual({ def: SCHEMA.titles.fields!.title, kind: "string", path: [] });
    expect(resolveBindableProp(SCHEMA, { propKey: "titles.sub" }).kind).toBeNull();
    expect(resolveBindableProp(SCHEMA, { propKey: "labels", index: 2 }).kind).toBe("string");
    expect(resolveBindableProp(SCHEMA, { propKey: "labels" }).kind).toBeNull();
    expect(resolveBindableProp(SCHEMA, { propKey: "ghost" })).toEqual({ def: undefined, kind: null, path: [] });
  });
  it("knows which types are lists", () => {
    expect(isListPropType(SCHEMA.labels)).toBe(true);
    expect(isListPropType(SCHEMA.values)).toBe(true);
    expect(isListPropType(SCHEMA.title)).toBe(false);
    expect(isListPropType(undefined)).toBe(false);
  });
});

describe("structured props — path + kind", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindingPath, isStructuredPropType } = require("./propBindings") as typeof import("./propBindings");
  const rows = def("json" as never);
  const list = def("list" as never);
  const arr = { type: "array", required: true } as unknown as MosaicTemplatePropDefinition;

  it("binds a leaf of a json/list/array prop only with a valid path AND an explicit kind", () => {
    expect(classifyBindableProp(rows, { path: [2, "title"], kind: "string" })).toBe("string");
    expect(classifyBindableProp(list, { index: 0, path: ["value"], kind: "number" })).toBe("number");
    expect(classifyBindableProp(arr, { path: [0, "reviewers", 1], kind: "string" })).toBe("string");
    expect(classifyBindableProp(rows, { path: [2, "title"] })).toBeNull(); // no kind
    expect(classifyBindableProp(rows, { kind: "string" })).toBeNull(); // no path
    expect(classifyBindableProp(rows)).toBeNull();
    expect(classifyBindableProp(rows, { path: [-1, "title"], kind: "string" })).toBeNull();
    expect(classifyBindableProp(rows, { path: [0, ""], kind: "string" })).toBeNull();
    expect(classifyBindableProp(rows, { path: [0, "x"], kind: "boolean" as never })).toBeNull();
  });

  it("basic lists still need exactly one numeric segment; scalars ignore paths", () => {
    expect(classifyBindableProp(SCHEMA.labels, { index: 1 })).toBe("string");
    expect(classifyBindableProp(SCHEMA.labels, { path: [1] })).toBe("string");
    expect(classifyBindableProp(SCHEMA.labels, { index: 1, path: ["x"] })).toBeNull();
    expect(classifyBindableProp(SCHEMA.count, { path: [3, "x"], kind: "string" })).toBe("number");
  });

  it("bindingPath folds index into the path; resolveBindableProp returns it", () => {
    expect(bindingPath({})).toEqual([]);
    expect(bindingPath({ index: 2 })).toEqual([2]);
    expect(bindingPath({ index: 2, path: ["title"] })).toEqual([2, "title"]);
    expect(bindingPath({ path: [0, "reviewers", 1] })).toEqual([0, "reviewers", 1]);
    const r = resolveBindableProp({ ...SCHEMA, rows }, { propKey: "rows", index: 2, path: ["title"], kind: "string" });
    expect(r.kind).toBe("string");
    expect(r.path).toEqual([2, "title"]);
    expect(isStructuredPropType(rows)).toBe(true);
    expect(isStructuredPropType(SCHEMA.labels)).toBe(false);
  });
});

describe("bindingRange — a string leaf may edit one character span", () => {
  it("returns the validated range (+ focus inside it) for string leaves", () => {
    expect(bindingRange({ range: { start: 10, end: 34 }, focus: { start: 16, end: 22 } }, "string")).toEqual({
      range: { start: 10, end: 34 },
      focus: { start: 16, end: 22 },
    });
    expect(bindingRange({ range: { start: 0, end: 0 } }, "string")).toEqual({ range: { start: 0, end: 0 } });
  });

  it("drops a focus that leaves the range, keeps the range", () => {
    expect(bindingRange({ range: { start: 10, end: 34 }, focus: { start: 8, end: 12 } }, "string")).toEqual({ range: { start: 10, end: 34 } });
    expect(bindingRange({ range: { start: 10, end: 34 }, focus: { start: 30, end: 40 } }, "string")).toEqual({ range: { start: 10, end: 34 } });
  });

  it("ignores ranges on number / color / unbindable leaves and malformed spans", () => {
    expect(bindingRange({ range: { start: 0, end: 4 } }, "number")).toBeUndefined();
    expect(bindingRange({ range: { start: 0, end: 4 } }, "color")).toBeUndefined();
    expect(bindingRange({ range: { start: 0, end: 4 } }, null)).toBeUndefined();
    expect(bindingRange({ range: { start: 4, end: 0 } }, "string")).toBeUndefined();
    expect(bindingRange({ range: { start: -1, end: 4 } }, "string")).toBeUndefined();
    expect(bindingRange({ range: { start: 1.5, end: 4 } }, "string")).toBeUndefined();
    expect(bindingRange({ range: "0-4" }, "string")).toBeUndefined();
    expect(bindingRange({}, "string")).toBeUndefined();
  });

  it("resolveBindableProp carries the span for a string[] element and strips it for number[]", () => {
    const r = resolveBindableProp(SCHEMA as PropSchemaMap, { propKey: "labels", index: 1, range: { start: 3, end: 9 }, focus: { start: 3, end: 5 } });
    expect(r).toMatchObject({ kind: "string", path: [1], range: { start: 3, end: 9 }, focus: { start: 3, end: 5 } });
    const n = resolveBindableProp(SCHEMA as PropSchemaMap, { propKey: "values", index: 1, range: { start: 3, end: 9 } });
    expect(n.kind).toBe("number");
    expect(n.range).toBeUndefined();
  });
});

describe("bindingOnClear — what an EMPTY commit means", () => {
  it("validates the action against the EFFECTIVE leaf path", () => {
    // remove-element needs an element: a leading numeric segment
    expect(bindingOnClear({ onClear: "remove-element" }, "number", [2, "day"])).toBe("remove-element");
    expect(bindingOnClear({ onClear: "remove-element" }, "string", [1])).toBe("remove-element"); // a basic list element
    expect(bindingOnClear({ onClear: "remove-element" }, "string", [])).toBeUndefined(); // a scalar has no element
    expect(bindingOnClear({ onClear: "remove-element" }, "string", ["title"])).toBeUndefined();
    // unset-leaf needs a keyed leaf: a basic prop, or a path ending in a key
    expect(bindingOnClear({ onClear: "unset-leaf" }, "string", [2, "title"])).toBe("unset-leaf");
    expect(bindingOnClear({ onClear: "unset-leaf" }, "color", [])).toBe("unset-leaf");
    expect(bindingOnClear({ onClear: "unset-leaf" }, "string", [1])).toBeUndefined(); // an array element has no key
    expect(bindingOnClear({ onClear: "unset-leaf" }, "string", [0, "reviewers", 1])).toBeUndefined();
    // unbindable, unknown or absent → nothing
    expect(bindingOnClear({ onClear: "remove-element" }, null, [0])).toBeUndefined();
    expect(bindingOnClear({ onClear: "delete" }, "string", [0])).toBeUndefined();
    expect(bindingOnClear({}, "string", [0])).toBeUndefined();
  });

  it("resolveBindableProp carries the validated action and omits it otherwise", () => {
    const rows = { type: "json", required: false } as MosaicTemplatePropDefinition;
    const schema = { ...SCHEMA, rows } as PropSchemaMap;
    const r = resolveBindableProp(schema, { propKey: "rows", path: [2, "day"], kind: "number", onClear: "remove-element" });
    expect(r).toMatchObject({ kind: "number", path: [2, "day"], onClear: "remove-element" });
    expect(resolveBindableProp(schema, { propKey: "rows", index: 2, path: ["title"], kind: "string", onClear: "unset-leaf" }).onClear).toBe("unset-leaf");
    expect(resolveBindableProp(schema, { propKey: "labels", index: 1, onClear: "remove-element" }).onClear).toBe("remove-element");
    expect(resolveBindableProp(schema, { propKey: "labels", index: 1, onClear: "unset-leaf" }).onClear).toBeUndefined();
    expect(resolveBindableProp(schema, { propKey: "titles.title", onClear: "unset-leaf" }).onClear).toBe("unset-leaf");
    // a scalar ignores its stray index — so there is no element to remove
    expect(resolveBindableProp(schema, { propKey: "titles.title", index: 3, onClear: "remove-element" }).onClear).toBeUndefined();
    expect("onClear" in resolveBindableProp(schema, { propKey: "titles.title" })).toBe(false);
    // not bindable at all → nothing
    expect(resolveBindableProp(schema, { propKey: "preset", onClear: "unset-leaf" }).onClear).toBeUndefined();
  });
});

describe("bindingSeedDraft — the prefill for an EMPTY leaf", () => {
  it("keeps a non-blank string; a number leaf needs a finite number", () => {
    expect(bindingSeedDraft({ seedDraft: "17" }, "number")).toBe("17");
    expect(bindingSeedDraft({ seedDraft: " 17 " }, "number")).toBe(" 17 "); // the field trims on commit
    expect(bindingSeedDraft({ seedDraft: "Slot 3" }, "string")).toBe("Slot 3");
    expect(bindingSeedDraft({ seedDraft: "#ff8800" }, "color")).toBe("#ff8800");
    expect(bindingSeedDraft({ seedDraft: "Tue" }, "number")).toBeUndefined();
    expect(bindingSeedDraft({ seedDraft: "Infinity" }, "number")).toBeUndefined();
    expect(bindingSeedDraft({ seedDraft: "" }, "string")).toBeUndefined();
    expect(bindingSeedDraft({ seedDraft: "   " }, "string")).toBeUndefined();
    expect(bindingSeedDraft({ seedDraft: 17 }, "number")).toBeUndefined(); // wire shape is a string
    expect(bindingSeedDraft({ seedDraft: "17" }, null)).toBeUndefined();
    expect(bindingSeedDraft({}, "number")).toBeUndefined();
  });

  it("resolveBindableProp carries the validated seed and omits it otherwise", () => {
    const rows = { type: "json", required: false } as MosaicTemplatePropDefinition;
    const schema = { ...SCHEMA, rows } as PropSchemaMap;
    const r = resolveBindableProp(schema, { propKey: "rows", path: [6, "day"], kind: "number", onClear: "remove-element", seedDraft: "17" });
    expect(r).toMatchObject({ kind: "number", path: [6, "day"], onClear: "remove-element", seedDraft: "17" });
    expect(resolveBindableProp(schema, { propKey: "rows", path: [6, "day"], kind: "number", seedDraft: "Tue" }).seedDraft).toBeUndefined();
    expect(resolveBindableProp(schema, { propKey: "labels", index: 1, seedDraft: "B" }).seedDraft).toBe("B");
    expect(resolveBindableProp(schema, { propKey: "values", index: 1, seedDraft: "x" }).seedDraft).toBeUndefined();
    expect("seedDraft" in resolveBindableProp(schema, { propKey: "titles.title" })).toBe(false);
    expect(resolveBindableProp(schema, { propKey: "preset", seedDraft: "a" }).seedDraft).toBeUndefined();
  });
});

describe("rect bindings (a one-region regions picker edited in place)", () => {
  const regionsOne: MosaicTemplatePropDefinition = {
    type: "json",
    required: false,
    description: "where the facecam goes",
    meta: { control: { picker: "regions", regions: { max: 1, shapes: ["rect"] } } },
  } as MosaicTemplatePropDefinition;
  const regionsMany: MosaicTemplatePropDefinition = {
    type: "json",
    required: false,
    description: "areas to blur",
    meta: { control: { picker: "regions", regions: { max: 64 } } },
  } as MosaicTemplatePropDefinition;
  const plainJson: MosaicTemplatePropDefinition = { type: "json", required: false, description: "rows" } as MosaicTemplatePropDefinition;

  it("classifies kind rect on a one-region regions picker with no path", () => {
    expect(classifyBindableProp(regionsOne, { kind: "rect" })).toBe("rect");
    expect(isRectPickerProp(regionsOne)).toBe(true);
  });
  it("refuses rect WHOLE on a multi-region picker, a plain json prop, or with a path", () => {
    expect(classifyBindableProp(regionsMany, { kind: "rect" })).toBeNull();
    expect(classifyBindableProp(plainJson, { kind: "rect" })).toBeNull();
    expect(classifyBindableProp(regionsOne, { kind: "rect", path: [0] })).toBeNull();
    expect(isRectPickerProp(plainJson)).toBe(false);
  });
  it("classifies kind rect on ONE element of a rect-list picker (a bare index; never a path)", () => {
    const uncapped = { ...regionsMany, meta: { control: { picker: "regions", shapes: ["rect"] } } } as MosaicTemplatePropDefinition;
    expect(classifyBindableProp(uncapped, { kind: "rect", index: 0 })).toBe("rect");
    expect(classifyBindableProp(uncapped, { kind: "rect", index: 7 })).toBe("rect");
    expect(classifyBindableProp(regionsMany, { kind: "rect", index: 63 })).toBe("rect");
    expect(classifyBindableProp(regionsMany, { kind: "rect", index: 64 })).toBeNull(); // past the cap
    expect(classifyBindableProp(regionsOne, { kind: "rect", index: 0 })).toBeNull(); // one region binds whole
    expect(classifyBindableProp(uncapped, { kind: "rect", path: [0] })).toBeNull(); // an index, not a path
    expect(classifyBindableProp(uncapped, { kind: "rect", index: 0, path: ["x"] })).toBeNull();
    expect(classifyBindableProp(uncapped, { kind: "rect", index: -1 })).toBeNull();
    expect(classifyBindableProp(uncapped, { kind: "rect", index: 1.5 })).toBeNull();
    expect(classifyBindableProp(plainJson, { kind: "rect", index: 0 })).toBeNull();
    expect(isRectListPickerProp(uncapped, 3)).toBe(true);
    expect(isRectListPickerProp(regionsOne, 0)).toBe(false);
    expect(isRectListPickerProp(plainJson, 0)).toBe(false);
  });
  it("an element rect binding resolves with its index as the path and no seed", () => {
    const bubbles = { ...regionsMany, meta: { control: { picker: "regions" } } } as MosaicTemplatePropDefinition;
    const r = resolveBindableProp({ bubbles }, { propKey: "bubbles", kind: "rect", index: 2, seedDraft: "x" });
    expect(r.kind).toBe("rect");
    expect(r.path).toEqual([2]);
    expect(r.seedDraft).toBeUndefined();
  });
  it("resolves through the schema with no seed draft", () => {
    const r = resolveBindableProp({ facecamRegion: regionsOne }, { propKey: "facecamRegion", kind: "rect", seedDraft: "x" });
    expect(r.kind).toBe("rect");
    expect(r.path).toEqual([]);
    expect(r.seedDraft).toBeUndefined();
  });
});

describe("media bindings (a rect that is a drop target / picker handle)", () => {
  const facecam = def("media", { control: { picker: "file", accept: ["video"] } as any });
  const teasers = def("media[]", { control: { picker: "file", accept: ["image", "video"] } as any });
  const hiddenMedia = def("media", { ui: { hidden: true } });
  const rows = def("json");

  it("a media prop binds whole; an index / path on it is ignored", () => {
    expect(classifyBindableProp(facecam)).toBe("media");
    expect(classifyBindableProp(facecam, 3)).toBe("media");
    expect(classifyBindableProp(facecam, { path: ["x"] })).toBe("media");
    expect(isMediaPropType(facecam)).toBe(true);
    expect(isMediaPropType(teasers)).toBe(true);
    expect(isMediaPropType(rows)).toBe(false);
  });
  it("a media[] element binds only with a non-negative integer index (the list never does)", () => {
    expect(classifyBindableProp(teasers)).toBeNull();
    expect(classifyBindableProp(teasers, 0)).toBe("media");
    expect(classifyBindableProp(teasers, { path: [4] })).toBe("media");
    expect(classifyBindableProp(teasers, -1)).toBeNull();
    expect(classifyBindableProp(teasers, 1.5)).toBeNull();
    expect(classifyBindableProp(teasers, { path: [0, "x"] })).toBeNull();
    expect(isListPropType(teasers)).toBe(true);
  });
  it("a structured leaf binds as media only with a path AND kind media; kind media elsewhere is refused", () => {
    expect(classifyBindableProp(rows, { path: [2, "image"], kind: "media" })).toBe("media");
    expect(classifyBindableProp(rows, { kind: "media" })).toBeNull();
    expect(classifyBindableProp(SCHEMA.title, { kind: "media" })).toBe("string"); // the schema type wins on basic props
    expect(classifyBindableProp(SCHEMA.labels, { index: 0, kind: "media" })).toBe("string");
    expect(classifyBindableProp(hiddenMedia)).toBeNull();
  });
  it("resolveBindableProp: the effective path, no seed, a validated onClear", () => {
    const schema = { facecam, teasers, rows };
    const scalar = resolveBindableProp(schema, { propKey: "facecam", index: 2, seedDraft: "C:/x.mp4" });
    expect(scalar.kind).toBe("media");
    // The raw folded path rides along (as it does for a string scalar); the
    // consumer strips it for a scalar — the clear action is judged against
    // the EFFECTIVE (empty) leaf path, so a stray index changes nothing.
    expect(scalar.path).toEqual([2]);
    expect(scalar.seedDraft).toBeUndefined();
    expect(resolveBindableProp(schema, { propKey: "facecam", onClear: "unset-leaf" }).onClear).toBe("unset-leaf");
    expect(resolveBindableProp(schema, { propKey: "facecam", index: 2, onClear: "remove-element" }).onClear).toBeUndefined();

    const el = resolveBindableProp(schema, { propKey: "teasers", index: 3, onClear: "remove-element", seedDraft: "x" });
    expect(el.kind).toBe("media");
    expect(el.path).toEqual([3]);
    expect(el.onClear).toBe("remove-element");
    expect(el.seedDraft).toBeUndefined();
    expect(resolveBindableProp(schema, { propKey: "teasers", index: 3, onClear: "unset-leaf" }).onClear).toBeUndefined();

    const leaf = resolveBindableProp(schema, { propKey: "rows", path: [1, "image"], kind: "media", onClear: "unset-leaf" });
    expect(leaf.kind).toBe("media");
    expect(leaf.path).toEqual([1, "image"]);
    expect(leaf.onClear).toBe("unset-leaf");
    expect(resolveBindableProp(schema, { propKey: "teasers" }).kind).toBeNull();
  });
  it("a range on a media leaf is dropped (paths are edited whole)", () => {
    expect(bindingRange({ range: { start: 0, end: 3 } }, "media")).toBeUndefined();
    expect(bindingSeedDraft({ seedDraft: "x" }, "media")).toBeUndefined();
  });
});

describe("companion — a seeded leaf only the media drop fills", () => {
  const days = def("json");
  it("needs a kept seed: true only with a seed the kind accepts", () => {
    expect(bindingCompanion({ companion: true }, "3")).toBe(true);
    expect(bindingCompanion({ companion: true }, undefined)).toBe(false);
    expect(bindingCompanion({ companion: "yes" }, "3")).toBe(false);
    expect(bindingCompanion({}, "3")).toBe(false);
  });
  it("resolveBindableProp carries it for a seeded number leaf and drops it when the seed is dropped", () => {
    const ok = resolveBindableProp({ days }, { propKey: "days", path: [6, "teaser"], kind: "number", seedDraft: "3", companion: true });
    expect(ok.companion).toBe(true);
    expect(ok.seedDraft).toBe("3");
    // a non-numeric seed on a number leaf is dropped → no companion either
    expect(resolveBindableProp({ days }, { propKey: "days", path: [6, "teaser"], kind: "number", seedDraft: "x", companion: true }).companion).toBeUndefined();
    // no seed → no companion
    expect(resolveBindableProp({ days }, { propKey: "days", path: [6, "teaser"], kind: "number", companion: true }).companion).toBeUndefined();
    // a media leaf never keeps a seed, so never a companion
    expect(resolveBindableProp({ t: def("media[]") }, { propKey: "t", index: 0, seedDraft: "x", companion: true }).companion).toBeUndefined();
  });
});
