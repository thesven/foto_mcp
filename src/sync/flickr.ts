import fs from "node:fs/promises";
import path from "node:path";
import { FotoClient, PublishResult } from "../foto-client.js";
import { suggestTags, validateTags } from "../tags.js";
import { inspectImage, prepareImageForUpload, ImageInspection } from "../media/processor.js";

export interface ParsedFlickrPhoto {
  id: string;
  name: string;
  description: string;
  dateTaken?: string;
  tags: string[];
  albums?: string[];
  fileName?: string;
  filePath?: string;
  privacy?: string;
}

export interface FlickrSyncCandidate {
  photo: ParsedFlickrPhoto;
  resolvedImagePath?: string;
  isAlreadyPublished: boolean;
  duplicateReason?: string;
  suggestedTags: string[];
  tagExplanation: string;
  imageInspection?: ImageInspection;
  uploadDimensions?: { width: number; height: number };
  status: "READY" | "ALREADY_PUBLISHED" | "IMAGE_NOT_FOUND" | "INVALID_TAGS";
  publishResult?: PublishResult;
}

export interface FlickrSyncReport {
  dryRun: boolean;
  totalParsed: number;
  readyToPublish: number;
  alreadyPublishedCount: number;
  candidates: FlickrSyncCandidate[];
}

/**
 * Normalizes Flickr photo description, stripping HTML tags while preserving text
 */
