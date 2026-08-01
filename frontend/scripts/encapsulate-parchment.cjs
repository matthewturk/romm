const fs = require("fs");
const path = require("path");
const { scopeCss } = require("./lib/scoper.cjs");

const inputFile = path.resolve(
  __dirname,
  "../public/assets/parchment/parchment.css",
);
const outputFile = path.resolve(
  __dirname,
  "../src/assets/parchment-scoped.css",
);

const ROOT_SELECTOR = "#parchment-root";

// Ensure output dir exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Custom overrides for the RomM Parchment integration.
const overrides = `
/* Custom overrides for RomM Parchment integration */

/* Apply max width setting to the buffer text area */
${ROOT_SELECTOR} .BufferWindowInner {
  max-width: var(--glkote-content-max-width, none);
  margin: 0 auto;
}

/* Keep the file dialog centered whether it lives in the body or has been
   moved into #parchment-root for fullscreen. */
${ROOT_SELECTOR} dialog,
body dialog {
  margin: auto;
  inset: 0;
  max-height: fit-content;
  max-width: fit-content;
  position: fixed;
}
`;

try {
  const css = fs.readFileSync(inputFile, "utf-8");
  const scoped = scopeCss(css, ROOT_SELECTOR);
  fs.writeFileSync(outputFile, scoped + overrides);
  console.log(`Successfully encapsulated CSS to ${outputFile}`);
} catch (e) {
  console.error("Error scoping CSS:", e);
  process.exit(1);
}
