import {
  asMosaicHostConnectionId,
  type MosaicHostConnectionRegistration,
} from "@m0saic/types";
import {
  registerHostConnection,
  getHostConnection,
  requireHostConnection,
  listRegisteredHostConnectionIds,
  listRegisteredHostConnections,
} from "./hostConnectionRegistry";
import { __clearHostConnectionRegistryForTests } from "./hostConnectionRegistry";

function makeReg(
  publisher: string,
  profile: string,
): MosaicHostConnectionRegistration {
  return {
    schema: {
      id: asMosaicHostConnectionId(`${publisher}@${profile}`),
      version: 1,
      label: `${publisher} (${profile})`,
      publisher,
      fields: [{ kind: "url", key: "url", label: "URL", required: true }],
    },
    probe: {
      async probe(values) {
        return typeof values.url === "string"
          ? { ok: true, reachable: true }
          : { ok: false, code: "BAD_URL", message: "missing url" };
      },
    },
  };
}

describe("hostConnectionRegistry", () => {
  beforeEach(() => __clearHostConnectionRegistryForTests());

  it("registers + retrieves by id", () => {
    const r = makeReg("github-dev", "default");
    registerHostConnection(r);
    expect(getHostConnection("github-dev@default")).toBe(r);
  });

  it("requireHostConnection throws on missing", () => {
    expect(() => requireHostConnection("never@registered")).toThrow(
      /not registered/,
    );
  });

  it("listRegisteredHostConnectionIds returns sorted ids", () => {
    registerHostConnection(makeReg("plex-dev", "default"));
    registerHostConnection(makeReg("github-dev", "default"));
    registerHostConnection(makeReg("ahead-dev", "work"));
    expect(listRegisteredHostConnectionIds()).toEqual([
      "ahead-dev@work",
      "github-dev@default",
      "plex-dev@default",
    ]);
  });

  it("listRegisteredHostConnections matches id order", () => {
    registerHostConnection(makeReg("plex-dev", "default"));
    registerHostConnection(makeReg("github-dev", "default"));
    const regs = listRegisteredHostConnections();
    expect(regs.map((r) => r.schema.id as unknown as string)).toEqual([
      "github-dev@default",
      "plex-dev@default",
    ]);
  });

  it("re-registering an id replaces the previous entry and warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const a = makeReg("github-dev", "default");
    const b = makeReg("github-dev", "default");
    registerHostConnection(a);
    registerHostConnection(b);
    expect(getHostConnection("github-dev@default")).toBe(b);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Re-registering/),
    );
    warn.mockRestore();
  });

  it("rejects id with mismatched publisher half", () => {
    const r: MosaicHostConnectionRegistration = {
      ...makeReg("github-dev", "default"),
      schema: {
        ...makeReg("github-dev", "default").schema,
        publisher: "wrong-publisher",
      },
    };
    expect(() => registerHostConnection(r)).toThrow(/must match.*publisher/);
  });

  it("rejects malformed ids (no @, empty halves)", () => {
    // Forge an id without going through the brand validator
    const bad: MosaicHostConnectionRegistration = {
      ...makeReg("github-dev", "default"),
      schema: {
        ...makeReg("github-dev", "default").schema,
        id: "no-at-sign" as unknown as ReturnType<
          typeof asMosaicHostConnectionId
        >,
      },
    };
    expect(() => registerHostConnection(bad)).toThrow(
      /'<publisher>@<profile>'/,
    );
  });

  it("supports multiple profiles for the same publisher", () => {
    registerHostConnection(makeReg("github-dev", "default"));
    registerHostConnection(makeReg("github-dev", "home"));
    expect(listRegisteredHostConnectionIds()).toEqual([
      "github-dev@default",
      "github-dev@home",
    ]);
  });
});
