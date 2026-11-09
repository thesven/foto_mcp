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
 * Parses Instagram posts HTML export (e.g., posts_1.html)
 */
export function parseInstagramPostsHtml(htmlContent: string): ParsedInstagramPost[] {
  const posts: ParsedInstagramPost[] = [];
  
  // Each post is contained inside a post container div
  const postRegex = /<div class="[^"]*uiBoxWhite[^"]*">([\s\S]*?)(?=(?:<div class="[^"]*uiBoxWhite)|$)/g;
  let match: RegExpExecArray | null;

  while ((match = postRegex.exec(htmlContent)) !== null) {
    const postHtml = match[1];

    // Extract caption / header in <h2>
    const h2Match = postHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const rawCaption = h2Match ? unescapeHtml(h2Match[1].trim()) : "";

    // Extract image path
    const imgMatch = postHtml.match(/<img src="([^"]+)"/);
    const imageRelativePath = imgMatch ? imgMatch[1] : "";
    const imageFileName = path.basename(imageRelativePath);

    // Extract date
    const dateMatch = postHtml.match(/<div class="[^"]*_a6-o">([^<]+)<\/div>/);
    const dateStr = dateMatch ? dateMatch[1].trim() : undefined;

    // Extract GPS if recorded by Instagram
    let gpsDetected: { lat: number; lng: number } | undefined;
    const latMatch = postHtml.match(/Latitude[\s\S]*?class="[^"]*_a6-q[^"]*">([0-9.-]+)<\/div>/i);
    const lngMatch = postHtml.match(/Longitude[\s\S]*?class="[^"]*_a6-q[^"]*">([0-9.-]+)<\/div>/i);
    if (latMatch && lngMatch) {
      gpsDetected = {
        lat: parseFloat(latMatch[1]),
        lng: parseFloat(lngMatch[1])
      };
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
        // Collect hashtags
        const tags = line.split(/\s+/).filter((t) => t.startsWith("#")).map((t) => t.slice(1));
        hashtags.push(...tags);
      } else if (line.startsWith("📷") || line.toLowerCase().includes("iso ") || line.toLowerCase().includes("f/")) {
        cameraInfo = line;
        narrativeLines.push(line);
      } else if (line.startsWith("📌")) {
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
