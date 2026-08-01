import type { SaveSchema } from "@/__generated__";
import api from "@/services/api";
import saveApi from "@/services/api/save";
import type { DetailedRom } from "@/stores/roms";

/* ---------------------------------------------------------------------------
 * Parchment (2026.8.1) storage integration
 *
 * Parchment's file dialog is backed by a chain of providers. Save files end
 * up in the browseable localStorage provider, which stores:
 *   - the file data under its full path, Base32768-encoded:
 *       localStorage["/usr/foo/save.glksave"] = base32768(bytes)
 *   - an index of every stored file:
 *       localStorage["dialog_metadata"] = { path: { atime, mtime } }
 * The default working directory (where the in-game save/restore dialog opens)
 * is `/usr/<story-name-without-extension>`.
 *
 * We write saves directly into that storage (rather than through Parchment's
 * internal `Dialog` object, which is not exposed) so they appear in the
 * in-game "Restore" dialog, and we poll the index to upload saves written by
 * the game to RomM (the new build calls the bundled FileSaver directly, so
 * intercepting `window.saveAs` no longer works).
 * ------------------------------------------------------------------------ */

export const DIALOG_METADATA_KEY = "dialog_metadata";
export const DIALOG_STORAGE_VERSION_KEY = "dialog_storage_version";

/**
 * Base32768 alphabet as code-point ranges (mirrors Parchment 2026.8.1).
 * Ranges come in pairs (start, end). The first string yields 32768
 * characters (15 bits each), the second 128 (7 bits each).
 */
const BASE32768_RANGES = [
  "\u04A0\u04BF\u0500\u051F\u0680\u06BF\u0760\u079F\u07C0\u07DF\u1000\u101F\u10A0\u10BF\u1100\u115F\u1180\u119F\u11E0\u123F\u1260\u127F\u12E0\u12FF\u1320\u133F\u13A0\u13DF\u1420\u165F\u16A0\u16DF\u1780\u179F\u1820\u185F\u18C0\u18DF\u1980\u199F\u19E0\u19FF\u1A20\u1A3F\u1BC0\u1BDF\u1C00\u1C1F\u1D00\u1D1F\u21E0\u21FF\u22C0\u22DF\u2340\u23DF\u2400\u241F\u2500\u275F\u2780\u27BF\u2800\u297F\u29A0\u29BF\u2A20\u2A5F\u2A80\u2ABF\u2AE0\u2B5F\u2C00\u2C1F\u2C80\u2CDF\u2D00\u2D1F\u2D40\u2D5F\u2EA0\u2EDF\u31C0\u31DF\u3400\u4D9F\u4DC0\u9FBF\uA000\uA47F\uA4A0\uA4BF\uA500\uA5FF\uA640\uA65F\uA6A0\uA6DF\uA700\uA75F\uA780\uA79F\uA840\uA85F",
  "\u0180\u019F\u0240\u029F",
];

const base32768Chars: Record<number, string[]> = {};
const base32768Values: Record<string, [bits: number, value: number]> = {};

BASE32768_RANGES.forEach((ranges, index) => {
  const chars: string[] = [];
  const pairs = ranges.match(/../gu) ?? [];
  for (const pair of pairs) {
    const start = pair.codePointAt(0)!;
    const end = pair.codePointAt(1)!;
    for (let cp = start; cp <= end; cp++) {
      chars.push(String.fromCodePoint(cp));
    }
  }
  const bits = 15 - 8 * index;
  base32768Chars[bits] = chars;
  chars.forEach((char, value) => {
    base32768Values[char] = [bits, value];
  });
});

/**
 * Encode bytes using the same Base32768 encoding Parchment uses for its
 * localStorage file provider.
 */
export function base32768Encode(bytes: Uint8Array): string {
  let out = "";
  let value = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    for (let bit = 7; bit >= 0; bit--) {
      value = (value << 1) | ((bytes[i] >> bit) & 1);
      bits++;
      if (bits === 15) {
        out += base32768Chars[15][value];
        value = 0;
        bits = 0;
      }
    }
  }
  if (bits !== 0) {
    while (!(bits in base32768Chars)) {
      value = (value << 1) | 1;
      bits++;
    }
    out += base32768Chars[bits][value];
  }
  return out;
}

