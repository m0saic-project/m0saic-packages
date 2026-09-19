import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import {
  getTelemetryOutboxDir,
  getTelemetryRendersDir,
  getTelemetryRoot,
  getTelemetrySentDir,
  getTelemetrySettingsPath,
} from "./paths";

describe("telemetry paths", () => {
  const fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const originalEnv = process.env.M0SAIC_ROOT;

  beforeAll(() => {
    process.env.M0SAIC_ROOT = fixture;
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.M0SAIC_ROOT;
    else process.env.M0SAIC_ROOT = originalEnv;
  });

  it("everything lives under <root>/telemetry", () => {
    expect(getTelemetryRoot()).toBe(path.join(fixture, "telemetry"));
    expect(getTelemetrySettingsPath()).toBe(
      path.join(fixture, "telemetry", "settings.json"),
    );
    expect(getTelemetryRendersDir()).toBe(
      path.join(fixture, "telemetry", "renders"),
    );
    expect(getTelemetryOutboxDir()).toBe(
      path.join(fixture, "telemetry", "outbox"),
    );
    expect(getTelemetrySentDir()).toBe(path.join(fixture, "telemetry", "sent"));
  });

  it("does not create anything on call (pure path math)", () => {
    getTelemetryRoot();
    getTelemetrySettingsPath();
    getTelemetryRendersDir();
    expect(fs.existsSync(fixture)).toBe(false);
  });

  it("recomputes when M0SAIC_ROOT changes (lazy per call)", () => {
    const other = `${fixture}-other`;
    process.env.M0SAIC_ROOT = other;
    expect(getTelemetryRoot()).toBe(path.join(other, "telemetry"));
    process.env.M0SAIC_ROOT = fixture;
    expect(getTelemetryRoot()).toBe(path.join(fixture, "telemetry"));
  });
});
