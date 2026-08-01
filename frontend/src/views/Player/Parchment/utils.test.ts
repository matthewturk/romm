import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import saveApi from "@/services/api/save";
import type { DetailedRom } from "@/stores/roms";
import {
  base32768Decode,
  base32768Encode,
  injectSaveIntoDialog,
  isParchmentSaveFile,
  normalizeStoryFilename,
  parchmentWorkingDir,
  readDialogMetadata,
  startCloudSaveSync,
  DIALOG_METADATA_KEY,
  DIALOG_STORAGE_VERSION_KEY,
} from "./utils";

vi.mock("@/services/api/save", () => ({
  default: { uploadSaves: vi.fn().mockResolvedValue([]) },
}));

/* ------------------------------------------------------------------ *
 * In-memory Storage stub (happy-dom provides window.localStorage, but
 * stubbing keeps the tests deterministic and independent of the runner).
 * ------------------------------------------------------------------ */
function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as Storage;
}

const bytes = (s: string) => new TextEncoder().encode(s);

/* ------------------------------------------------------------------ *
 * Base32768 — vectors computed from Parchment 2026.8.1's own Da/Au.
 * ------------------------------------------------------------------ */
describe("base32768", () => {
  it("encodes known vectors identically to Parchment", () => {
    expect(base32768Encode(new Uint8Array([]))).toBe("");
    expect(base32768Encode(new Uint8Array([0]))).toBe("\u06BF");
    expect(base32768Encode(new Uint8Array([255]))).toBe("\uA85F");
    expect(base32768Encode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(
      "\u0761\u07C1\u0780\u86D0\u0267",
    );
    expect(base32768Encode(bytes("Hello"))).toBe("\u4A72\u817B\u343F");
    expect(base32768Encode(bytes("RomM save file"))).toBe(
      "\u4F97\u81B3\u4A4E\u5C77\u5989\u1199\u7938\u0285",
    );
  });

  it("round-trips", () => {
    const samples = [
      new Uint8Array([0]),
      new Uint8Array([255]),
      new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256)),
      bytes("A story save with some text"),
    ];
    for (const sample of samples) {
      expect(Array.from(base32768Decode(base32768Encode(sample)))).toEqual(
        Array.from(sample),
      );
    }
  });

  it("decodes the library's own output", () => {
    expect(
      Array.from(base32768Decode("\u0761\u07C1\u0780\u86D0\u0267")),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("throws on characters outside the alphabet", () => {
    expect(() => base32768Decode("Z")).toThrow("Unrecognised Base32768");
  });

  it("throws when a secondary (7-bit) character appears early", () => {
    expect(() => base32768Decode("\u0190\u019F")).toThrow(
      "Secondary character found before end of input",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Story filename normalization (drives VM selection: zcode vs glulx).
 * ------------------------------------------------------------------ */
describe("normalizeStoryFilename", () => {
  it("keeps recognised zcode extensions", () => {
    for (const name of [
      "Zork.zblorb",
      "zork.zlb",
      "game.z3",
      "game.z4",
      "game.z5",
      "game.z8",
      "GAME.Z5",
    ]) {
      expect(normalizeStoryFilename(name)).toBe(name);
    }
  });

  it("keeps recognised glulx extensions", () => {
    for (const name of [
      "game.ulx",
      "game.ul",
      "game.glulx",
      "game.glulxe",
      "game.gblorb",
      "game.glb",
      "game.blorb",
      "game.dat",
    ]) {
      expect(normalizeStoryFilename(name)).toBe(name);
    }
  });

  it("appends .z5 to extensionless or unknown filenames", () => {
    expect(normalizeStoryFilename("mystery")).toBe("mystery.z5");
    expect(normalizeStoryFilename("story.txt")).toBe("story.txt.z5");
  });
});

/* ------------------------------------------------------------------ *
 * Working directory Parchment opens its dialog in.
 * ------------------------------------------------------------------ */
describe("parchmentWorkingDir", () => {
  it("lowercases the story stem into /usr/", () => {
    expect(parchmentWorkingDir("Zork.z5")).toBe("/usr/zork");
    expect(parchmentWorkingDir("foo/bar.ulx")).toBe("/usr/bar");
    expect(parchmentWorkingDir("mystery.zblorb")).toBe("/usr/mystery");
  });
});

/* ------------------------------------------------------------------ *
 * Save file detection.
 * ------------------------------------------------------------------ */
describe("isParchmentSaveFile", () => {
  it("detects glksave and sav paths", () => {
    expect(isParchmentSaveFile("/usr/zork/autosave.glksave")).toBe(true);
    expect(isParchmentSaveFile("/usr/zork/quick.sav")).toBe(true);
    expect(isParchmentSaveFile("/usr/zork/untitled.z5")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * localStorage provider writes (injectSaveIntoDialog).
 * ------------------------------------------------------------------ */
describe("injectSaveIntoDialog / readDialogMetadata", () => {
  let storage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = makeStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores Base32768 bytes under the full path", () => {
    injectSaveIntoDialog(storage, "/usr/zork/run1.glksave", bytes("save"));
    expect(storage.getItem("/usr/zork/run1.glksave")).toBe(
      base32768Encode(bytes("save")),
    );
  });

  it("records the file in dialog_metadata and bumps mtime", () => {
    injectSaveIntoDialog(storage, "/usr/zork/run1.glksave", bytes("save"));
    const first = readDialogMetadata(storage);
    expect(first["/usr/zork/run1.glksave"]).toBeDefined();
    expect(first["/usr/zork/run1.glksave"].mtime).toBeGreaterThan(0);

    const injectedAt = first["/usr/zork/run1.glksave"].mtime;
    // Two writes in the same real-time millisecond would record the same
    // mtime; advance the mocked clock so the bump is observable.
    vi.setSystemTime(injectedAt + 1);
    injectSaveIntoDialog(storage, "/usr/zork/run1.glksave", bytes("save2"));
    const second = readDialogMetadata(storage);
    expect(second["/usr/zork/run1.glksave"].mtime).toBeGreaterThan(injectedAt);
  });

  it("sets the storage version key", () => {
    injectSaveIntoDialog(storage, "/usr/zork/run1.glksave", bytes("save"));
    expect(storage.getItem(DIALOG_STORAGE_VERSION_KEY)).toBe("2");
  });

  it("does not clobber metadata of other files", () => {
    injectSaveIntoDialog(storage, "/usr/zork/a.sav", bytes("a"));
    injectSaveIntoDialog(storage, "/usr/zork/b.glksave", bytes("b"));
    const metadata = readDialogMetadata(storage);
    expect(Object.keys(metadata).sort()).toEqual([
      "/usr/zork/a.sav",
      "/usr/zork/b.glksave",
    ]);
  });

  it("returns an empty index when metadata is absent or corrupt", () => {
    expect(readDialogMetadata(storage)).toEqual({});
    storage.setItem(DIALOG_METADATA_KEY, "not json");
    expect(readDialogMetadata(storage)).toEqual({});
  });
});

/* ------------------------------------------------------------------ *
 * Cloud save sync watcher.
 * ------------------------------------------------------------------ */
describe("startCloudSaveSync", () => {
  let storage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = makeStorage();
    vi.mocked(saveApi.uploadSaves).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const rom = { id: 1 } as DetailedRom;

  function addSave(path: string, content: string) {
    injectSaveIntoDialog(storage, path, bytes(content));
  }

  it("does not upload saves that existed before syncing started", async () => {
    addSave("/usr/zork/old.glksave", "old");
    const stop = startCloudSaveSync(rom, storage, 3000);
    await vi.advanceTimersByTimeAsync(10_000);
    stop();
    expect(saveApi.uploadSaves).not.toHaveBeenCalled();
  });

  it("uploads saves written after syncing started", async () => {
    const stop = startCloudSaveSync(rom, storage, 3000);
    addSave("/usr/zork/new.glksave", "new");
    await vi.advanceTimersByTimeAsync(3000);
    stop();

    expect(saveApi.uploadSaves).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(saveApi.uploadSaves).mock.calls[0][0];
    expect(arg.rom).toBe(rom);
    expect(arg.emulator).toBe("parchment");
    expect(arg.savesToUpload).toHaveLength(1);
    expect(arg.savesToUpload[0].saveFile.name).toBe("new.glksave");
  });

  it("does not re-upload an unchanged save on subsequent ticks", async () => {
    const stop = startCloudSaveSync(rom, storage, 3000);
    addSave("/usr/zork/s.sav", "s");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(6000);
    stop();
    expect(saveApi.uploadSaves).toHaveBeenCalledTimes(1);
  });

  it("uploads when an existing save is rewritten (mtime bump)", async () => {
    addSave("/usr/zork/s.sav", "v1");
    const stop = startCloudSaveSync(rom, storage, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    addSave("/usr/zork/s.sav", "v2");
    await vi.advanceTimersByTimeAsync(3000);
    stop();
    expect(saveApi.uploadSaves).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the cleanup function is called", async () => {
    const stop = startCloudSaveSync(rom, storage, 3000);
    stop();
    addSave("/usr/zork/s.sav", "s");
    await vi.advanceTimersByTimeAsync(6000);
    expect(saveApi.uploadSaves).not.toHaveBeenCalled();
  });
});
