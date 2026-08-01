import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { scopeCss } = require("../scripts/lib/scoper.cjs");

const ROOT = "#parchment-root";

describe("scopeCss", () => {
  it("prefixes plain selectors with the root selector", () => {
    expect(scopeCss("p { color: red }", ROOT)).toContain(
      "#parchment-root p { color: red }\n",
    );
    expect(scopeCss(".foo { }", ROOT)).toContain("#parchment-root .foo { }\n");
  });

  it("maps :root to the root selector", () => {
    expect(scopeCss(":root { --x: 1 }", ROOT)).toContain(
      "#parchment-root { --x: 1 }\n",
    );
  });

  it("attaches a lone attribute selector directly to the root", () => {
    expect(scopeCss("[data-theme=dark] { --x: 1 }", ROOT)).toContain(
      "#parchment-root[data-theme=dark] { --x: 1 }\n",
    );
  });

  it("prefixes compound selectors on :root without a descendant space", () => {
    expect(scopeCss(":root .a { }", ROOT)).toContain(
      "#parchment-root .a { }\n",
    );
  });

  it("replaces body and html selectors with the root", () => {
    expect(scopeCss("body { margin: 0 }", ROOT)).toContain(
      "#parchment-root { margin: 0 }\n",
    );
    expect(scopeCss("html > div { }", ROOT)).toContain(
      "#parchment-root > div { }\n",
    );
  });

  it("dual-scopes dialog and svelte selectors under body and the root", () => {
    const out = scopeCss("dialog.x.svelte-abc { top: 0 }", ROOT);
    expect(out).toContain(
      "#parchment-root dialog.x.svelte-abc, body dialog.x.svelte-abc { top: 0 }\n",
    );
  });

  it("scopes rules nested inside @media recursively", () => {
    const out = scopeCss(
      "@media (max-width: 767px) { dialog { top: 0 } p { color: red } }",
      ROOT,
    );
    expect(out).toContain(
      "@media (max-width: 767px) {#parchment-root dialog, body dialog { top: 0 }\n#parchment-root p { color: red }\n }\n",
    );
  });

  it("keeps statement at-rules like @font-face verbatim", () => {
    const inCss = '@font-face{font-family:"AsyncGlk Serif";src:local("Times")}';
    expect(scopeCss(inCss, ROOT)).toContain(inCss);
  });

  it("does not split selectors on commas inside :not()", () => {
    const out = scopeCss("p:not(.a, .b) { }", ROOT);
    expect(out).toContain("#parchment-root p:not(.a, .b) { }\n");
  });

  it("preserves comments and string contents", () => {
    const inCss = '/* keep */ .a { content: "p { x }"; }';
    const out = scopeCss(inCss, ROOT);
    expect(out).toContain("/* keep */");
    expect(out).toContain('content: "p { x }"');
  });
  it("scopes each selector in a comma-separated group", () => {
    const out = scopeCss("a, b { }", ROOT);
    expect(out).toContain("#parchment-root a, #parchment-root b { }\n");
  });
});
