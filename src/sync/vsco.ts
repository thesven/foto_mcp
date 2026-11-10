import fs from "node:fs/promises";
import path from "node:path";
import { FotoClient, PublishResult } from "../foto-client.js";
import { suggestTags } from "../tags.js";
import { inspectImage, ImageInspection } from "../media/processor.js";

export interface ParsedVscoEntry {
  id: string;
  description: string;
  preset?: string;
  cameraMake?: string;
  cameraModel?: string;
  dateCaptured?: string;
  tags: string[];
  journalTitle?: string;
  fileName?: string;
}

export interface VscoSyncCandidate {
  entry: ParsedVscoEntry;
  resolvedImagePath?: string;
  isAlreadyPublished: boolean;
  duplicateReason?: string;
  presetMappedTags: string[];
  suggestedTags: string[];
  tagExplanation: string;
  imageInspection?: ImageInspection;
  uploadDimensions?: { width: number; height: number };
  status: "READY" | "ALREADY_PUBLISHED" | "IMAGE_NOT_FOUND" | "INVALID_TAGS";
  publishResult?: PublishResult;
}

export interface VscoSyncReport {
  dryRun: boolean;
  totalParsed: number;
  readyToPublish: number;
  alreadyPublishedCount: number;
  candidates: VscoSyncCandidate[];
}

/**
 * Maps VSCO film emulation preset codes to Foto's 303 curated tags
 */
export function mapVscoPresetToTags(preset?: string): string[] {
  if (!preset) return [];
  const code = preset.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  // B&W Presets: B1-B6, X1-X6, KX4, FP4, HP5, TMY, TRI
  if (/^(B[1-6]|X[1-6]|KX4|FP4|HP5|TMY|TRI|01|02|03)$/.test(code) || code.includes("BW") || code.includes("MONO")) {
    return ["Black and White", "Analog"];
  }

  // Analog / Aesthetic Presets: A1-A10, M1-M6, F1-F3
  if (/^(A[1-9]|A10|M[1-6]|F[1-3])$/.test(code)) {
    return ["Analog", "Minimalist"];
  }

  // Kodak / Agfa / Fuji Film Emulation Presets: KP1-KP9, KA1, KE1, KF1, FP1-FP8, FR4, FS1, FT6
  if (/^(KP[1-9]|KA\d|KE\d|KF\d|FP\d|FR\d|FS\d|FT\d|AU\d|AV\d|IH\d)$/.test(code)) {
    return ["Analog", "Film", "Color"];
  }

  // Chromatic / Vibrant Presets: C1-C9, G1-G3, HB1-HB2, E1-E8
  if (/^(C[1-9]|G[1-3]|HB[1-2]|E[1-8])$/.test(code)) {
    return ["Color", "Analog"];
  }

  // Moody / Atmospheric Presets: T1-T3, P1-P9, J1-J6
  if (/^(T[1-3]|P[1-9]|J[1-6])$/.test(code)) {
    return ["Analog", "Fine Art"];
  }

  return [];
}

export class VscoSyncTool {
  constructor(private client: FotoClient) {}

