import * as path from "path";
import { getCommunityMRoot, getM0saicRoot } from "./m0saicRoot";

describe("getCommunityMRoot", () => {
  it("lives under the m0saic root and honours M0SAIC_ROOT", () => {
    const prev = process.env["M0SAIC_ROOT"];
    process.env["M0SAIC_ROOT"] = "/tmp/m0saic-test-root";
    try {
      expect(getCommunityMRoot()).toBe(path.join(getM0saicRoot(), "community-m"));
      expect(getCommunityMRoot()).toBe(path.resolve("/tmp/m0saic-test-root", "community-m"));
    } finally {
      if (prev === undefined) delete process.env["M0SAIC_ROOT"]; else process.env["M0SAIC_ROOT"] = prev;
    }
  });
});