function cleanFlickrDescription(desc: string): string {
  if (!desc) return "";
  return desc
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export class FlickrSyncTool {
  constructor(private client: FotoClient) {}

  /**
   * Parses Flickr export data from JSON file or directory containing photo JSONs
   */
  async parseFlickrExport(inputPath: string): Promise<ParsedFlickrPhoto[]> {
    const stat = await fs.stat(inputPath);
    const photos: ParsedFlickrPhoto[] = [];

    if (stat.isDirectory()) {
      const files = await fs.readdir(inputPath);
      const jsonFiles = files.filter(f => f.endsWith(".json"));

      for (const jf of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(inputPath, jf), "utf-8");
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const photo = this.normalizeFlickrPhotoJson(item);
              if (photo) photos.push(photo);
            }
          } else if (parsed && typeof parsed === "object") {
            const photo = this.normalizeFlickrPhotoJson(parsed);
            if (photo) photos.push(photo);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    } else {
      const content = await fs.readFile(inputPath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const photo = this.normalizeFlickrPhotoJson(item);
          if (photo) photos.push(photo);
        }
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.photos)) {
          for (const item of parsed.photos) {
            const photo = this.normalizeFlickrPhotoJson(item);
            if (photo) photos.push(photo);
          }
        } else {
          const photo = this.normalizeFlickrPhotoJson(parsed);
          if (photo) photos.push(photo);
        }
      }
    }

    return photos;
  }

  private normalizeFlickrPhotoJson(item: any): ParsedFlickrPhoto | null {
    if (!item || typeof item !== "object") return null;

    const id = String(item.id || item.photo_id || "");
    const name = String(item.name || item.title || "");
    const description = cleanFlickrDescription(String(item.description || item.desc || ""));
    const dateTaken = item.date_taken || item.dateTaken || item.date;

    let tags: string[] = [];
    if (Array.isArray(item.tags)) {
      tags = item.tags.map((t: any) => (typeof t === "string" ? t : t.tag || t.raw || "")).filter(Boolean);
    } else if (typeof item.tags === "string") {
      tags = item.tags.split(/\s+/).filter(Boolean);
    }

    let albums: string[] = [];
    if (Array.isArray(item.albums)) {
      albums = item.albums.map((a: any) => (typeof a === "string" ? a : a.title || ""));
    }

    const fileName = item.file || item.fileName || (id ? `${id}.jpg` : undefined);

    return {
      id,
      name,
      description,
      dateTaken: dateTaken ? String(dateTaken) : undefined,
      tags,
      albums,
      fileName,
      privacy: item.privacy || "public"
    };
  }

  /**
   * Resolves the local image file corresponding to a parsed Flickr photo record
   */
  async resolveImageFile(mediaDir: string, photo: ParsedFlickrPhoto): Promise<string | undefined> {
    const candidates: string[] = [];

    if (photo.fileName) {
      candidates.push(path.join(mediaDir, photo.fileName));
    }
    if (photo.id) {
      candidates.push(path.join(mediaDir, `${photo.id}.jpg`));
      candidates.push(path.join(mediaDir, `${photo.id}.png`));
      candidates.push(path.join(mediaDir, `${photo.id}_o.jpg`));
      candidates.push(path.join(mediaDir, `${photo.id}_b.jpg`));
    }
    if (photo.name) {
      candidates.push(path.join(mediaDir, `${photo.name}.jpg`));
    }

    for (const c of candidates) {
      try {
        const s = await fs.stat(c);
        if (s.isFile()) return c;
      } catch {
        // Try next
      }
    }

    // Fallback: search directory for files starting with photo.id
    if (photo.id) {
      try {
        const files = await fs.readdir(mediaDir);
        const match = files.find(f => f.startsWith(photo.id));
        if (match) return path.join(mediaDir, match);
      } catch {
        // ignore
      }
    }

    return undefined;
  }

  /**
   * Syncs photos from Flickr export into Foto
   */
  async sync(params: {
    exportPath: string;
    mediaDir?: string;
    maxPhotos?: number;
    dryRun?: boolean;
    defaultTags?: string[];
  }): Promise<FlickrSyncReport> {
    const { exportPath, maxPhotos = 20, dryRun = true, defaultTags = [] } = params;
    const isDir = (await fs.stat(exportPath)).isDirectory();
    const mediaDir = params.mediaDir || (isDir ? exportPath : path.dirname(exportPath));

    const parsedPhotos = await this.parseFlickrExport(exportPath);
    const toProcess = parsedPhotos.slice(0, maxPhotos);

    // Fetch existing user posts to prevent duplicate republishing
    let publishedCaptions: string[] = [];
    try {
      const userProfile = await this.client.getUserProfile();
      if (Array.isArray(userProfile.posts)) {
        publishedCaptions = userProfile.posts.map(p => (p.description || "").trim().toLowerCase());
      }
    } catch {
      // Offline / not authenticated during dryRun
    }

    const candidates: FlickrSyncCandidate[] = [];

    for (const photo of toProcess) {
      const resolvedPath = await this.resolveImageFile(mediaDir, photo);

      // Construct caption
      const captionParts = [photo.name, photo.description].filter(Boolean);
      const fullCaption = captionParts.join("\n\n").trim();

      // Check duplicates
      const isDuplicate = publishedCaptions.some(
        c => c.length > 5 && (c === fullCaption.toLowerCase() || (photo.name && c.includes(photo.name.toLowerCase())))
      );

      // Suggest tags
      const tagSuggestion = suggestTags({
        caption: fullCaption,
        cameraInfo: photo.tags.join(" "),
        keywords: [...photo.tags, ...(photo.albums || [])]
      });

      const chosenTags = defaultTags.length > 0
        ? defaultTags.slice(0, 3)
        : tagSuggestion.suggestedTags;

      let inspection: ImageInspection | undefined;
      let status: FlickrSyncCandidate["status"] = "READY";
      let duplicateReason: string | undefined;

      if (isDuplicate) {
        status = "ALREADY_PUBLISHED";
        duplicateReason = "A post with matching caption/title was already published on your Foto account.";
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
            caption: fullCaption || photo.name || "Flickr archive import",
            tags: chosenTags,
            dryRun: false
          });
        } catch (err: any) {
          status = "INVALID_TAGS";
          duplicateReason = err.message;
        }
      }

      candidates.push({
        photo,
        resolvedImagePath: resolvedPath,
        isAlreadyPublished: isDuplicate,
        duplicateReason,
        suggestedTags: chosenTags,
        tagExplanation: tagSuggestion.explanation,
        imageInspection: inspection,
        uploadDimensions: inspection?.targetUploadDimensions,
        status,
        publishResult
      });
    }

    return {
      dryRun,
      totalParsed: parsedPhotos.length,
      readyToPublish: candidates.filter(c => c.status === "READY").length,
      alreadyPublishedCount: candidates.filter(c => c.status === "ALREADY_PUBLISHED").length,
      candidates
    };
  }
}
