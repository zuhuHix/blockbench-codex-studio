import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TextureDestinationStore,
  manifestFileName,
  sanitizeFileName,
  suggestDestinations,
} from "./texture-destinations.js";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "codex-textures-"));
  return {
    root,
    store: new TextureDestinationStore({
      configPath: join(root, "config", "destinations.json"),
    }),
    textures: join(root, "textures"),
  };
}

function provenance() {
  return {
    variantId: "variant-1",
    prompt: "mossy lab wall",
    mode: "new-seamless-texture",
    provider: "comfyui",
  };
}

describe("texture destinations", () => {
  it("sanitizes generated names into Minecraft-safe file names", () => {
    expect(sanitizeFileName("Mossy Lab Wall.png")).toBe("mossy_lab_wall.png");
    expect(sanitizeFileName("  ../../etc/passwd  ")).toBe("etc_passwd.png");
    expect(sanitizeFileName("***")).toBe("texture.png");
  });

  it("suggests Minecraft folders from the saved project location", () => {
    const suggestions = suggestDestinations(
      [
        "C:",
        "mods",
        "src",
        "assets",
        "labcraft",
        "models",
        "blob.bbmodel",
      ].join(sep),
    );
    expect(suggestions[0]).toBe(
      ["C:", "mods", "src", "assets", "labcraft", "textures", "block"].join(
        sep,
      ),
    );
    expect(suggestDestinations(undefined)).toEqual([]);
  });

  it("reports an unchosen destination without inventing a path", () => {
    const { store } = workspace();
    const status = store.status("project-1");
    expect(status).toMatchObject({
      absolutePath: null,
      exists: false,
      writable: false,
    });
    expect(status.detail).toContain("No texture folder");
  });

  it("remembers a created folder per project and resolves it relatively", () => {
    const { store, textures, root } = workspace();
    const projectFilePath = join(root, "models", "blob.bbmodel");
    const status = store.set("project-1", textures, {
      create: true,
      projectFilePath,
    });
    expect(status).toMatchObject({ absolutePath: textures, writable: true });
    expect(status.projectRelativePath).toBe(join("..", "textures"));
    expect(store.status("project-2").absolutePath).toBeNull();
  });

  it("refuses a relative path and a missing folder", () => {
    const { store, textures } = workspace();
    expect(() => store.set("project-1", "textures")).toThrow("absolute path");
    expect(() => store.set("project-1", textures)).toThrow("does not exist");
  });

  it("saves a unique file and records provenance in the manifest", () => {
    const { store, textures } = workspace();
    store.set("project-1", textures, { create: true });
    writeFileSync(join(textures, "lab_wall.png"), "existing");

    const saved = store.save({
      projectId: "project-1",
      fileName: "Lab Wall",
      bytes: pngBytes,
      provenance: provenance(),
      savedAt: new Date("2026-09-02T10:00:00.000Z"),
    });

    expect(saved.fileName).toBe("lab_wall_2.png");
    expect(saved.renamed).toBe(true);
    expect(readFileSync(join(textures, "lab_wall.png"), "utf8")).toBe(
      "existing",
    );
    expect(readFileSync(saved.absolutePath)).toEqual(pngBytes);

    const manifest = readFileSync(join(textures, manifestFileName), "utf8");
    expect(JSON.parse(manifest.trim())).toMatchObject({
      file: "lab_wall_2.png",
      prompt: "mossy lab wall",
      provider: "comfyui",
      savedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(readdirSync(textures)).toHaveLength(3);
  });

  it("refuses to save before a folder is chosen", () => {
    const { store } = workspace();
    expect(() =>
      store.save({
        projectId: "project-1",
        fileName: "wall",
        bytes: pngBytes,
        provenance: provenance(),
      }),
    ).toThrow("Choose a texture folder");
  });

  it("remembers destinations across store instances", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-textures-"));
    const configPath = join(root, "destinations.json");
    const textures = join(root, "textures");
    new TextureDestinationStore({ configPath }).set("project-1", textures, {
      create: true,
    });
    expect(
      new TextureDestinationStore({ configPath }).status("project-1")
        .absolutePath,
    ).toBe(textures);
  });
});
