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

    // 12. browseTag - invalid tag
    await assert.rejects(
      async () => {
        await client.browseTag({ tag: "InvalidNonCuratedTag" });
      },
      /is not a valid Foto curated tag/
    );

    // 13. browseTag - valid tag with posts
    globalThis.fetch = async (url: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("Fine Art Nude_meta")) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "0" }, postCount: { integerValue: "2" } } }), { status: 200 });
      }
      if (urlStr.includes("Fine Art Nude_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "p_nude_1" }, { stringValue: "p_nude_2" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_nude_1")) {
        return new Response(JSON.stringify({
          fields: {
            postId: { stringValue: "p_nude_1" },
            userId: { stringValue: "artist_1" },
            description: { stringValue: "Shadow and human form" },
            tags: { arrayValue: { values: [{ stringValue: "Fine Art Nude" }] } },
            imageUrl: { stringValue: "https://foto.storage/p1.jpg" },
            nudityRating: { doubleValue: 0.15 }
          }
        }), { status: 200 });
      }
      if (urlStr.includes("posts/p_nude_2")) {
        return new Response(JSON.stringify({
          fields: {
            postId: { stringValue: "p_nude_2" },
            userId: { stringValue: "artist_2" },
            description: { stringValue: "Abstract figure" },
            tags: { arrayValue: { values: [{ stringValue: "Fine Art Nude" }] } },
            imageUrl: { stringValue: "https://foto.storage/p2.jpg" },
            nudityRating: { doubleValue: 0.22 }
          }
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const browseResult = await client.browseTag({ tag: "Fine Art Nude" });
    assert.strictEqual(browseResult.tag, "Fine Art Nude");
    assert.strictEqual(browseResult.shard, 0);
    assert.strictEqual(browseResult.totalPostsInShard, 2);
    assert.strictEqual(browseResult.returnedCount, 2);
    assert.strictEqual(browseResult.posts[0].postId, "p_nude_2"); // newest first

    // Test with explicit shard
    const browseShardResult = await client.browseTag({ tag: "Fine Art Nude", shard: 0, limit: 1 });
    assert.strictEqual(browseShardResult.returnedCount, 1);

    // 14. findPhotographersByTag - invalid tag
    await assert.rejects(
      async () => {
        await client.findPhotographersByTag({ tag: "BadTag" });
      },
      /is not a valid Foto curated tag/
    );

    // 15. findPhotographersByTag - valid tag
    globalThis.fetch = async (url: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("Fine Art Nude_meta")) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "0" } } }), { status: 200 });
      }
      if (urlStr.includes("Fine Art Nude_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "p_nude_1" }, { stringValue: "p_nude_2" }, { stringValue: "p_nude_3" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_nude_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_nude_1" }, userId: { stringValue: "artist_1" }, description: { stringValue: "Shot 1" }, tags: { arrayValue: { values: [{ stringValue: "Fine Art Nude" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_nude_2")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_nude_2" }, userId: { stringValue: "artist_2" }, description: { stringValue: "Shot 2" }, tags: { arrayValue: { values: [{ stringValue: "Fine Art Nude" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_nude_3")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_nude_3" }, userId: { stringValue: "artist_1" }, description: { stringValue: "Shot 3" }, tags: { arrayValue: { values: [{ stringValue: "Fine Art Nude" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/artist_1")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "elena_fineart" }, displayName: { stringValue: "Elena Rostova" }, bio: { stringValue: "Fine art nudes and figures" }, postCount: { integerValue: "42" }, followerCount: { integerValue: "1850" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/artist_2")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "marcus_lens" }, displayName: { stringValue: "Marcus Vance" }, postCount: { integerValue: "15" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const photogs = await client.findPhotographersByTag({ tag: "Fine Art Nude" });
    assert.strictEqual(photogs.tag, "Fine Art Nude");
    assert.strictEqual(photogs.photographerCount, 2);
    assert.strictEqual(photogs.photographers[0].username, "elena_fineart");
    assert.strictEqual(photogs.photographers[0].displayName, "Elena Rostova");
    assert.strictEqual(photogs.photographers[0].bio, "Fine art nudes and figures");
    assert.strictEqual(photogs.photographers[0].samplePostsUnderTag.length, 2);
    assert.strictEqual(photogs.photographers[1].username, "marcus_lens");

    // 16. followUser, followUsers & unfollowUser
    await saveCredentials({ userId: "u_me", idToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3600000 });
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });

    const followRes = await client.followUser("u_target_1");
    assert.strictEqual(followRes.success, true);
    assert.strictEqual(followRes.targetUserId, "u_target_1");

    await assert.rejects(async () => {
      await client.followUser("u_me");
    }, /Cannot follow yourself/);

    await assert.rejects(async () => {
      await client.followUser("");
    }, /Invalid targetUserId provided/);

    const followBatchRes = await client.followUsers(["u_target_1", "u_target_2", "u_me"]);
    assert.strictEqual(followBatchRes.followedCount, 2);

    const unfollowRes = await client.unfollowUser("u_target_1");
    assert.strictEqual(unfollowRes.success, true);

    await assert.rejects(async () => {
      await client.unfollowUser("");
    }, /Invalid targetUserId provided/);

    await clearCredentials();
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ FotoClient unit tests passed");
}
