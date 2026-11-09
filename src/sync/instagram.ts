import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { FotoClient, PublishResult } from "../foto-client.js";
import { suggestTags, validateTags } from "../tags.js";
import { inspectImage, prepareImageForUpload, ImageInspection } from "../media/processor.js";

const execAsync = promisify(exec);

export interface ParsedInstagramPost {
  title: string;
  originalCaption: string;
  cleanedCaption: string;
  cameraInfo?: string;
  location?: string;
  hashtags: string[];
  imageRelativePath: string;
  imageFileName: string;
  dateStr?: string;
  gpsDetected?: { lat: number; lng: number };
}

export interface SyncCandidate {
  post: ParsedInstagramPost;
  resolvedImagePath?: string;
  isAlreadyPublished: boolean;
  duplicateReason?: string;
  suggestedTags: string[];
  tagExplanation: string;
  imageInspection?: ImageInspection;
  uploadDimensions?: { width: number; height: number };
  gpsScrubbed: boolean;
  status: "READY" | "ALREADY_PUBLISHED" | "IMAGE_NOT_FOUND" | "INVALID_TAGS";
  publishResult?: PublishResult;
}

export interface SyncReport {
  dryRun: boolean;
  totalParsed: number;
  readyToPublish: number;
  alreadyPublishedCount: number;
  candidates: SyncCandidate[];
}

/**
 * Unescapes standard HTML entities in Instagram export text
 */
function unescapeHtml(text: string): string {
  return text
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#064;/g, "@");
}

/**
 * Parses Instagram posts HTML export (supports both standard and table-based exports)
 */
export function parseInstagramPostsHtml(htmlContent: string): ParsedInstagramPost[] {
  const posts: ParsedInstagramPost[] = [];
  
  // All Instagram HTML exports separate posts with the date block:
  // <div class="_3-94 _a6-o">([A-Za-z0-9, :]+)</div></div>
  const chunks = htmlContent.split(/<div class="_3-94 _a6-o">([A-Za-z0-9, :]+)<\/div><\/div>/);
  
  if (chunks.length > 1) {
    for (let i = 0; i < chunks.length - 1; i += 2) {
      const block = chunks[i];
      const dateStr = chunks[i + 1].trim();

      // Extract image path (first image if carousel)
      const imgMatches = [
        ...block.matchAll(/href="([^"]*\.(jpg|jpeg|png))"/gi),
        ...block.matchAll(/<img[^>]*src="([^"]*\.(jpg|jpeg|png))"/gi)
      ];
      if (imgMatches.length === 0) continue;

      const imageRelativePath = imgMatches[0][1];
      const imageFileName = path.basename(imageRelativePath);

      // Extract caption
      let rawCaption = "";
      // Variant B: table cell
      const tdCaption = block.match(/<td class="_a6_q">Caption<\/td><td class="_2piu _a6_r">([\s\S]*?)<\/td>/);
      if (tdCaption) {
        rawCaption = unescapeHtml(tdCaption[1].trim());
      } else {
        // Variant A: h2
        const h2Match = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
        if (h2Match) {
          const text = unescapeHtml(h2Match[1].trim());
          if (!["Media", "Hashtags", "Place", "Posts"].includes(text)) {
            rawCaption = text;
          }
        }
      }

      if (!rawCaption) {
        const divMatch = block.match(/<\/a><div>([\s\S]*?)<\/div><table/);
        if (divMatch) {
          rawCaption = unescapeHtml(divMatch[1].trim());
        }
      }

      // Extract GPS if recorded
      let gpsDetected: { lat: number; lng: number } | undefined;
      const latMatch = block.match(/Latitude<\/div><div><div class="_a6-q">([0-9.-]+)<\/div>/) ||
                       block.match(/<td class="_a6_q">Latitude<\/td><td class="_2piu _a6_r">([0-9.-]+)<\/td>/);
      const lngMatch = block.match(/Longitude<\/div><div><div class="_a6-q">([0-9.-]+)<\/div>/) ||
                       block.match(/<td class="_a6_q">Longitude<\/td><td class="_2piu _a6_r">([0-9.-]+)<\/td>/);
      if (latMatch && lngMatch) {
        const lat = parseFloat(latMatch[1]);
        const lng = parseFloat(lngMatch[1]);
        if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
          gpsDetected = { lat, lng };
        }
      }

      // Split lines to separate title, camera info, location, hashtags, and narrative
      const lines = rawCaption.split("\n").map((l) => l.trim()).filter(Boolean);
      const title = lines[0] || "Untitled";

      const hashtags: string[] = [];
      const narrativeLines: string[] = [];
      let cameraInfo: string | undefined;
      let location: string | undefined;

      for (const line of lines) {
        if (line.startsWith("#")) {
          const tags = line.split(/\s+/).filter((t) => t.startsWith("#")).map((t) => t.slice(1));
          hashtags.push(...tags);
        } else if (line.startsWith("📷") || line.startsWith("⚙️") || line.startsWith("🌌") || line.toLowerCase().includes("iso ") || line.toLowerCase().includes("f/")) {
          cameraInfo = line;
          narrativeLines.push(line);
        } else if (line.startsWith("📌") || line.startsWith("📍")) {
          location = line;
          narrativeLines.push(line);
        } else {
          narrativeLines.push(line);
        }
      }

      const cleanedCaption = narrativeLines.join("\n\n").trim();

      posts.push({
        title,
        originalCaption: rawCaption,
        cleanedCaption,
        cameraInfo,
        location,
        hashtags,
        imageRelativePath,
        imageFileName,
        dateStr,
        gpsDetected
      });
    }
  }

  return posts;
}

