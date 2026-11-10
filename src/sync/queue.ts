import fs from "node:fs/promises";
import crypto from "node:crypto";
import { CONFIG_PATHS, PLATFORM_LIMITS } from "../config.js";
import { validateTags } from "../tags.js";
import { inspectImage } from "../media/processor.js";
import { getActiveProfileName } from "../api/auth.js";
import type { FotoClient } from "../foto-client.js";

export interface QueuedDraftItem {
  draftId: string;
  type: "post" | "series";
  profileName: string;
  filePaths: string[];
  caption: string;
  tags: string[];
  exifSummary?: Record<string, any>;
  status: "PENDING" | "PUBLISHED" | "FAILED";
  createdAt: string;
  publishedAt?: string;
  publishedPostId?: string;
  errorMessage?: string;
}

interface DraftQueueStore {
  version: number;
  drafts: QueuedDraftItem[];
}

export class OfflineDraftQueue {
  constructor(private client: FotoClient) {}

  private async readStore(): Promise<DraftQueueStore> {
    try {
      const raw = await fs.readFile(CONFIG_PATHS.draftQueueFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.drafts)) {
        return parsed as DraftQueueStore;
      }
    } catch {
      // File does not exist yet
    }
    return { version: 1, drafts: [] };
  }

  private async writeStore(store: DraftQueueStore): Promise<void> {
    await fs.mkdir(CONFIG_PATHS.configDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      CONFIG_PATHS.draftQueueFile,
      JSON.stringify(store, null, 2),
      { encoding: "utf-8", mode: 0o600 }
    );
  }

  /**
   * Validates and stages a single post or series into the persistent local offline draft queue.
   */
  async enqueueDraft(params: {
    filePath?: string;
    filePaths?: string[];
    caption: string;
    tags: string[];
    profileName?: string;
  }): Promise<QueuedDraftItem> {
    const paths = params.filePaths && params.filePaths.length > 0
      ? params.filePaths
      : params.filePath
      ? [params.filePath]
      : [];

    if (paths.length === 0) {
      throw new Error("At least one image filePath or filePaths array is required to queue a draft.");
    }

    if (paths.length > PLATFORM_LIMITS.maxSeriesImages) {
      throw new Error(`Foto allows at most ${PLATFORM_LIMITS.maxSeriesImages} photos in a series.`);
    }

    const tagVal = validateTags(params.tags);
    if (!tagVal.valid) {
      throw new Error(`Tag validation failed: ${tagVal.error}`);
    }

    // Inspect each image locally to ensure files exist and are supported still photography formats
    let primaryExif: Record<string, any> | undefined;
    for (let i = 0; i < paths.length; i++) {
      const inspection = await inspectImage(paths[i], { preview: false });
      if (!inspection.supportedFormat) {
        throw new Error(inspection.warning || `Unsupported image format for "${paths[i]}".`);
      }
      if (i === 0) {
        primaryExif = inspection.exif;
      }
    }

    const item: QueuedDraftItem = {
      draftId: `draft_${crypto.randomUUID().slice(0, 8)}`,
      type: paths.length > 1 ? "series" : "post",
      profileName: (params.profileName || getActiveProfileName() || "default").trim(),
      filePaths: paths,
      caption: params.caption.trim(),
      tags: tagVal.canonicalTags,
      exifSummary: primaryExif,
      status: "PENDING",
      createdAt: new Date().toISOString()
    };

    const store = await this.readStore();
    store.drafts.push(item);
    await this.writeStore(store);

    return item;
  }

  /**
   * Lists drafts stored in the local offline queue, optionally filtered by status or profileName.
   */
  async listDrafts(params?: {
    status?: "PENDING" | "PUBLISHED" | "FAILED";
    profileName?: string;
  }): Promise<{
    totalCount: number;
    pendingCount: number;
    publishedCount: number;
    failedCount: number;
    drafts: QueuedDraftItem[];
  }> {
    const store = await this.readStore();
    let filtered = store.drafts;

    if (params?.status) {
      filtered = filtered.filter(d => d.status === params.status);
    }
    if (params?.profileName) {
      filtered = filtered.filter(d => d.profileName === params.profileName);
    }

    return {
      totalCount: store.drafts.length,
      pendingCount: store.drafts.filter(d => d.status === "PENDING").length,
      publishedCount: store.drafts.filter(d => d.status === "PUBLISHED").length,
      failedCount: store.drafts.filter(d => d.status === "FAILED").length,
      drafts: filtered
    };
  }

  /**
   * Removes a specific draft by draftId or clears all PUBLISHED drafts.
   */
  async removeDraft(params: {
    draftId?: string;
    clearPublished?: boolean;
    clearAll?: boolean;
  }): Promise<{
    removedCount: number;
    remainingCount: number;
    message: string;
  }> {
    const store = await this.readStore();
    const initialCount = store.drafts.length;

    if (params.clearAll) {
      store.drafts = [];
    } else if (params.clearPublished) {
      store.drafts = store.drafts.filter(d => d.status !== "PUBLISHED");
    } else if (params.draftId) {
      store.drafts = store.drafts.filter(d => d.draftId !== params.draftId);
    } else {
      throw new Error("Please specify draftId, clearPublished=true, or clearAll=true.");
    }

    const removedCount = initialCount - store.drafts.length;
    await this.writeStore(store);

    return {
      removedCount,
      remainingCount: store.drafts.length,
      message: `Removed ${removedCount} draft(s) from offline queue (${store.drafts.length} remaining).`
    };
  }

  /**
   * Batch-publishes pending offline drafts upon network reconnection.
   */
  async publishQueuedDrafts(params?: {
    draftId?: string;
    maxDrafts?: number;
    dryRun?: boolean;
  }): Promise<{
    dryRun: boolean;
    processedCount: number;
    publishedCount: number;
    failedCount: number;
    results: Array<{
      draftId: string;
      type: "post" | "series";
      status: "PUBLISHED" | "FAILED" | "DRY_RUN_VALIDATED";
      postId?: string;
      errorMessage?: string;
    }>;
  }> {
    const dryRun = params?.dryRun ?? false;
    const maxDrafts = params?.maxDrafts ?? 20;
    const store = await this.readStore();

    let candidates = store.drafts.filter(d => d.status === "PENDING" || d.status === "FAILED");
    if (params?.draftId) {
      candidates = store.drafts.filter(d => d.draftId === params.draftId);
    }
    candidates = candidates.slice(0, maxDrafts);

    const results: Array<{
      draftId: string;
      type: "post" | "series";
      status: "PUBLISHED" | "FAILED" | "DRY_RUN_VALIDATED";
      postId?: string;
      errorMessage?: string;
    }> = [];

    let publishedCount = 0;
    let failedCount = 0;

    for (const draft of candidates) {
      try {
        if (draft.type === "series") {
          const res = await this.client.publishSeries({
            filePaths: draft.filePaths,
            caption: draft.caption,
            tags: draft.tags,
            dryRun
          });
          if (!dryRun) {
            draft.status = "PUBLISHED";
            draft.publishedAt = new Date().toISOString();
            draft.publishedPostId = res.postId;
            draft.errorMessage = undefined;
          }
          publishedCount++;
          results.push({
            draftId: draft.draftId,
            type: draft.type,
            status: dryRun ? "DRY_RUN_VALIDATED" : "PUBLISHED",
            postId: res.postId
          });
        } else {
          const res = await this.client.publishPost({
            filePath: draft.filePaths[0],
            caption: draft.caption,
            tags: draft.tags,
            dryRun
          });
          if (!dryRun) {
            draft.status = "PUBLISHED";
            draft.publishedAt = new Date().toISOString();
            draft.publishedPostId = res.postId;
            draft.errorMessage = undefined;
          }
          publishedCount++;
          results.push({
            draftId: draft.draftId,
            type: draft.type,
            status: dryRun ? "DRY_RUN_VALIDATED" : "PUBLISHED",
            postId: res.postId
          });
        }
      } catch (err: any) {
        failedCount++;
        if (!dryRun) {
          draft.status = "FAILED";
          draft.errorMessage = err.message;
        }
        results.push({
          draftId: draft.draftId,
          type: draft.type,
          status: "FAILED",
          errorMessage: err.message
        });
      }
    }

    if (!dryRun) {
      await this.writeStore(store);
    }

    return {
      dryRun,
      processedCount: candidates.length,
      publishedCount,
      failedCount,
      results
    };
  }
}
