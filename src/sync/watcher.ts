import fs from "node:fs/promises";
import path from "node:path";
import { FotoClient } from "../foto-client.js";
import { inspectImage, ImageInspection } from "../media/processor.js";
import { suggestTags } from "../tags.js";

export interface WatchedPhotoDraft {
  filePath: string;
  fileName: string;
  inspection: ImageInspection;
  suggestedTags: string[];
  cameraSummary: string;
  readyToPublish: boolean;
}

export interface WatchDirectoryReport {
  directoryPath: string;
  totalImagesFound: number;
  drafts: WatchedPhotoDraft[];
  message: string;
}

export class WatchFolderService {
  constructor(private client: FotoClient) {}

  /**
   * Scans a desktop export folder (e.g. from Lightroom, Capture One, Darktable),
   * auto-inspects new photography exports, extracts technical EXIF, strips GPS,
   * generates color-corrected previews, and formats ready-to-publish post drafts.
   */
  async scanWatchDirectory(params: {
    directoryPath: string;
    includePreview?: boolean;
    maxPhotos?: number;
  }): Promise<WatchDirectoryReport> {
    const { directoryPath, includePreview = true, maxPhotos = 50 } = params;

    let stat;
    try {
      stat = await fs.stat(directoryPath);
    } catch {
      throw new Error(`Target path "${directoryPath}" does not exist or is not accessible.`);
    }

    if (!stat.isDirectory()) {
      throw new Error(`Target path "${directoryPath}" is not a directory.`);
    }

    const entries = await fs.readdir(directoryPath);
    const validExtensions = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".tif"];

    const imageFiles = entries
      .filter(f => validExtensions.includes(path.extname(f).toLowerCase()))
      .slice(0, maxPhotos);

    const drafts: WatchedPhotoDraft[] = [];

    for (const f of imageFiles) {
      const fullPath = path.join(directoryPath, f);
      try {
        const inspection = await inspectImage(fullPath, { preview: includePreview });

        const cameraInfo = [
          inspection.exif.Make,
          inspection.exif.Model,
          inspection.exif.LensModel
        ].filter(Boolean).join(" ");

        const tagSuggestion = suggestTags({
          caption: f.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
          cameraInfo
        });

        drafts.push({
          filePath: fullPath,
          fileName: f,
          inspection,
          suggestedTags: tagSuggestion.suggestedTags,
          cameraSummary: cameraInfo || "Unknown Camera",
          readyToPublish: inspection.supportedFormat
        });
      } catch {
        // Skip unreadable files
      }
    }

    return {
      directoryPath,
      totalImagesFound: drafts.length,
      drafts,
      message: `Scanned watch directory "${directoryPath}". Found ${drafts.length} photo export(s) ready for review.`
    };
  }
}
