import fs from "node:fs/promises";
import path from "node:path";
import { FotoClient } from "../foto-client.js";

export interface VaultPostRecord {
  postId: string;
  type: string;
  title?: string;
  caption: string;
  tags: string[];
  imageUrl: string;
  imageDimensions: { width: number; height: number };
  likesCount: number;
  commentCount: number;
  timeStamp?: string;
  localPhotoPaths: string[];
  metadataFilePath: string;
  exif: Record<string, any>;
}

export interface VaultManifest {
  exportDate: string;
  userId: string;
  username?: string;
  displayName?: string;
  totalPosts: number;
  totalPhotos: number;
  tagsBreakdown: Record<string, number>;
  posts: VaultPostRecord[];
}

export interface VaultExportResult {
  success: boolean;
  dryRun: boolean;
  backupDirectory: string;
  totalPosts: number;
  totalPhotosDownloaded: number;
  manifest?: VaultManifest;
  message: string;
}

export class VaultExporter {
  constructor(private client: FotoClient) {}

  /**
   * Exports full archive of photographer's published posts, normalized images,
   * camera EXIF metadata sidecars, and manifest index.
   */
  async exportVault(params: {
    targetDirectory: string;
    dryRun?: boolean;
    limit?: number;
  }): Promise<VaultExportResult> {
    const { targetDirectory, dryRun = false, limit } = params;

    if (!targetDirectory || typeof targetDirectory !== "string" || !targetDirectory.trim()) {
      throw new Error("Target destination directory is required.");
    }

    // 1. Fetch user profile and post IDs
    const profile = await this.client.getUserProfile();
    const userId = profile.userId;
    const postIds: string[] = Array.isArray(profile.postIds) ? profile.postIds : [];

    const selectedPostIds = limit ? postIds.slice(0, limit) : postIds;

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        backupDirectory: targetDirectory,
        totalPosts: selectedPostIds.length,
        totalPhotosDownloaded: selectedPostIds.length,
        message: `[DRY RUN] Vault backup preview: ${selectedPostIds.length} posts found ready for backup to "${targetDirectory}". No files downloaded.`
      };
    }

    // Prepare directories
    const photosDir = path.join(targetDirectory, "photos");
    const metadataDir = path.join(targetDirectory, "metadata");
    await fs.mkdir(photosDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });

    const posts: VaultPostRecord[] = [];
    const tagsBreakdown: Record<string, number> = {};
    let totalPhotosDownloaded = 0;

    for (const pid of selectedPostIds) {
      try {
        const postDetail = await this.client.getPost(pid);
        const tags: string[] = Array.isArray(postDetail.tags) ? postDetail.tags : [];
        for (const t of tags) {
          tagsBreakdown[t] = (tagsBreakdown[t] || 0) + 1;
        }

        const localPhotoPaths: string[] = [];

        // Download primary cover/image
        if (postDetail.imageUrl) {
          const primaryFileName = `${pid}.jpg`;
          const primaryFilePath = path.join(photosDir, primaryFileName);
          await this.downloadImage(postDetail.imageUrl, primaryFilePath);
          localPhotoPaths.push(path.relative(targetDirectory, primaryFilePath));
          totalPhotosDownloaded++;
        }

        // If series or portfolio, download remaining images
        if (Array.isArray(postDetail.images)) {
          for (let i = 0; i < postDetail.images.length; i++) {
            const img = postDetail.images[i];
            const imgUrl = img.imageUrl || img.downloadUrl;
            if (imgUrl && imgUrl !== postDetail.imageUrl) {
              const subFileName = `${pid}_slide_${i + 1}.jpg`;
              const subFilePath = path.join(photosDir, subFileName);
              await this.downloadImage(imgUrl, subFilePath);
              localPhotoPaths.push(path.relative(targetDirectory, subFilePath));
              totalPhotosDownloaded++;
            }
          }
        }

        // Write metadata sidecar JSON
        const metadataFileName = `${pid}.json`;
        const metadataFilePath = path.join(metadataDir, metadataFileName);
        const likesCount = typeof postDetail.likesCount === "number"
          ? postDetail.likesCount
          : Array.isArray(postDetail.likes)
            ? postDetail.likes.length
            : 0;

        const metadataPayload = {
          postId: postDetail.postId,
          userId: postDetail.userId,
          type: postDetail.type || "post",
          title: postDetail.title || null,
          caption: postDetail.description || "",
          tags,
          likesCount,
          commentCount: postDetail.commentCount || 0,
          timeStamp: postDetail.timeStamp,
          exif: postDetail.exif || {},
          imageDimensions: {
            width: postDetail.imageWidth || 0,
            height: postDetail.imageHeight || 0
          },
          downloadedFiles: localPhotoPaths
        };

        await fs.writeFile(metadataFilePath, JSON.stringify(metadataPayload, null, 2), "utf-8");

        posts.push({
          postId: pid,
          type: postDetail.type || "post",
          title: postDetail.title,
          caption: postDetail.description || "",
          tags,
          imageUrl: postDetail.imageUrl,
          imageDimensions: {
            width: postDetail.imageWidth || 0,
            height: postDetail.imageHeight || 0
          },
          likesCount,
          commentCount: postDetail.commentCount || 0,
          timeStamp: postDetail.timeStamp,
          localPhotoPaths,
          metadataFilePath: path.relative(targetDirectory, metadataFilePath),
          exif: postDetail.exif || {}
        });
      } catch (err) {
        // Continue backing up remaining posts
      }
    }

    // Write root manifest.json
    const manifest: VaultManifest = {
      exportDate: new Date().toISOString(),
      userId,
      username: profile.username,
      displayName: profile.displayName,
      totalPosts: posts.length,
      totalPhotos: totalPhotosDownloaded,
      tagsBreakdown,
      posts
    };

    const manifestPath = path.join(targetDirectory, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    return {
      success: true,
      dryRun: false,
      backupDirectory: targetDirectory,
      totalPosts: posts.length,
      totalPhotosDownloaded,
      manifest,
      message: `Successfully exported Foto vault backup to "${targetDirectory}". ${posts.length} posts and ${totalPhotosDownloaded} photos archived.`
    };
  }

  private async downloadImage(url: string, destPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download image from ${url}: ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(arrayBuffer));
  }
}