/**
 * Decode a Base32768-encoded string back into bytes.
 */
export function base32768Decode(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 15) / 8));
  let value = 0;
  let bits = 0;
  let outIndex = 0;
  for (let i = 0; i < text.length; i++) {
    const entry = base32768Values[text.charAt(i)];
    if (!entry) {
      throw new Error(`Unrecognised Base32768 character: ${text.charAt(i)}`);
    }
    const [charBits, charValue] = entry;
    if (charBits !== 15 && i !== text.length - 1) {
      throw new Error("Secondary character found before end of input");
    }
    for (let b = charBits - 1; b >= 0; b--) {
      value = (value << 1) | ((charValue >> b) & 1);
      bits++;
      if (bits === 8) {
        out[outIndex++] = value;
        value = 0;
        bits = 0;
      }
    }
  }
  if (bits !== 0 && value !== (1 << bits) - 1) {
    throw new Error("Padding mismatch");
  }
  return out.subarray(0, outIndex);
}

/**
 * Story extensions Parchment 2026.8.1 maps to the Z-machine (zcode) engine.
 * Anything else is treated as Glulx. Unknown extensions are forced to `.z5`
 * so that unlabeled files still land on the Z-machine interpreter.
 */
const ZCODE_EXTENSIONS = /\.(zblorb|zlb|z3|z4|z5|z8)$/i;
const GLULX_EXTENSIONS =
  /\.(ulx|ul|glulx|glulxe|gblorb|glb|zblorb|blorb|dat)$/i;

/**
 * Make sure a story filename has an extension Parchment can use to select an
 * interpreter. Files without a recognised IF extension get `.z5` appended
 * (the old integration's behaviour, and the most common IF format).
 */
export function normalizeStoryFilename(filename: string): string {
  if (ZCODE_EXTENSIONS.test(filename) || GLULX_EXTENSIONS.test(filename)) {
    return filename;
  }
  return `${filename}.z5`;
}

/**
 * The default working directory Parchment opens its file dialog in, derived
 * the same way Parchment computes it from the uploaded story filename:
 * `/usr/<story-name-without-extension>` (lowercased).
 */
export function parchmentWorkingDir(storyFilename: string): string {
  const base = storyFilename.split("/").pop() ?? storyFilename;
  const stem = base.replace(/\.[^.]*$/, "");
  return `/usr/${(stem || base).toLowerCase().trim()}`;
}

export interface DialogMetadataEntry {
  atime: number;
  mtime: number;
}

export type DialogMetadata = Record<string, DialogMetadataEntry>;

export function readDialogMetadata(
  storage: Storage = window.localStorage,
): DialogMetadata {
  try {
    const raw = storage.getItem(DIALOG_METADATA_KEY);
    return raw ? (JSON.parse(raw) as DialogMetadata) : {};
  } catch {
    return {};
  }
}

function writeDialogMetadata(storage: Storage, metadata: DialogMetadata): void {
  storage.setItem(DIALOG_METADATA_KEY, JSON.stringify(metadata));
}

/**
 * Whether a stored path looks like a save file Parchment's restore dialog
 * offers (`.glksave` / `.sav`).
 */
export function isParchmentSaveFile(path: string): boolean {
  return /\.(glksave|sav)$/i.test(path);
}

/**
 * Write a save file directly into Parchment's localStorage provider so it
 * shows up in the in-game "Restore" dialog.
 */
export function injectSaveIntoDialog(
  storage: Storage,
  path: string,
  bytes: Uint8Array,
): void {
  storage.setItem(path, base32768Encode(bytes));
  const metadata = readDialogMetadata(storage);
  const now = Date.now();
  metadata[path] = metadata[path] ?? { atime: now, mtime: now };
  metadata[path].mtime = now;
  writeDialogMetadata(storage, metadata);
  storage.setItem(DIALOG_STORAGE_VERSION_KEY, "2");
}

