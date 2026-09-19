import {
  SCREENCAP_COVER_LOGO_URI,
  SCREENCAP_COVER_PREVIEW_URL,
} from "./screencap-grid-cover-assets";

describe("hoisted screencap-grid cover assets", () => {
  it("the brand M is an inline svg data-uri", () => {
    expect(SCREENCAP_COVER_LOGO_URI.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(
      SCREENCAP_COVER_LOGO_URI.slice("data:image/svg+xml;base64,".length),
      "base64",
    ).toString("utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("#EF7525");
  });

  it("the preview url is the screencap_grid v2 template asset", () => {
    expect(SCREENCAP_COVER_PREVIEW_URL).toMatch(
      /^\/template-assets\/assets\/templates\/@m0saic__media__screencap_grid__v2\/preview\.png/,
    );
  });
});
