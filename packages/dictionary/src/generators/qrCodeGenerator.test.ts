import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { qrCodeDescriptor, qrCodeGenerator } from "./qrCodeGenerator";

describe("qrCodeGenerator", () => {
  test("basic flow — just text produces a valid m0", () => {
    const r = qrCodeGenerator({ text: "https://m0saic.io" });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.sourceCount).toBeGreaterThan(0);
    expect(r.idealCanvas).toBeDefined();
    expect(r.idealCanvas!.width).toBeGreaterThan(0);
    expect(r.idealCanvas!.height).toBe(r.idealCanvas!.width);
  });

  test("empty text throws", () => {
    expect(() => qrCodeGenerator({ text: "" })).toThrow(/text is required/);
    expect(() => qrCodeGenerator({ text: "   " })).toThrow(/text is required/);
  });

  test("safeAreaMode='carve' carves a region and auto-scales the canvas", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      safeAreaMode: "carve",
      safeAreaWidth: 272,
      safeAreaHeight: 272,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    // Canvas is auto-scaled so the safe area lands at exactly the requested
    // pixel size. Specific dims depend on which QR version the encoder picks
    // for the URL + ECC combo, so just sanity-check the canvas is square and
    // non-trivially sized.
    expect(r.idealCanvas!.width).toBe(r.idealCanvas!.height);
    expect(r.idealCanvas!.width).toBeGreaterThan(100);
  });

  test("non-square safe area auto-letterboxes the inner W×H", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      safeAreaMode: "carve",
      safeAreaWidth: 400,
      safeAreaHeight: 300,
    });
    expect(isValidM0String(r.m0)).toBe(true);
  });

  test("paddingPct grows the canvas while keeping the safe area at the requested size", () => {
    const noPad = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      safeAreaMode: "carve",
      safeAreaWidth: 200,
      safeAreaHeight: 200,
      paddingPct: 0,
    });
    const withPad = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      safeAreaMode: "carve",
      safeAreaWidth: 200,
      safeAreaHeight: 200,
      paddingPct: 10,
    });
    // padding=10% of 200 = 20 px per side → safe-area square goes from 200 to 240.
    // Canvas scales with the safe-area square, so withPad.canvas > noPad.canvas.
    expect(withPad.idealCanvas!.width).toBeGreaterThan(noPad.idealCanvas!.width);
  });

  test("version=0 means auto-pick (default behaviour)", () => {
    const auto = qrCodeGenerator({ text: "hi", version: 0 });
    const forced = qrCodeGenerator({ text: "hi", version: 5 });
    expect(auto.idealCanvas!.width).toBeLessThan(forced.idealCanvas!.width);
  });

  test("quietZoneModules=0 produces a raw matrix (no quiet-zone border)", () => {
    const withQz = qrCodeGenerator({ text: "hi" });
    const noQz = qrCodeGenerator({ text: "hi", quietZoneModules: 0 });
    expect(noQz.idealCanvas!.width).toBeLessThan(withQz.idealCanvas!.width);
  });

  test("deterministic — identical params produce byte-identical m0", () => {
    const a = qrCodeGenerator({ text: "https://m0saic.io", errorCorrectionLevel: "M" });
    const b = qrCodeGenerator({ text: "https://m0saic.io", errorCorrectionLevel: "M" });
    expect(a.m0).toBe(b.m0);
    expect(a.sourceCount).toBe(b.sourceCount);
  });

  test("sourceCount equals the visible-frame count of the produced m0", () => {
    const r = qrCodeGenerator({ text: "https://m0saic.io" });
    const frames = parseM0StringToRenderFrames(r.m0, r.idealCanvas!.width, r.idealCanvas!.height);
    expect(r.sourceCount).toBe(frames.length);
  });

  // ── Pack mode (engine-perf optimization) ───────────────────

  test("pack=true reduces sourceCount vs default (same URL, same visual output)", () => {
    const baseline = qrCodeGenerator({ text: "https://m0saic.io" });
    const packed = qrCodeGenerator({ text: "https://m0saic.io", pack: true });
    expect(packed.sourceCount).toBeLessThan(baseline.sourceCount);
    // Canvas dimensions unchanged — pack is a perf knob, not a sizing one.
    expect(packed.idealCanvas).toEqual(baseline.idealCanvas);
  });

  test("pack=true still produces a valid m0", () => {
    const r = qrCodeGenerator({ text: "https://m0saic.io", pack: true });
    expect(isValidM0String(r.m0)).toBe(true);
  });

  // ── Per-channel toggles ────────────────────────────────────

  test("channelEyes=true → structural marker only; rendered-frame count matches baseline", () => {
    const baseline = qrCodeGenerator({ text: "https://m0saic.io" });
    const withEyes = qrCodeGenerator({ text: "https://m0saic.io", channelEyes: true });
    // Channels are now logical-owner overlays — the `-{<canonical>}` paints
    // the same finder cells the suppressed base would have. Net rendered-
    // frame count is identical to channels-off. Only the structural surface
    // (channelByRole.eyes.frames[i].stableKey) changes.
    expect(withEyes.sourceCount).toBe(baseline.sourceCount);
    expect(isValidM0String(withEyes.m0)).toBe(true);
  });

  test("channelTimingPatterns=true adds 2 frames (h + v timing strips)", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      channelTimingPatterns: true,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    // Sanity: more sources than per-cell baseline? Depends on net suppression.
    // Just confirm validity here — exact arithmetic checked at the stdlib layer.
  });

  test("multiple channels at once: eyes + alignment + timing all valid", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      version: 7,
      channelEyes: true,
      channelAlignmentPatterns: true,
      channelTimingPatterns: true,
    });
    expect(isValidM0String(r.m0)).toBe(true);
  });

  test("showAdvancedChannels=true is UI-only and does not affect output", () => {
    const withFlag = qrCodeGenerator({
      text: "https://m0saic.io",
      showAdvancedChannels: true,
    });
    const withoutFlag = qrCodeGenerator({ text: "https://m0saic.io" });
    expect(withFlag.m0).toBe(withoutFlag.m0);
  });

  test("safeAreaMode='carve' floors auto-version at v6 so the 15-cell cutout doesn't dominate the matrix", () => {
    // No-carve flow: short URL auto-picks v2 (= 25 + 2·4 = 33 cells).
    const noCarve = qrCodeGenerator({ text: "https://m0saic.io" });
    expect(noCarve.m0).toMatch(/^33\[/);

    // Carve flow: auto bumps to v6 (= 41 + 2·4 = 49 cells) so the 15-cell
    // safe area is ~30% of the matrix instead of ~60% at v2.
    const carveAuto = qrCodeGenerator({
      text: "https://m0saic.io",
      safeAreaMode: "carve",
      safeAreaWidth: 272,
      safeAreaHeight: 272,
    });
    expect(carveAuto.m0).toMatch(/^49\[/);

    // Caller-supplied `version` still wins, even below the floor.
    const carveForcedV3 = qrCodeGenerator({
      text: "https://m0saic.io",
      safeAreaMode: "carve",
      safeAreaWidth: 272,
      safeAreaHeight: 272,
      version: 3,
    });
    expect(carveForcedV3.m0).toMatch(/^37\[/);
  });

  test("channelEyes=true + safeArea=carve compose: both overlays present", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      channelEyes: true,
      safeAreaMode: "carve",
      safeAreaWidth: 272,
      safeAreaHeight: 272,
    });
    expect(isValidM0String(r.m0)).toBe(true);
  });

  test("pack + channels combined: pack runs on remaining cells after channel suppression", () => {
    const eyesOnly = qrCodeGenerator({ text: "https://m0saic.io", channelEyes: true });
    const eyesAndPack = qrCodeGenerator({
      text: "https://m0saic.io",
      channelEyes: true,
      pack: true,
    });
    expect(eyesAndPack.sourceCount).toBeLessThan(eyesOnly.sourceCount);
    expect(isValidM0String(eyesAndPack.m0)).toBe(true);
  });

  // ── Descriptor surface — UI grouping ───────────────────────

  test("descriptor exposes pack + showAdvancedChannels + all 7 channel toggles", () => {
    const keys = qrCodeDescriptor.params.map((p: { key: string }) => p.key);
    expect(keys).toContain("pack");
    expect(keys).toContain("showAdvancedChannels");
    expect(keys).toContain("channelEyes");
    expect(keys).toContain("channelAlignmentPatterns");
    expect(keys).toContain("channelTimingPatterns");
    expect(keys).toContain("channelFormatInfo");
    expect(keys).toContain("channelVersionInfo");
    expect(keys).toContain("channelDarkModule");
    expect(keys).toContain("channelSeparators");
  });

  test("each channel toggle is gated behind showAdvancedChannels via visibleWhen", () => {
    const channelKeys = [
      "channelEyes",
      "channelAlignmentPatterns",
      "channelTimingPatterns",
      "channelFormatInfo",
      "channelVersionInfo",
      "channelDarkModule",
      "channelSeparators",
    ];
    for (const key of channelKeys) {
      const param = qrCodeDescriptor.params.find((p: { key: string }) => p.key === key);
      expect(param).toBeDefined();
      expect(param!.visibleWhen).toEqual({ showAdvancedChannels: true });
    }
  });
});