/**
 * Main Instagram Sync Tool with dry-run capabilities
 */
export class InstagramSyncTool {
  private client: FotoClient;

  constructor(client?: FotoClient) {
    this.client = client || new FotoClient();
  }

  /**
   * Run synchronization on Instagram posts
   */
  async runSync(params: {
    htmlContent?: string;
    htmlFilePath?: string;
    mediaDir?: string;
    maxPosts?: number;
    dryRun?: boolean;
    existingFotoCaptions?: string[];
  }): Promise<SyncReport> {
    const {
      htmlContent,
      htmlFilePath,
      mediaDir,
      maxPosts = 10,
      dryRun = true,
      existingFotoCaptions = []
    } = params;

    let content = htmlContent;
    if (!content && htmlFilePath) {
      content = await fs.readFile(htmlFilePath, "utf-8");
    }

    if (!content) {
      throw new Error("No Instagram HTML content or file path provided.");
    }

    const parsedPosts = parseInstagramPostsHtml(content);
    const selectedPosts = parsedPosts.slice(0, maxPosts);

    const candidates: SyncCandidate[] = [];
    let readyCount = 0;
    let alreadyPublishedCount = 0;

    for (const post of selectedPosts) {
      // 1. Deduplication check
      const isDuplicate = existingFotoCaptions.some((existing) => {
        if (!existing) return false;
        const normExisting = existing.toLowerCase().replace(/[^a-z0-9]/g, "");
        const normTitle = post.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        return normExisting.includes(normTitle) || normTitle.includes(normExisting.slice(0, 30));
      });

      if (isDuplicate) {
        alreadyPublishedCount++;
        candidates.push({
          post,
          isAlreadyPublished: true,
          duplicateReason: "Matches an existing Foto post title/caption",
          suggestedTags: [],
          tagExplanation: "Skipped due to duplicate",
          gpsScrubbed: false,
          status: "ALREADY_PUBLISHED"
        });
        continue;
      }

      // 2. Smart Tag Suggestion
      // Look at hashtags + species name + narrative
      const keywords = [...post.hashtags];
      if (post.title.toLowerCase().includes("squirrel")) keywords.push("wildlife", "animals");
      if (post.title.toLowerCase().includes("otter")) keywords.push("wildlife", "animals", "water");
      if (post.title.toLowerCase().includes("deer") || post.title.toLowerCase().includes("moose")) keywords.push("wildlife", "animals");
      if (post.title.toLowerCase().includes("bird") || post.title.toLowerCase().includes("raven") || post.title.toLowerCase().includes("mallard")) keywords.push("birds", "wildlife");

      const suggestion = suggestTags({
        caption: post.cleanedCaption,
        cameraInfo: post.cameraInfo,
        keywords
      });

      let finalTags = suggestion.suggestedTags;
      // Ensure always at least 1 and max 3 tags from whitelist
      if (finalTags.length === 0) {
        finalTags = ["Wildlife", "Nature"];
      }

      // 3. Resolve local media path
      let resolvedImagePath: string | undefined;
      if (mediaDir && post.imageFileName) {
        const potentialPaths = [
          path.join(mediaDir, post.imageFileName),
          path.join(mediaDir, "media", "other", post.imageFileName),
          path.join(mediaDir, "other", post.imageFileName),
          path.join(mediaDir, post.imageRelativePath)
        ];

        for (const p of potentialPaths) {
          try {
            await fs.access(p);
            resolvedImagePath = p;
            break;
          } catch {
            // try next
          }
        }
      }

      // 4. Image inspection & validation
      let inspection: ImageInspection | undefined;
      let gpsScrubbed = false;
      let uploadDimensions: { width: number; height: number } | undefined;

      if (resolvedImagePath) {
        try {
          inspection = await inspectImage(resolvedImagePath);
          uploadDimensions = inspection.targetUploadDimensions;
          gpsScrubbed = inspection.hasGps || !!post.gpsDetected;
        } catch (err) {
          console.error(`Warning: Failed to inspect image ${resolvedImagePath}:`, err);
        }
      }

      const candidate: SyncCandidate = {
        post,
        resolvedImagePath,
        isAlreadyPublished: false,
        suggestedTags: finalTags,
        tagExplanation: suggestion.explanation,
        imageInspection: inspection,
        uploadDimensions,
        gpsScrubbed,
        status: resolvedImagePath ? "READY" : "IMAGE_NOT_FOUND"
      };

      // 5. If not dry run and ready, publish!
      if (!dryRun && candidate.status === "READY" && resolvedImagePath) {
        try {
          const res = await this.client.publishPost({
            filePath: resolvedImagePath,
            caption: post.cleanedCaption,
            tags: finalTags,
            dryRun: false
          });
          candidate.publishResult = res;
        } catch (err: any) {
          console.error(`Failed to publish post "${post.title}":`, err.message);
        }
      }

      if (candidate.status === "READY") {
        readyCount++;
      }
      candidates.push(candidate);
    }

    return {
      dryRun,
      totalParsed: parsedPosts.length,
      readyToPublish: readyCount,
      alreadyPublishedCount,
      candidates
    };
  }
}
