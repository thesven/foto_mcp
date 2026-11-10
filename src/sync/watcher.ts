import fs from "node:fs/promises";
import path from "node:path";
import { FotoClient } from "../foto-client.js";
import { inspectImage, ImageInspection } from "../media/processor.js";
import { XmpMetadata } from "../media/xmp.js";
import { suggestTags } from "../tags.js";

export interface WatchedPhotoDraft {
  filePath: string;
  fileName: string;
  inspection: ImageInspection;
  xmp?: XmpMetadata;
  suggestedCaption?: string;
  suggestedTags: string[];
  cameraSummary: string;
  readyToPublish: boolean;
}

export interface WatchDirectoryReport {
  directoryPath: string;
  totalImagesFound: number;
  filteredOutByXmp: number;
  drafts: WatchedPhotoDraft[];
  message: string;
}

export class WatchFolderService {
  constructor(private client: FotoClient) {}

  /**
   * Scans a desktop export folder (e.g. from Lightroom, Capture One, Darktable),
   * auto-inspects new photography exports, merges .xmp sidecars, filters by optional
   * star rating (minRating) or color label (colorLabel), extracts technical EXIF,
   * strips GPS, generates color-corrected previews, and formats ready-to-publish post drafts.
   */
  async scanWatchDirectory(params: {
    directoryPath: string;
    includePreview?: boolean;
    maxPhotos?: number;
    minRating?: number;
    colorLabel?: string;
  }): Promise<WatchDirectoryReport> {
    const {
      directoryPath,
      includePreview = true,
      maxPhotos = 50,
      minRating,
      colorLabel
    } = params;

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
    let filteredOutByXmp = 0;

    for (const f of imageFiles) {
      const fullPath = path.join(directoryPath, f);
      try {
        const inspection = await inspectImage(fullPath, { preview: includePreview });
        const xmp = inspection.xmp;

        // Filter by XMP star rating if requested
        if (minRating !== undefined && minRating > 0) {
          const rating = xmp?.rating ?? 0;
          if (rating < minRating) {
            filteredOutByXmp++;
            continue;
          }
        }

        // Filter by XMP color label if requested
        if (colorLabel && colorLabel.trim() !== "") {
          const label = (xmp?.colorLabel || "").toLowerCase();
          if (label !== colorLabel.trim().toLowerCase()) {
            filteredOutByXmp++;
            continue;
          }
        }

        const cameraInfo = [
          inspection.exif.Make,
          inspection.exif.Model,
          inspection.exif.LensModel,
          inspection.exif.FilmSimulation,
          inspection.exif.FilmStock
        ].filter(Boolean).join(" ");

        const suggestedCaption = [xmp?.title, xmp?.description]
          .filter(Boolean)
          .join(" — ") || undefined;

        const tagSuggestion = suggestTags({
          caption: suggestedCaption || f.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
          cameraInfo,
          keywords: xmp?.keywords
        });

        drafts.push({
          filePath: fullPath,
          fileName: f,
          inspection,
          xmp,
          suggestedCaption,
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
      filteredOutByXmp,
      drafts,
      message: `Scanned watch directory "${directoryPath}". Found ${drafts.length} photo export(s) ready for review (${filteredOutByXmp} filtered out by XMP criteria).`
    };
  }
}
