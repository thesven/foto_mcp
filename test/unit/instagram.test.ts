import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { parseInstagramPostsHtml, InstagramSyncTool } from "../../src/sync/instagram.js";
import { FotoClient } from "../../src/foto-client.js";

export async function runInstagramTests() {
  console.log("--- Testing Instagram Sync module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-ig-"));

  try {
    // 1. parseInstagramPostsHtml entity unescaping & multi-line structure
    const sampleHtml = `
      <div class="uiBoxWhite">
        <h2>Sea Otter floating in Monterey Bay&#039;s calm water.&#10;&#10;📷 400mm · f/4 · 1/1600s · ISO 800&#10;&#10;📌 Pacific Grove, CA&#10;&#10;#otter #wildlife #pacific #nature</h2>
        <img src="media/posts/otter.jpg" />
        <div>Latitude</div><div><div class="_a6-q">36.62</div></div>
        <div>Longitude</div><div><div class="_a6-q">-121.91</div></div>
        <div class="_3-94 _a6-o">Oct 14, 2026 3:30pm</div></div>
      </div>
      <div class="uiBoxWhite">
        <h2>Squirrel snacking on pinecone&#10;&#10;#squirrel</h2>
        <img src="media/posts/squirrel.jpg" />
        <div class="_3-94 _a6-o">Oct 15, 2026 10:00am</div></div>
      </div>
    `;

    const parsed = parseInstagramPostsHtml(sampleHtml);
    assert.strictEqual(parsed.length, 2);

    const otter = parsed[0];
    assert.strictEqual(otter.title, "Sea Otter floating in Monterey Bay's calm water.");
    assert.strictEqual(otter.cameraInfo, "📷 400mm · f/4 · 1/1600s · ISO 800");
    assert.strictEqual(otter.location, "📌 Pacific Grove, CA");
    assert.deepStrictEqual(otter.hashtags, ["otter", "wildlife", "pacific", "nature"]);
    assert.strictEqual(otter.imageFileName, "otter.jpg");
    assert.strictEqual(otter.gpsDetected?.lat, 36.62);
    assert.strictEqual(otter.gpsDetected?.lng, -121.91);
    assert(!otter.cleanedCaption.includes("#otter"));

    // 2. InstagramSyncTool error when no content or file
    const syncTool = new InstagramSyncTool(new FotoClient());
    await assert.rejects(
      async () => {
        await syncTool.runSync({});
      },
      /No Instagram HTML content or file path provided/
    );

    // 3. InstagramSyncTool dry-run with local image resolution & deduplication
    const localImgPath = path.join(tempDir, "otter.jpg");
    await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 60, g: 80, b: 100 } } }).jpeg().toFile(localImgPath);

    const htmlFile = path.join(tempDir, "posts_1.html");
    await fs.writeFile(htmlFile, sampleHtml, "utf-8");

    const report = await syncTool.runSync({
      htmlFilePath: htmlFile,
      mediaDir: tempDir,
      maxPosts: 5,
      dryRun: true,
      existingFotoCaptions: ["Sea Otter floating"] // simulate duplicate
    });

    assert.strictEqual(report.dryRun, true);
    assert.strictEqual(report.totalParsed, 2);
    assert.strictEqual(report.alreadyPublishedCount, 1); // Otter is duplicate
    assert.strictEqual(report.candidates[0].status, "ALREADY_PUBLISHED");
    assert.strictEqual(report.candidates[0].isAlreadyPublished, true);

    // Squirrel is not duplicate, but image not found in mediaDir
    assert.strictEqual(report.candidates[1].status, "IMAGE_NOT_FOUND");
    assert(report.candidates[1].suggestedTags.length >= 1);

    // 4. InstagramSyncTool live publish (dryRun = false)
    const mockClient: any = {
      publishPost: async (params: any) => {
        return {
          success: true,
          postId: "published-ig-post",
          caption: params.caption,
          tags: params.tags
        };
      }
    };
    const liveSyncTool = new InstagramSyncTool(mockClient);

    const singlePostHtml = `
      <div class="uiBoxWhite">
        <h2>White-tailed Deer in morning light&#10;&#10;#deer #wildlife</h2>
        <img src="media/posts/otter.jpg" />
        <div class="_3-94 _a6-o">Nov 9, 2026 8:00am</div></div>
      </div>
    `;

    const liveReport = await liveSyncTool.runSync({
      htmlContent: singlePostHtml,
      mediaDir: tempDir,
      dryRun: false
    });

    assert.strictEqual(liveReport.dryRun, false);
    assert.strictEqual(liveReport.readyToPublish, 1);
    assert.strictEqual(liveReport.candidates[0].status, "READY");
    assert.strictEqual(liveReport.candidates[0].publishResult?.postId, "published-ig-post");

    // 5. InstagramSyncTool live publish failure handling
    const failingClient: any = {
      publishPost: async () => {
        throw new Error("Simulated upload failure");
      }
    };
    const failSyncTool = new InstagramSyncTool(failingClient);
    const failReport = await failSyncTool.runSync({
      htmlContent: singlePostHtml,
      mediaDir: tempDir,
      dryRun: false
    });
    assert.strictEqual(failReport.candidates[0].publishResult, undefined);

  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Instagram unit tests passed");
}
