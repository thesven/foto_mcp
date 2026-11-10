import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { FotoClient } from "../../src/foto-client.js";
import { OfflineDraftQueue } from "../../src/sync/queue.js";

export async function runQueueTests() {
  console.log("--- Testing Offline Draft Queue module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-queue-test-"));
  const client = new FotoClient();
  const queue = new OfflineDraftQueue(client);

  try {
    const img1 = path.join(tempDir, "frame1.jpg");
    const img2 = path.join(tempDir, "frame2.jpg");
    await sharp({ create: { width: 1000, height: 800, channels: 3, background: { r: 40, g: 50, b: 60 } } })
      .jpeg()
      .toFile(img1);
    await sharp({ create: { width: 1000, height: 800, channels: 3, background: { r: 70, g: 80, b: 90 } } })
      .jpeg()
      .toFile(img2);

    // Clear queue first
    await queue.removeDraft({ clearAll: true });

    // 1. Enqueue single post draft
    const singleDraft = await queue.enqueueDraft({
      filePath: img1,
      caption: "Offline mountain cabin shot",
      tags: ["Landscape", "Mountains"],
      profileName: "field_work"
    });
    assert.strictEqual(singleDraft.type, "post");
    assert.strictEqual(singleDraft.status, "PENDING");
    assert.strictEqual(singleDraft.profileName, "field_work");

    // 2. Enqueue series draft
    const seriesDraft = await queue.enqueueDraft({
      filePaths: [img1, img2],
      caption: "Two-frame diptych in the woods",
      tags: ["Forest", "Analog"]
    });
    assert.strictEqual(seriesDraft.type, "series");
    assert.strictEqual(seriesDraft.filePaths.length, 2);

    // 3. Reject invalid tags or missing files
    await assert.rejects(
      async () => {
        await queue.enqueueDraft({
          filePath: img1,
          caption: "Bad tag",
          tags: ["NotAllowedTag"]
        });
      },
      /Tag validation failed/
    );

    await assert.rejects(
      async () => {
        await queue.enqueueDraft({
          caption: "No files",
          tags: ["Street"]
        });
      },
      /At least one image/
    );

    // 4. List drafts
    const listed = await queue.listDrafts();
    assert.strictEqual(listed.totalCount, 2);
    assert.strictEqual(listed.pendingCount, 2);

    const filteredProfile = await queue.listDrafts({ profileName: "field_work" });
    assert.strictEqual(filteredProfile.drafts.length, 1);

    // 5. Dry-run publish queued drafts
    const pubDry = await queue.publishQueuedDrafts({ dryRun: true });
    assert.strictEqual(pubDry.dryRun, true);
    assert.strictEqual(pubDry.processedCount, 2);
    assert.strictEqual(pubDry.publishedCount, 2);
    assert.strictEqual(pubDry.results[0].status, "DRY_RUN_VALIDATED");

    // 5b. Live publish queued drafts with mocked client
    const origPublishPost = client.publishPost;
    const origPublishSeries = client.publishSeries;
    try {
      client.publishPost = async () => ({ postId: "post_live_123" } as any);
      client.publishSeries = async () => ({ postId: "series_live_456" } as any);

      const pubLive = await queue.publishQueuedDrafts({ dryRun: false });
      assert.strictEqual(pubLive.publishedCount, 2);
      assert.strictEqual(pubLive.results[0].status, "PUBLISHED");
      assert.strictEqual(pubLive.results[0].postId, "post_live_123");

      // Verify clearPublished removes them
      const clearPub = await queue.removeDraft({ clearPublished: true });
      assert.strictEqual(clearPub.removedCount, 2);
      assert.strictEqual(clearPub.remainingCount, 0);

      // 5c. Test failed publish handling
      const failDraft = await queue.enqueueDraft({
        filePath: img1,
        caption: "Will fail",
        tags: ["Street"]
      });
      client.publishPost = async () => { throw new Error("Simulated network outage"); };
      const failPub = await queue.publishQueuedDrafts({ draftId: failDraft.draftId, dryRun: false });
      assert.strictEqual(failPub.failedCount, 1);
      assert.strictEqual(failPub.results[0].status, "FAILED");
      assert(failPub.results[0].errorMessage?.includes("Simulated network outage"));

      const failListed = await queue.listDrafts({ status: "FAILED" });
      assert.strictEqual(failListed.failedCount, 1);
    } finally {
      client.publishPost = origPublishPost;
      client.publishSeries = origPublishSeries;
    }

    // 6. Remove single draft by ID
    const extraDraft = await queue.enqueueDraft({
      filePath: img1,
      caption: "To remove",
      tags: ["Street"]
    });
    const removed = await queue.removeDraft({ draftId: extraDraft.draftId });
    assert.strictEqual(removed.removedCount, 1);

    // 7. Clear all
    const cleared = await queue.removeDraft({ clearAll: true });
    assert.strictEqual(cleared.remainingCount, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Offline Draft Queue unit tests passed");
}
