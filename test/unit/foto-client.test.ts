import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { FotoClient } from "../../src/foto-client.js";
import { saveCredentials, clearCredentials } from "../../src/api/auth.js";

export async function runFotoClientTests() {
  console.log("--- Testing FotoClient module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-client-"));
  const img1 = path.join(tempDir, "img1.jpg");
  const img2 = path.join(tempDir, "img2.jpg");

  await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 100, g: 120, b: 140 } } }).jpeg().toFile(img1);
  await sharp({ create: { width: 1500, height: 2000, channels: 3, background: { r: 140, g: 120, b: 100 } } }).jpeg().toFile(img2);

  const client = new FotoClient();
  const originalFetch = globalThis.fetch;

  try {
    // 1. inspectPhoto
    const insp = await client.inspectPhoto(img1);
    assert.strictEqual(insp.originalWidth, 2000);

    // 2. draftPost with invalid tags
    const draftInvalid = await client.draftPost({
      filePath: img1,
      caption: "Draft with invalid tags",
      tags: ["NotARealTag"]
    });
    assert.strictEqual(draftInvalid.readyToPublish, false);
    assert(draftInvalid.warnings.some(w => w.includes("Invalid tags")));

    // 3. publishPost - tag validation failure
    await assert.rejects(
      async () => {
        await client.publishPost({
          filePath: img1,
          caption: "Test",
          tags: ["BadTag"]
        });
      },
      /Tag validation failed/
    );

    // 4. publishPost - dryRun = true
    const dryRunResult = await client.publishPost({
      filePath: img1,
      caption: "Dry run post",
      tags: ["Landscape", "Analog"],
      dryRun: true
    });
    assert.strictEqual(dryRunResult.dryRun, true);
    assert.strictEqual(dryRunResult.success, true);
    assert(dryRunResult.message.includes("[DRY RUN]"));

    // 5. publishPost - Live publishing (dryRun = false)
    await saveCredentials({
      userId: "u_client_test",
      email: "client@test.com",
      idToken: "tok_client",
      refreshToken: "ref_client",
      expiresAt: Date.now() + 3600000
    });

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("firebasestorage.googleapis.com")) {
        return new Response(JSON.stringify({ name: "posts/u_client_test/img1_20261109120000", downloadTokens: "tok-abc" }), { status: 200 });
      }
      if (urlStr.includes("api.sightengine.com")) {
        return new Response(JSON.stringify({ status: "success", nudity: { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.01 } }), { status: 200 });
      }
      if (urlStr.includes("firestore.googleapis.com")) {
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const liveResult = await client.publishPost({
      filePath: img1,
      caption: "Live test post",
      tags: ["Landscape"],
      dryRun: false
    });
    assert.strictEqual(liveResult.success, true);
    assert.strictEqual(liveResult.dryRun, false);
    assert.strictEqual(liveResult.userId, "u_client_test");
    assert(liveResult.postUrl?.includes("u_client_test"));

    // 6. publishPost - Live publish fails moderation
    globalThis.fetch = async (url: any) => {
      const urlStr = typeof url === "string" ? url : (url.url || url.href || String(url));
      if (urlStr.includes("sightengine.com")) {
        return new Response(JSON.stringify({ status: "success", nudity: { sexual_activity: 0.99, sexual_display: 0.99, erotica: 0.99 } }), { status: 200 });
      }
      if (urlStr.includes("firebasestorage.googleapis.com")) {
        return new Response(JSON.stringify({ name: "posts/u/img", downloadTokens: "tok" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    let threw = false;
    try {
      const res = await client.publishPost({
        filePath: img1,
        caption: "Live moderation fail",
        tags: ["Landscape"],
        dryRun: false
      });
      console.log("UNEXPECTED SUCCESS RESULT:", res);
    } catch (err: any) {
      console.log("CAUGHT EXPECTED ERROR:", err.message);
      threw = true;
    }
    assert.strictEqual(threw, true, "Must throw on moderation rejection");

    // 7. publishSeries - boundaries and invalid tags
    await assert.rejects(async () => client.publishSeries({ filePaths: [img1], caption: "Only 1", tags: ["Landscape"] }), /at least 2 photos/);
    await assert.rejects(async () => client.publishSeries({ filePaths: [img1, img1, img1, img1, img1, img1], caption: "6", tags: ["Landscape"] }), /maximum of 5 photos/);
    await assert.rejects(async () => client.publishSeries({ filePaths: [img1, img2], caption: "Bad tags", tags: ["InvalidTag"] }), /Tag validation failed/);

    // 8. publishSeries - dryRun = true
    const seriesDryRun = await client.publishSeries({
      filePaths: [img1, img2],
      caption: "Two frames",
      tags: ["Black and White"],
      dryRun: true
    });
    assert.strictEqual(seriesDryRun.dryRun, true);
    assert.strictEqual(seriesDryRun.imageCount, 2);

    // 9. publishSeries - Live series publish
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("firebasestorage.googleapis.com")) {
        return new Response(JSON.stringify({ name: "posts/u/series", downloadTokens: "tok-series" }), { status: 200 });
      }
      if (urlStr.includes("api.sightengine.com")) {
        return new Response(JSON.stringify({ status: "success", nudity: { sexual_activity: 0.01, sexual_display: 0.01 } }), { status: 200 });
      }
      if (urlStr.includes("firestore.googleapis.com")) {
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const liveSeries = await client.publishSeries({
      filePaths: [img1, img2],
      caption: "Live series test",
      tags: ["Street", "Black and White"],
      dryRun: false
    });
    assert.strictEqual(liveSeries.success, true);
    assert.strictEqual(liveSeries.imageCount, 2);

    // 10. publishSeries - Moderation rejection on image #2
    let imageCounter = 0;
    globalThis.fetch = async (url: any) => {
      const urlStr = typeof url === "string" ? url : (url.url || url.href || String(url));
      if (urlStr.includes("sightengine")) {
        imageCounter++;
        if (imageCounter === 1) {
          return new Response(JSON.stringify({ status: "success", nudity: { sexual_activity: 0.01, sexual_display: 0.01 } }), { status: 200 });
        }
        // image #2 fails
        return new Response(JSON.stringify({ status: "success", nudity: { sexual_activity: 0.99, sexual_display: 0.99 } }), { status: 200 });
      }
      if (urlStr.includes("firebasestorage.googleapis.com")) {
        return new Response(JSON.stringify({ name: "posts/u/img", downloadTokens: "tok" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    await assert.rejects(
      async () => {
        await client.publishSeries({
          filePaths: [img1, img2],
          caption: "Series fail on #2",
          tags: ["Street"],
          dryRun: false
        });
      },
      /Image #2 rejected by content moderation/
    );

    // 11. getUserProfile
    globalThis.fetch = async (url: any) => {
      return new Response(JSON.stringify({ fields: { username: { stringValue: "photo_artist" }, bio: { stringValue: "Visual storyteller" } } }), { status: 200 });
    };
    const prof = await client.getUserProfile();
    assert.strictEqual(prof.userId, "u_client_test");
    assert.strictEqual(prof.username, "photo_artist");
    assert.strictEqual(prof.bio, "Visual storyteller");

    await clearCredentials();
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ FotoClient unit tests passed");
}
