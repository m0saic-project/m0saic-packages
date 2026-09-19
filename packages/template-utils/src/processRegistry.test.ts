import {
  processRegistry,
  __resetProcessRegistriesForTests,
} from "./processRegistry";

describe("processRegistry", () => {
  afterEach(() => {
    __resetProcessRegistriesForTests();
  });

  it("returns the same Map instance for the same name", () => {
    const a = processRegistry<string, number>("alpha");
    const b = processRegistry<string, number>("alpha");
    expect(b).toBe(a);
  });

  it("namespaces by name", () => {
    processRegistry<string, number>("alpha").set("k", 1);
    expect(processRegistry<string, number>("beta").has("k")).toBe(false);
  });

  it("keeps entries written through an earlier reference", () => {
    const first = processRegistry<string, number>("alpha");
    first.set("k", 42);
    expect(processRegistry<string, number>("alpha").get("k")).toBe(42);
  });

  // The load-bearing property for the desktop app's template hot reload: the
  // store hangs off globalThis under a Symbol.for key, so a re-instantiated
  // copy of this module (fresh require.cache entry) resolves the SAME Map and
  // references captured before the reload keep working.
  it("anchors the store on globalThis under the shared symbol", () => {
    processRegistry<string, number>("alpha").set("k", 7);

    const store = (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for("m0saic.template-utils.registries.v1")
    ] as Map<string, Map<string, number>>;

    expect(store).toBeInstanceOf(Map);
    expect(store.get("alpha")?.get("k")).toBe(7);
  });

  it("__resetProcessRegistriesForTests clears the store", () => {
    processRegistry<string, number>("alpha").set("k", 1);
    __resetProcessRegistriesForTests();
    expect(processRegistry<string, number>("alpha").size).toBe(0);
  });
});
