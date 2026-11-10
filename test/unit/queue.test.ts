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

    // 6. Remove single draft by ID
    const removed = await queue.removeDraft({ draftId: singleDraft.draftId });
    assert.strictEqual(removed.removedCount, 1);
    assert.strictEqual(removed.remainingCount, 1);

    // 7. Clear all
    const cleared = await queue.removeDraft({ clearAll: true });
    assert.strictEqual(cleared.remainingCount, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Offline Draft Queue unit tests passed");
}