/**
 * Upload a save file that Parchment wrote into localStorage to RomM.
 */
async function uploadParchmentSave(
  rom: DetailedRom,
  path: string,
  storage: Storage,
): Promise<void> {
  const raw = storage.getItem(path);
  if (!raw) return;
  const bytes = base32768Decode(raw);
  const filename = path.split("/").pop() || "save.glksave";
  // base32768Decode returns a subarray view (Uint8Array<ArrayBufferLike>);
  // copy into a fresh ArrayBuffer-backed array so it satisfies BlobPart's
  // ArrayBufferView<ArrayBuffer> (TS 5.7 typed-array generics).
  const fileBytes = new Uint8Array(bytes);
  await saveApi.uploadSaves({
    rom,
    savesToUpload: [
      {
        saveFile: new File([fileBytes], filename, {
          type: "application/octet-stream",
        }),
      },
    ],
    emulator: "parchment",
  });
}

/**
 * Watch Parchment's file index and upload any save file the game writes to
 * localStorage (manual saves and autosaves). Parchment 2026.8.1 calls its
 * bundled FileSaver directly, so the old `window.saveAs` interception can no
 * longer catch "Download save" actions; watching the storage is equivalent
 * (the game writes the save there before offering to download it).
 *
 * Only saves written after this is called are uploaded.
 *
 * @returns A cleanup function that stops the watcher.
 */
export function startCloudSaveSync(
  rom: DetailedRom,
  storage: Storage = window.localStorage,
  intervalMs = 3000,
): () => void {
  // Snapshot existing saves so we don't re-upload files from earlier sessions.
  const seen = new Map<string, number>();
  for (const [path, entry] of Object.entries(readDialogMetadata(storage))) {
    if (isParchmentSaveFile(path)) seen.set(path, entry?.mtime ?? 0);
  }

  const timer = window.setInterval(async () => {
    try {
      const metadata = readDialogMetadata(storage);
      for (const [path, entry] of Object.entries(metadata)) {
        if (!isParchmentSaveFile(path)) continue;
        const mtime = entry?.mtime ?? 0;
        if (seen.get(path) === mtime) continue;
        seen.set(path, mtime);
        await uploadParchmentSave(rom, path, storage);
      }
    } catch (err) {
      console.error("[RomM] Cloud save sync failed", err);
    }
  }, intervalMs);

  return () => window.clearInterval(timer);
}

/**
 * Download a cloud save from RomM and inject it into Parchment's localStorage
 * provider so it can be restored from the in-game "Restore" dialog.
 *
 * @param rom The ROM being played.
 * @param specificSave The save to load; when omitted the most recently
 *   updated save for the ROM is used.
 * @param storyFilename The (normalized) story filename Parchment is running,
 *   used to compute the working directory saves are shown in.
 */
export async function prepareCloudSave(
  rom: DetailedRom,
  specificSave?: SaveSchema,
  storyFilename?: string,
): Promise<void> {
  try {
    let save: SaveSchema;
    if (specificSave) {
      save = specificSave;
    } else {
      const response = await api.get<SaveSchema[]>("/saves", {
        params: { rom_id: rom.id },
      });
      const saves = response.data;
      if (!saves || saves.length === 0) {
        console.log("[RomM] No cloud saves found for this ROM");
        return;
      }
      save = [...saves].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0];
    }

    console.log(`[RomM] Downloading save: ${save.file_name}`);

    const response = await api.get(save.download_path, {
      responseType: "arraybuffer",
    });

    const storyName = normalizeStoryFilename(
      storyFilename || rom.fs_name || "game.z5",
    );
    const path = `${parchmentWorkingDir(storyName)}/${save.file_name}`;
    injectSaveIntoDialog(
      window.localStorage,
      path,
      new Uint8Array(response.data),
    );
    console.log(
      `[RomM] Injected save ${save.file_name} into Parchment storage`,
    );
  } catch (err) {
    console.error("[RomM] Error preparing cloud save:", err);
  }
}