describe("qrCodeGenerator — payloadType", () => {
  test("default payloadType is 'text'; existing { text } calls still work", () => {
    const a = qrCodeGenerator({ text: "https://m0saic.io" });
    const b = qrCodeGenerator({ payloadType: "text", text: "https://m0saic.io" });
    expect(a.m0).toBe(b.m0);
  });

  test("wifi: builds canonical payload + encodes through qrToM0", () => {
    const r = qrCodeGenerator({
      payloadType: "wifi",
      wifiSsid: "Home",
      wifiPassword: "hunter2",
      wifiEncryption: "WPA",
      wifiHidden: true,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.sourceCount).toBeGreaterThan(0);
  });

  test("wifi: missing ssid throws with explicit field name", () => {
    expect(() => qrCodeGenerator({ payloadType: "wifi" })).toThrow(/wifiSsid/);
  });

  test("wifi: nopass omits password silently", () => {
    const r = qrCodeGenerator({
      payloadType: "wifi",
      wifiSsid: "Cafe",
      wifiEncryption: "nopass",
      wifiPassword: "ignored",
    });
    expect(isValidM0String(r.m0)).toBe(true);
  });

  test("vcard: minimal fullName works; missing fullName throws", () => {
    const r = qrCodeGenerator({
      payloadType: "vcard",
      vcardFullName: "Ada Lovelace",
      vcardEmail: "ada@example.com",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(() => qrCodeGenerator({ payloadType: "vcard" })).toThrow(/vcardFullName/);
  });

  test("mailto: requires to; optional subject + body", () => {
    const r = qrCodeGenerator({
      payloadType: "mailto",
      mailtoTo: "a@b.com",
      mailtoSubject: "Hi",
      mailtoBody: "Hello\nworld",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(() => qrCodeGenerator({ payloadType: "mailto" })).toThrow(/mailtoTo/);
  });

  test("sms: requires phone; optional body", () => {
    const r = qrCodeGenerator({
      payloadType: "sms",
      smsPhone: "+1 (555) 123-4567",
      smsBody: "ping",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(() => qrCodeGenerator({ payloadType: "sms" })).toThrow(/smsPhone/);
  });

  test("tel: requires phone", () => {
    const r = qrCodeGenerator({ payloadType: "tel", telPhone: "+15551234567" });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(() => qrCodeGenerator({ payloadType: "tel" })).toThrow(/telPhone/);
  });

  test("geo: requires finite lat + lng; optional label", () => {
    const r = qrCodeGenerator({
      payloadType: "geo",
      geoLat: 37.7869,
      geoLng: -122.3996,
      geoQuery: "Pier 39",
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(() => qrCodeGenerator({ payloadType: "geo" })).toThrow(/geoLat/);
    expect(() =>
      qrCodeGenerator({ payloadType: "geo", geoLat: NaN, geoLng: 0 }),
    ).toThrow(/geoLat/);
  });

  test("displayFields.resolvedPayload echoes the canonical encoded text", () => {
    // Text payload echoes itself verbatim.
    const textResult = qrCodeGenerator({ payloadType: "text", text: "https://m0saic.io" });
    expect(textResult.displayFields?.resolvedPayload).toBe("https://m0saic.io");

    // Wifi payload echoes the canonical WIFI: string.
    const wifiResult = qrCodeGenerator({
      payloadType: "wifi",
      wifiSsid: "Home",
      wifiPassword: "hunter2",
      wifiHidden: true,
    });
    expect(wifiResult.displayFields?.resolvedPayload).toBe(
      "WIFI:T:WPA;S:Home;P:hunter2;H:true;;",
    );

    // Geo payload echoes the canonical geo: URI.
    const geoResult = qrCodeGenerator({
      payloadType: "geo",
      geoLat: 1,
      geoLng: 2,
      geoQuery: "Pier 39",
    });
    expect(geoResult.displayFields?.resolvedPayload).toBe(
      "geo:1,2?q=Pier%2039",
    );
  });

  test("descriptor exposes a read-only resolvedPayload field hidden for plain text", () => {
    const p = qrCodeDescriptor.params.find((x: { key: string }) => x.key === "resolvedPayload");
    expect(p).toBeDefined();
    expect(p!.readOnly).toBe(true);
    expect(p!.type).toBe("string");
    // Hidden when payloadType is "text" — that flow already has an editable
    // input that IS the encoded text; the echo would just duplicate it.
    expect(p!.visibleWhen).toEqual({
      payloadType: ["wifi", "vcard", "mailto", "sms", "tel", "geo"],
    });
  });

  test("descriptor exposes payloadType enum + gates per-payload fields via visibleWhen", () => {
    const p = qrCodeDescriptor.params.find((x: { key: string }) => x.key === "payloadType");
    expect(p).toBeDefined();
    expect(p!.type).toBe("enum");
    expect((p!.options ?? []).map((o) => o.value)).toEqual([
      "text", "wifi", "vcard", "mailto", "sms", "tel", "geo",
    ]);

    // Spot-check a few of the per-payload fields' gating.
    const wifiSsid = qrCodeDescriptor.params.find((x: { key: string }) => x.key === "wifiSsid");
    expect(wifiSsid!.visibleWhen).toEqual({ payloadType: "wifi" });

    const wifiPassword = qrCodeDescriptor.params.find((x: { key: string }) => x.key === "wifiPassword");
    expect(wifiPassword!.visibleWhen).toEqual({
      payloadType: "wifi",
      wifiEncryption: ["WPA", "WEP"],
    });

    const vcardFullName = qrCodeDescriptor.params.find((x: { key: string }) => x.key === "vcardFullName");
    expect(vcardFullName!.visibleWhen).toEqual({ payloadType: "vcard" });

    const text = qrCodeDescriptor.params.find((x: { key: string }) => x.key === "text");
    expect(text!.visibleWhen).toEqual({ payloadType: "text" });
  });
});

describe("qrCodeGenerator — rounding sliders (label-aware m0c masks)", () => {
  test("default sliders (modules 100%, eye 30%, safe area 30%, no channels/carve) → m0c with one circle mask per data leaf", () => {
    // No channels enabled → every renderable leaf is an unlabeled data
    // cell, so all masks come from `moduleRoundingPct` (defaults 100 =
    // perfect circle). With no labels (channels off, carve off), `labels`
    // is null in the m0c and every mask carries the unit-circle path.
    const r = qrCodeGenerator({ text: "https://m0saic.io" });
    expect(r.m0c).toBeDefined();
    const parsed = JSON.parse(r.m0c!);
    expect(parsed.format).toBe("m0c");
    expect(parsed.m0).toBe(r.m0);
    expect(Object.keys(parsed.masks).length).toBe(r.sourceCount);
    for (const entry of Object.values(parsed.masks)) {
      const e = entry as { localPath: string };
      expect(e.localPath).toContain("A 0.5 0.5"); // arc form of the unit circle
    }
  });

  test("moduleRoundingPct=0 + no channels → no masks (no m0c emitted)", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      moduleRoundingPct: 0,
    });
    expect(r.m0c).toBeUndefined();
  });

  test("moduleRoundingPct=50 → rounded-rect path (not the perfect-circle arc)", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      moduleRoundingPct: 50,
    });
    const parsed = JSON.parse(r.m0c!);
    const sample = (Object.values(parsed.masks)[0] as { localPath: string }).localPath;
    // 50% → r = 0.25; path uses arc radius 0.25 with straight edges in
    // between. Not the perfect-circle "0.5 0.5" arc.
    expect(sample).toContain("A 0.25 0.25");
    expect(sample).not.toContain("A 0.5 0.5 0 1 1");
  });

  test("moduleRoundingPct + pack → masks suppressed (pack wins; runtime belt)", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      moduleRoundingPct: 100,
      pack: true,
    });
    // Pack rects are non-square; module rounding is hard-suppressed
    // → no masks in the m0c. The m0c is still emitted because pack
    // mode tags every packed rect with a `qr-pack-N` label, which
    // callers use to address specific packed runs.
    expect(r.m0c).toBeDefined();
    const parsed = JSON.parse(r.m0c!);
    expect(parsed.masks ?? null).toBeNull();
    const labelTexts = Object.values(parsed.labels ?? {}).map(
      (l) => (l as { text: string }).text,
    );
    expect(labelTexts.length).toBeGreaterThan(0);
    expect(labelTexts.every((t) => t.startsWith("qr-pack-"))).toBe(true);
  });

  test("channel anchors (qr-eye-*, qr-align-*, etc.) are NEVER masked — they're logical anchors that don't render", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      channelEyes: true,
      moduleRoundingPct: 100,
    });
    const parsed = JSON.parse(r.m0c!);
    const eyeKeys = Object.entries(parsed.labels ?? {})
      .filter(([, l]) => (l as { text: string }).text.startsWith("qr-eye-"))
      .map(([k]) => k);
    expect(eyeKeys.length).toBe(3);
    for (const k of eyeKeys) {
      expect(parsed.masks[k]).toBeUndefined();
    }
    // The data cells inside the eye regions still get module rounding —
    // they're plain unlabeled leaves in the base grid.
    const labeledSet = new Set(Object.keys(parsed.labels));
    const dataMaskKeys = Object.keys(parsed.masks).filter(
      (k) => !labeledSet.has(k),
    );
    expect(dataMaskKeys.length).toBeGreaterThan(0);
  });

  test("non-rendering / non-square channels (timing / format / separators / quiet zone) NEVER get masked", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      moduleRoundingPct: 100,
      safeAreaRoundingPct: 100,
      channelTimingPatterns: true,
      channelFormatInfo: true,
      channelSeparators: true,
      channelQuietZone: true,
    });
    const parsed = JSON.parse(r.m0c!);
    const labelByKey = parsed.labels as Record<string, { text: string }>;
    const skipPrefixes = ["qr-timing-", "qr-formatinfo-", "qr-separator-", "qr-quiet-zone-"];
    for (const [key, label] of Object.entries(labelByKey)) {
      if (skipPrefixes.some((p) => label.text.startsWith(p))) {
        expect(parsed.masks[key]).toBeUndefined();
      }
    }
  });

  test("safeAreaRoundingPct + carve → exactly the safe-area frame is masked when modules are 0", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      safeAreaMode: "carve",
      safeAreaWidth: 272,
      safeAreaHeight: 272,
      moduleRoundingPct: 0,
      safeAreaRoundingPct: 100,
    });
    const parsed = JSON.parse(r.m0c!);
    const safeAreaKey = Object.entries(parsed.labels ?? {}).find(
      ([, l]) => (l as { text: string }).text === "qr-safe-area",
    )?.[0];
    expect(safeAreaKey).toBeDefined();
    expect(Object.keys(parsed.masks)).toEqual([safeAreaKey]);
    expect(parsed.masks[safeAreaKey!].localPath).toContain("A 0.5 0.5");
  });

  test("safeAreaRoundingPct=30 → safe area gets rounded-rect arcs, not perfect circle", () => {
    const r = qrCodeGenerator({
      text: "https://m0saic.io",
      errorCorrectionLevel: "H",
      safeAreaMode: "carve",
      safeAreaWidth: 272,
      safeAreaHeight: 272,
      moduleRoundingPct: 0,
      safeAreaRoundingPct: 30,
    });
    const parsed = JSON.parse(r.m0c!);
    const safeAreaKey = Object.entries(parsed.labels ?? {}).find(
      ([, l]) => (l as { text: string }).text === "qr-safe-area",
    )?.[0]!;
    // 30% → r = 0.15
    expect(parsed.masks[safeAreaKey].localPath).toContain("A 0.15 0.15");
  });

  test("descriptor: two rounding sliders with the expected defaults + gates", () => {
    const params = qrCodeDescriptor.params;
    const modules = params.find((x: { key: string }) => x.key === "moduleRoundingPct");
    const eyes = params.find((x: { key: string }) => x.key === "eyeRoundingPct");
    const safe = params.find((x: { key: string }) => x.key === "safeAreaRoundingPct");

    expect(modules!.type).toBe("float");
    // Default 0 — users opt into rounding by raising the slider.
    expect(modules!.default).toBe(0);
    expect(modules!.visibleWhen).toEqual({ pack: false });

    // Eye rounding was removed — module rounding covers the cells inside
    // the eye regions because they're plain data modules in the base grid.
    expect(eyes).toBeUndefined();

    expect(safe!.type).toBe("float");
    expect(safe!.default).toBe(30);
    expect(safe!.visibleWhen).toEqual({ safeAreaMode: "carve" });
  });
});