  /**
   * Parses VSCO export data from a JSON file, HTML file, or directory containing VSCO exports
   */
  async parseVscoExport(inputPath: string): Promise<ParsedVscoEntry[]> {
    const stat = await fs.stat(inputPath);
    const entries: ParsedVscoEntry[] = [];

    if (stat.isDirectory()) {
      const files = await fs.readdir(inputPath);
      const jsonFiles = files.filter(f => f.endsWith(".json"));
      for (const jf of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(inputPath, jf), "utf-8");
          const parsed = JSON.parse(content);
          entries.push(...this.extractEntriesFromJson(parsed));
        } catch {
          // Skip invalid JSON
        }
      }
    } else if (inputPath.toLowerCase().endsWith(".json")) {
      const content = await fs.readFile(inputPath, "utf-8");
      const parsed = JSON.parse(content);
      entries.push(...this.extractEntriesFromJson(parsed));
    }

    return entries;
  }

  private extractEntriesFromJson(parsed: any): ParsedVscoEntry[] {
    const list: ParsedVscoEntry[] = [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const entry = this.normalizeVscoItem(item);
        if (entry) list.push(entry);
      }
    } else if (parsed && typeof parsed === "object") {
      const arr = parsed.media || parsed.grid || parsed.journals || parsed.photos || parsed.posts;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const entry = this.normalizeVscoItem(item);
          if (entry) list.push(entry);
        }
      } else {
        const entry = this.normalizeVscoItem(parsed);
        if (entry) list.push(entry);
      }
    }
    return list;
  }

  private normalizeVscoItem(item: any): ParsedVscoEntry | null {
    if (!item || typeof item !== "object") return null;

    const id = String(item.id || item._id || item.media_id || item.grid_id || "");
    const rawDesc = String(item.description || item.caption || item.text || "");
    // Clean hashtags from description while capturing them as tags
    const extractedHashtags: string[] = [];
    const cleanedDesc = rawDesc
      .replace(/#([a-zA-Z0-9_]+)/g, (_, tag) => {
        extractedHashtags.push(tag);
        return "";
      })
      .replace(/\s+/g, " ")
      .trim();

    const preset = item.preset
      ? typeof item.preset === "string"
        ? item.preset
        : item.preset.name || item.preset.code || item.preset.short_name
      : item.preset_code || item.filter;

    let tags: string[] = [...extractedHashtags];
    if (Array.isArray(item.tags)) {
      for (const t of item.tags) {
        const val = typeof t === "string" ? t : t.text || t.tag || "";
        if (val && !tags.includes(val)) tags.push(val);
      }
    }

    const fileName =
      item.file ||
      item.fileName ||
      item.image_file ||
      item.responsive_url ||
      (id ? `${id}.jpg` : undefined);

    return {
      id,
      description: cleanedDesc,
      preset: preset ? String(preset) : undefined,
      cameraMake: item.camera_make || item.make,
      cameraModel: item.camera_model || item.model,
      dateCaptured: item.capture_date || item.upload_date || item.created_at,
      journalTitle: item.journal_title || item.title,
      tags,
      fileName: fileName ? path.basename(String(fileName)) : undefined
    };
  }

  async resolveImageFile(mediaDir: string, entry: ParsedVscoEntry): Promise<string | undefined> {
    const candidates: string[] = [];
    if (entry.fileName) {
      candidates.push(path.join(mediaDir, entry.fileName));
    }
    if (entry.id) {
      candidates.push(path.join(mediaDir, `${entry.id}.jpg`));
      candidates.push(path.join(mediaDir, `${entry.id}.jpeg`));
      candidates.push(path.join(mediaDir, `${entry.id}.png`));
    }

    for (const c of candidates) {
      try {
        const s = await fs.stat(c);
        if (s.isFile()) return c;
      } catch {
        // try next
      }
    }

    if (entry.id) {
      try {
        const files = await fs.readdir(mediaDir);
        const match = files.find(f => f.startsWith(entry.id));
        if (match) return path.join(mediaDir, match);
      } catch {
        // ignore
      }
    }

    return undefined;
  }

  /**
   * Syncs a VSCO archive (Grid & Journals) to Foto
   */
  async sync(params: {
    exportPath: string;
    mediaDir?: string;
    maxPhotos?: number;
    dryRun?: boolean;
    defaultTags?: string[];
  }): Promise<VscoSyncReport> {
    const { exportPath, maxPhotos = 20, dryRun = true, defaultTags = [] } = params;
    const isDir = (await fs.stat(exportPath)).isDirectory();
    const mediaDir = params.mediaDir || (isDir ? exportPath : path.dirname(exportPath));

    const parsedEntries = await this.parseVscoExport(exportPath);
    const toProcess = parsedEntries.slice(0, maxPhotos);

    let publishedCaptions: string[] = [];
    try {
      const userProfile = await this.client.getUserProfile();
      if (Array.isArray(userProfile.posts)) {
        publishedCaptions = userProfile.posts.map((p: any) => (p.description || "").trim().toLowerCase());
      }
    } catch {
      // Offline / unauthenticated in dryRun
    }

    const candidates: VscoSyncCandidate[] = [];

    for (const entry of toProcess) {
      const resolvedPath = await this.resolveImageFile(mediaDir, entry);
      const captionParts = [entry.journalTitle, entry.description].filter(Boolean);
      const fullCaption = captionParts.join("\n\n").trim();

      const isDuplicate = publishedCaptions.some(
        c => c.length > 5 && fullCaption && c === fullCaption.toLowerCase()
      );

      const presetMappedTags = mapVscoPresetToTags(entry.preset);
      const cameraInfo = [entry.cameraMake, entry.cameraModel, entry.preset].filter(Boolean).join(" ");

      const tagSuggestion = suggestTags({
        caption: fullCaption,
        cameraInfo,
        keywords: [...presetMappedTags, ...entry.tags]
      });

      const mergedTags = Array.from(
        new Set([...presetMappedTags, ...tagSuggestion.suggestedTags])
      ).slice(0, 3);

      const chosenTags =
        defaultTags.length > 0
          ? defaultTags.slice(0, 3)
          : mergedTags.length > 0
          ? mergedTags
          : ["Everyday Life"];

      let inspection: ImageInspection | undefined;
      let status: VscoSyncCandidate["status"] = "READY";
      let duplicateReason: string | undefined;

      if (isDuplicate) {
        status = "ALREADY_PUBLISHED";
        duplicateReason = "A post with matching caption was already published on your Foto account.";
      } else if (!resolvedPath) {
        status = "IMAGE_NOT_FOUND";
      } else {
        try {
          inspection = await inspectImage(resolvedPath, { preview: false });
          if (!inspection.supportedFormat) {
            status = "INVALID_TAGS";
          }
        } catch {
          status = "IMAGE_NOT_FOUND";
        }
      }

      let publishResult: PublishResult | undefined;
      if (!dryRun && status === "READY" && resolvedPath) {
        try {
          publishResult = await this.client.publishPost({
            filePath: resolvedPath,
            caption: fullCaption || (entry.preset ? `Processed with VSCO ${entry.preset}` : "VSCO archive import"),
            tags: chosenTags,
            dryRun: false
          });
        } catch (err: any) {
          status = "INVALID_TAGS";
          duplicateReason = err.message;
        }
      }

      candidates.push({
        entry,
        resolvedImagePath: resolvedPath,
        isAlreadyPublished: isDuplicate,
        duplicateReason,
        presetMappedTags,
        suggestedTags: chosenTags,
        tagExplanation: presetMappedTags.length > 0
          ? `Mapped VSCO preset ${entry.preset} -> [${presetMappedTags.join(", ")}]; ${tagSuggestion.explanation}`
          : tagSuggestion.explanation,
        imageInspection: inspection,
        uploadDimensions: inspection?.targetUploadDimensions,
        status,
        publishResult
      });
    }

    return {
      dryRun,
      totalParsed: parsedEntries.length,
      readyToPublish: candidates.filter(c => c.status === "READY").length,
      alreadyPublishedCount: candidates.filter(c => c.status === "ALREADY_PUBLISHED").length,
      candidates
    };
  }
}
