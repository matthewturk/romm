const fs = require("fs");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

const ASSETS_DIR = path.resolve(__dirname, "../public/assets/parchment");
const TAG = "2025.1.14";
const DATE_STR = "2025-01-14"; // Filename uses dashes
const FILENAME = `parchment-for-inform7-${DATE_STR}.zip`;
const DOWNLOAD_URL = `https://github.com/curiousdannii/parchment/releases/download/${TAG}/${FILENAME}`;

if (fs.existsSync(path.join(ASSETS_DIR, "parchment.js"))) {
  console.log("Parchment already exists. Skipping download.");
  process.exit(0);
}

// Create temp dir
const tempDir = path.resolve(__dirname, "../temp_parchment");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const zipPath = path.join(tempDir, FILENAME);

console.log(`Downloading Parchment ${TAG}...`);
const file = fs.createWriteStream(zipPath);

https
  .get(DOWNLOAD_URL, (response) => {
    if (response.statusCode === 302 || response.statusCode === 301) {
      // Follow redirect
      https
        .get(response.headers.location, (res) => {
          res.pipe(file);
          file.on("finish", () => {
            file.close(extract);
          });
        })
        .on("error", (err) => {
          console.error("Download error:", err);
          process.exit(1);
        });
      return;
    }

    response.pipe(file);
    file.on("finish", () => {
      file.close(extract);
    });
  })
  .on("error", (err) => {
    fs.unlink(zipPath, () => {});
    console.error("Download error:", err);
    process.exit(1);
  });

function extract() {
  console.log("Extracting...");
  try {
    // Use unzip command - assumes linux environment
    execSync(`unzip -o "${zipPath}" -d "${tempDir}"`);

    // The zip likely contains a folder or just files.
    // Based on typical behavior, let's list the temp dir
    const extracted = fs.readdirSync(tempDir).filter((f) => f !== FILENAME);

    // If it's a single folder, move its contents. If files, move them.
    // parchment-for-inform7 zips usually contain the files directly or in a folder.
    // Let's assume files are in `tempDir` or `tempDir/parchment-for-inform7-date`.

    // We move everything to ASSETS_DIR
    if (!fs.existsSync(ASSETS_DIR)) {
      fs.mkdirSync(ASSETS_DIR, { recursive: true });
    }

    // Check if there's a subfolder
    const subfolder = extracted.find(
      (f) =>
        fs.lstatSync(path.join(tempDir, f)).isDirectory() &&
        f.includes("parchment"),
    );
    const sourceDir = subfolder ? path.join(tempDir, subfolder) : tempDir;

    // Copy files
    execSync(`cp -r "${sourceDir}/"* "${ASSETS_DIR}/"`);
    console.log(`Parchment installed to ${ASSETS_DIR}`);

    // Clean up
    execSync(`rm -rf "${tempDir}"`);
  } catch (e) {
    console.error("Extraction failed:", e);
    process.exit(1);
  }
}
