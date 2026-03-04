import saveApi from "@/services/api/save";
import api from "@/services/api";
import type { DetailedRom } from "@/stores/roms";
import type { SaveSchema } from "@/__generated__";

/**
 * Intercepts the global saveAs function (used by FileSaver.js in Parchment)
 * to upload save files to the RomM server.
 *
 * @param rom The DetailedRom object
 */
export function injectSaveHooks(rom: DetailedRom) {
  // Store the original saveAs function so we can fallback to it or call it
  // @ts-ignore
  const originalSaveAs =
    (window as any).saveAs || ((blob: Blob, name: string) => {});

  // Override the global saveAs
  // @ts-ignore
  (window as any).saveAs = async (blob: Blob, filename: string) => {
    // Parchment save files usually end in .glksave, .save, or are "autosave" JSONs disguised
    // We only care about explicit saves for now.
    // Note: Parchment manual saves are explicit files.
    if (
      filename.endsWith(".glksave") ||
      filename.endsWith(".save") ||
      filename.includes("save") ||
      filename.includes("glkdata")
    ) {
      console.log(`[RomM] Intercepted Parchment Save: ${filename}`);

      try {
        // Convert Blob to File
        const file = new File([blob], filename, { type: blob.type });

        // Upload to RomM
        await saveApi.uploadSaves({
          rom,
          savesToUpload: [
            {
              saveFile: file,
              // we could grab canvas screenshot here if we want but it's complex without direct access
            },
          ],
          emulator: "parchment",
        });

        console.log("[RomM] Cloud save successful");

        // Optional: Show a toast notification here
      } catch (e) {
        console.error("[RomM] Cloud save failed", e);
      }
    }

    // Always allow the default behavior (download to disk) as a backup
    // This ensures the user still has their save if our upload fails.
    return originalSaveAs(blob, filename);
  };

  console.log("[RomM] Parchment save hooks injected");
}

export async function prepareCloudSave(
  rom: DetailedRom,
  specificSave?: SaveSchema,
) {
  try {
    const glkOte = await waitForGlkOte();
    if (!glkOte) {
      console.warn("[RomM] GlkOte not found, cannot auto-load save");
      return;
    }

    // Wait for Blorb to be initialized (it might be async)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const blorb = glkOte.getlibrary("Blorb");
    if (!blorb) {
      console.warn("[RomM] Blorb library not found in Parchment");
      return;
    }

    // Attempt to get IFID from metadata
    // The tag is usually "ifid" (lowercased)
    const ifid = blorb.get_metadata("ifid");
    if (!ifid) {
      console.warn("[RomM] IFID not found in story metadata");
      return;
    }

    console.log(`[RomM] Identified Story IFID: ${ifid}`);

    let latestSave: SaveSchema;

    if (specificSave) {
      latestSave = specificSave;
    } else {
      // Fetch saves for this ROM
      const response = await api.get<SaveSchema[]>("/saves", {
        params: { rom_id: rom.id },
      });
      const saves = response.data;

      if (!saves || saves.length === 0) {
        console.log("[RomM] No cloud saves found for this ROM");
        return;
      }

      // Sort by updated_at desc to get the latest
      saves.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      latestSave = saves[0];
    }

    console.log(`[RomM] Downloading save: ${latestSave.file_name}`);

    // Download the save file content
    const saveContent = await api.get(latestSave.download_path, {
      responseType: "arraybuffer",
    });

    const fileData = new Uint8Array(saveContent.data);

    // Inject into Dialog
    const dialog = glkOte.getlibrary("Dialog");
    if (!dialog) {
      console.warn("[RomM] Dialog library not found");
      return;
    }

    // Construct the file reference
    // Parchment's Dialog.file_construct_ref(filename, usage, gameid)
    // Usage is usually 'save' for save files.
    // GameID is the IFID.
    const ref = dialog.file_construct_ref(latestSave.file_name, "save", ifid);

    // Write to virtual filesystem
    // Dialog.file_write(ref, content)
    // Content should be Uint8Array (or similar that Dialog accepts)
    const success = dialog.file_write(ref, fileData);

    if (success) {
      console.log(
        `[RomM] Successfully injected save ${latestSave.file_name} into Parchment storage`,
      );
      // We don't need to do anything else; it should appear in the "Restore" dialog now.
    } else {
      console.error("[RomM] Failed to write save to Parchment storage");
    }
  } catch (err) {
    console.error("[RomM] Error preparing cloud save:", err);
  }
}

async function waitForGlkOte(timeout = 10000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((window as any).GlkOte) {
      return (window as any).GlkOte;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}
