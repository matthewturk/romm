import { describe, expect, it } from "vitest";
import {
  isParchmentEmulationSupported,
  languageToEmoji,
  regionToEmoji,
} from "@/utils";

describe("regionToEmoji", () => {
  it("does not render Public Domain as the Poland flag", () => {
    expect(regionToEmoji("PD")).toBe("PD");
    expect(regionToEmoji("Public Domain")).toBe("Public Domain");
  });
});

describe("languageToEmoji", () => {
  it("keeps the Polish language flag mapping", () => {
    expect(languageToEmoji("PL")).toBe("🇵🇱");
    expect(languageToEmoji("Polish")).toBe("🇵🇱");
  });
});

describe("isParchmentEmulationSupported", () => {
  it("allows the Z-machine platform", () => {
    expect(isParchmentEmulationSupported("z-machine", {} as never)).toBe(true);
    expect(isParchmentEmulationSupported("Z-MACHINE", {} as never)).toBe(true);
  });

  it("allows the Glulx platform", () => {
    expect(isParchmentEmulationSupported("glulx", {} as never)).toBe(true);
    expect(isParchmentEmulationSupported("GLULX", {} as never)).toBe(true);
  });

  it("rejects other platforms", () => {
    expect(isParchmentEmulationSupported("genesis", {} as never)).toBe(false);
    expect(isParchmentEmulationSupported("nes", {} as never)).toBe(false);
  });

  it("resolves version aliases via PLATFORMS_VERSIONS", () => {
    expect(
      isParchmentEmulationSupported(
        "my-zmachines-folder",
        {} as never,
        {
          PLATFORMS_VERSIONS: { "my-zmachines-folder": "z-machine" },
        } as never,
      ),
    ).toBe(true);
  });
});
