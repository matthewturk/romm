const fs = require("fs");
const path = require("path");

const inputFile = path.resolve(
  __dirname,
  "../public/assets/parchment/parchment.css",
);
const outputFile = path.resolve(
  __dirname,
  "../src/assets/parchment-scoped.css",
);

// Ensure output dir exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function scopeCss(css, rootSelector) {
  let output = "";
  let buffer = "";
  let index = 0;
  const len = css.length;

  while (index < len) {
    const char = css[index];

    // Handle comments roughly
    if (char === "/" && css[index + 1] === "*") {
      const closeIndex = css.indexOf("*/", index + 2);
      if (closeIndex !== -1) {
        // Keep comments in buffer so they appear before selector?
        // Or append to output if buffer empty?
        // Let's just treat them as part of buffer.
        buffer += css.substring(index, closeIndex + 2);
        index = closeIndex + 2;
        continue;
      }
    }

    if (char === "{") {
      const selectorBlock = buffer.trim();
      buffer = ""; // reset buffer

      // Capture the block content
      let braceDepth = 1;
      let searchIndex = index + 1;
      while (searchIndex < len && braceDepth > 0) {
        if (css[searchIndex] === "{") braceDepth++;
        else if (css[searchIndex] === "}") braceDepth--;
        searchIndex++;
      }

      const endOfBlock = searchIndex; // points after '}'
      const closingBraceIndex = endOfBlock - 1;

      // Content strictly between { and }
      const innerContent = css.substring(index + 1, closingBraceIndex);

      const cleanSelector = selectorBlock
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();

      if (
        cleanSelector.startsWith("@media") ||
        cleanSelector.startsWith("@supports") ||
        cleanSelector.startsWith("@document")
      ) {
        output += selectorBlock + " {";
        output += scopeCss(innerContent, rootSelector);
        output += "}";
        // Add extra newline for readability
        output += "\n";
      } else if (cleanSelector.startsWith("@")) {
        // @font-face, @keyframes, @import, @charset
        // Keep as is?
        // Some @ rules like @page take a block.
        // We copy content as is without scoping inside.
        output += selectorBlock + " {" + innerContent + "}\n";
      } else {
        // Standard CSS Rule
        // Prefix the selector(s)
        const prefixed = selectorBlock
          .split(",")
          .map((sel) => {
            const trimmed = sel.trim();
            if (!trimmed) return "";
            if (trimmed.startsWith("/*")) return trimmed; // comment only line?

            let replaced = trimmed;
            // Replace specific global tag selectors or :root
            replaced = replaced.replace(/:root/g, rootSelector);
            replaced = replaced.replace(/\bbody\b/g, rootSelector);
            replaced = replaced.replace(/\bhtml\b/g, rootSelector);

            if (replaced.includes(rootSelector)) {
              return replaced;
            }
            // Space is important
            return `${rootSelector} ${replaced}`;
          })
          .join(", ");

        output += prefixed + " {" + innerContent + "}\n";
      }

      index = endOfBlock;
    } else {
      buffer += char;
      index++;
    }
  }

  return output + buffer;
}

const css = fs.readFileSync(inputFile, "utf-8");

try {
  const scoped = scopeCss(css, "#parchment-root");
  fs.writeFileSync(outputFile, scoped);
  console.log(`Successfully encapsulated CSS to ${outputFile}`);
} catch (e) {
  console.error("Error scoping CSS:", e);
  process.exit(1);
}
