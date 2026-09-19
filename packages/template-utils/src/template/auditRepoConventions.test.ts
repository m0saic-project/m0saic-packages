import { asRepoId, asTemplateId } from "@m0saic/types";
import { auditRepoFrontDoor } from "./auditRepoConventions";

describe("auditRepoFrontDoor — every repo names the template a newcomer renders first", () => {
  const ids = ["@acme/basics/hello-world/v1", "@acme/charts/bar/v1"];

  test("declared and registered → silent", () => {
    expect(auditRepoFrontDoor({ repoId: asRepoId("@acme"), helloWorld: asTemplateId("@acme/basics/hello-world/v1") }, ids)).toEqual([]);
  });

  test("undeclared → one warning naming the canonical factory call", () => {
    const v = auditRepoFrontDoor({ repoId: asRepoId("@acme") }, ids);
    expect(v).toHaveLength(1);
    expect(v[0].key).toBe("helloWorld");
    expect(v[0].detail).toMatch(/defineHelloWorldTemplate\(\{ id: "@acme\/basics\/hello-world\/v1"/);
  });

  test("declared but not registered → one warning naming the stray id", () => {
    const v = auditRepoFrontDoor({ repoId: asRepoId("@acme"), helloWorld: asTemplateId("@acme/basics/nope/v1") }, ids);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toMatch(/does not register/);
  });

  test("no descriptor at all → nothing to say (a repo without one fails elsewhere)", () => {
    expect(auditRepoFrontDoor(null, ids)).toEqual([]);
    expect(auditRepoFrontDoor(undefined, ids)).toEqual([]);
  });
});
