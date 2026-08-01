const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

const ASSETS_DIR = path.resolve(__dirname, "../public/assets/parchment");
const VERSION = "2026.8.1";
const DATE_STR = "2026-08-01"; // Filename uses dashes
const FILENAME = `parchment-for-inform7-${DATE_STR}.zip`;
const DOWNLOAD_URL = `https://github.com/curiousdannii/parchment/releases/download/${VERSION}/${FILENAME}`;
const VERSION_FILE = path.join(ASSETS_DIR, "version.txt");

// Skip the download when the expected files are already present and the
// installed version matches. This keeps `dev`/`build` fast on repeat runs
// while still re-downloading automatically when the pinned version changes.
if (
  fs.existsSync(path.join(ASSETS_DIR, "parchment.js")) &&
  fs.existsSync(VERSION_FILE) &&
  fs.readFileSync(VERSION_FILE, "utf-8").trim() === VERSION
) {
  console.log(`Parchment ${VERSION} already installed. Skipping download.`);
  process.exit(0);
}

// Create temp dir
const tempDir = path.resolve(__dirname, "../temp_parchment");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const zipPath = path.join(tempDir, FILENAME);

function download(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(
      url,
      { headers: { "User-Agent": "romm-parchment" } },
      (response) => {
        const { statusCode } = response;
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location &&
          redirectsLeft > 0
        ) {
          response.resume();
          resolve(download(response.headers.location, redirectsLeft - 1));
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          reject(
            new Error(`Download failed with status ${statusCode} for ${url}`),
          );
          return;
        }
        const file = fs.createWriteStream(zipPath);
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Download timed out")));
  });
}

async function extract() {
  console.log("Extracting...");
  try {
    // Use unzip command - assumes linux environment
    execSync(`unzip -o "${zipPath}" -d "${tempDir}"`);

    fs.mkdirSync(ASSETS_DIR, { recursive: true });

    // The release zip contains a single top-level folder (e.g. `Parchment/`).
    // Move its contents up so the assets live directly in ASSETS_DIR, keeping
    // the paths referenced by the player (`/assets/parchment/parchment.js`).
    const entries = fs.readdirSync(tempDir).filter((f) => f !== FILENAME);
    const subdir = entries.find((f) =>
      fs.lstatSync(path.join(tempDir, f)).isDirectory(),
    );
    const sourceDir = subdir ? path.join(tempDir, subdir) : tempDir;

    execSync(`cp -r "${sourceDir}/"* "${ASSETS_DIR}/"`);
    fs.writeFileSync(VERSION_FILE, VERSION);
    console.log(`Parchment ${VERSION} installed to ${ASSETS_DIR}`);
  } catch (e) {
    console.error("Extraction failed:", e);
    process.exit(1);
  } finally {
    // Clean up
    execSync(`rm -rf "${tempDir}"`);
  }
}

(async () => {
  console.log(`Downloading Parchment ${VERSION}...`);
  try {
    await download(DOWNLOAD_URL);
    await extract();
  } catch (err) {
    fs.unlink(zipPath, () => {});
    console.error("Download error:", err);
    process.exit(1);
  }
})();
