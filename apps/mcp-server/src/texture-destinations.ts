import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  savedTextureSchema,
  textureDestinationSchema,
  type SavedTexture,
  type TextureDestination,
} from "@blockbench-codex/contracts";

export const manifestFileName = "codex-textures.jsonl";

export interface DestinationOptions {
  /** Where the per-project destination map is remembered. */
  readonly configPath?: string;
}

export interface SaveTextureInput {
  readonly projectId: string;
  readonly projectFilePath?: string | undefined;
  readonly fileName: string;
  readonly bytes: Buffer;
  /** Provenance recorded in the manifest. Never include secrets. */
  readonly provenance: Record<string, unknown>;
  readonly savedAt?: Date;
}

function defaultConfigPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_CONFIG_HOME ?? process.cwd();
  return join(base, "BlockbenchCodexStudio", "texture-destinations.json");
}

/** Keeps a generated name usable as a Minecraft resource file name. */
export function sanitizeFileName(name: string): string {
  const withoutExtension = name.replace(/\.png$/iu, "");
  const cleaned = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "_")
    .replace(/_{2,}/gu, "_")
    .replace(/^[_-]+|[_-]+$/gu, "")
    .slice(0, 60);
  return `${cleaned === "" ? "texture" : cleaned}.png`;
}

/**
 * Suggests the usual Minecraft texture folders under the saved project, while
 * leaving any other folder selectable.
 */
export function suggestDestinations(projectFilePath?: string): string[] {
  if (projectFilePath === undefined) return [];
  const projectDirectory = dirname(projectFilePath);
  const segments = projectDirectory.split(sep);
  const assetsIndex = segments.lastIndexOf("assets");
  const modId =
    assetsIndex >= 0 && segments[assetsIndex + 1] !== undefined
      ? segments[assetsIndex + 1]!
      : "modid";
  const root =
    assetsIndex >= 0
      ? segments.slice(0, assetsIndex).join(sep)
      : projectDirectory;
  return ["block", "item", "entity"].map((kind) =>
    join(root, "assets", modId, "textures", kind),
  );
}

function relativeToProject(
  absolutePath: string,
  projectFilePath?: string,
): string | null {
  if (projectFilePath === undefined) return null;
  const relativePath = relative(dirname(projectFilePath), absolutePath);
  return relativePath === "" ? "." : relativePath;
}

export class TextureDestinationStore {
  readonly #configPath: string;
  #paths: Record<string, string>;

  constructor(options: DestinationOptions = {}) {
    this.#configPath = options.configPath ?? defaultConfigPath();
    this.#paths = this.#read();
  }

  /** Reports the remembered folder for a project and whether it is usable. */
  status(projectId: string, projectFilePath?: string): TextureDestination {
    const absolutePath = this.#paths[projectId];
    const suggestions = suggestDestinations(projectFilePath);
    if (absolutePath === undefined)
      return textureDestinationSchema.parse({
        projectId,
        absolutePath: null,
        projectRelativePath: null,
        exists: false,
        writable: false,
        detail: "No texture folder has been chosen for this project yet.",
        suggestions,
      });

    const exists = existsSync(absolutePath);
    const writable = exists && this.#isWritableDirectory(absolutePath);
    return textureDestinationSchema.parse({
      projectId,
      absolutePath,
      projectRelativePath: relativeToProject(absolutePath, projectFilePath),
      exists,
      writable,
      detail: !exists
        ? "The remembered folder no longer exists."
        : writable
          ? "The folder is writable."
          : "The folder exists but cannot be written to.",
      suggestions,
    });
  }

  /** Remembers a folder, creating it only when explicitly asked to. */
  set(
    projectId: string,
    absolutePath: string,
    options: {
      readonly create?: boolean;
      readonly projectFilePath?: string;
    } = {},
  ): TextureDestination {
    if (!isAbsolute(absolutePath))
      throw new Error("The texture folder must be an absolute path.");
    const resolved = resolve(absolutePath);
    if (!existsSync(resolved)) {
      if (options.create !== true)
        throw new Error(
          "The texture folder does not exist. Choose an existing folder or pass create.",
        );
      mkdirSync(resolved, { recursive: true });
    }
    if (!statSync(resolved).isDirectory())
      throw new Error("The texture destination must be a folder.");
    this.#paths = { ...this.#paths, [projectId]: resolved };
    this.#write();
    return this.status(projectId, options.projectFilePath);
  }

  /**
   * Writes a PNG into the remembered folder. Existing files are never
   * overwritten; a unique name is chosen instead and reported as renamed.
   */
  save(input: SaveTextureInput): SavedTexture {
    const destination = this.status(input.projectId, input.projectFilePath);
    if (destination.absolutePath === null)
      throw new Error("Choose a texture folder for this project first.");
    if (!destination.writable) throw new Error(destination.detail);

    const requested = sanitizeFileName(input.fileName);
    const fileName = this.#uniqueFileName(destination.absolutePath, requested);
    const absolutePath = join(destination.absolutePath, fileName);
    writeFileSync(absolutePath, input.bytes, { flag: "wx" });

    const savedAt = (input.savedAt ?? new Date()).toISOString();
    const manifestPath = this.#appendManifest(destination.absolutePath, {
      file: fileName,
      savedAt,
      ...input.provenance,
    });

    return savedTextureSchema.parse({
      variantId:
        typeof input.provenance.variantId === "string"
          ? input.provenance.variantId
          : "unknown",
      fileName,
      absolutePath,
      projectRelativePath: relativeToProject(
        absolutePath,
        input.projectFilePath,
      ),
      byteLength: input.bytes.byteLength,
      renamed: fileName !== requested,
      manifestPath,
      savedAt,
    });
  }

  #uniqueFileName(directory: string, fileName: string): string {
    if (!existsSync(join(directory, fileName))) return fileName;
    const base = fileName.replace(/\.png$/u, "");
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}_${suffix}.png`;
      if (!existsSync(join(directory, candidate))) return candidate;
    }
  }

  /** The manifest records provenance only; it never receives credentials. */
  #appendManifest(
    directory: string,
    entry: Record<string, unknown>,
  ): string | null {
    const manifestPath = join(directory, manifestFileName);
    try {
      appendFileSync(manifestPath, `${JSON.stringify(entry)}\n`, "utf8");
      return manifestPath;
    } catch {
      return null;
    }
  }

  #isWritableDirectory(path: string): boolean {
    try {
      if (!statSync(path).isDirectory()) return false;
      accessSync(path, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  #read(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(this.#configPath, "utf8"),
      );
      if (typeof parsed !== "object" || parsed === null) return {};
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  #write(): void {
    try {
      mkdirSync(dirname(this.#configPath), { recursive: true });
      writeFileSync(
        this.#configPath,
        JSON.stringify(this.#paths, null, 2),
        "utf8",
      );
    } catch {
      // A read-only config location must not break an otherwise valid save.
    }
  }
}
