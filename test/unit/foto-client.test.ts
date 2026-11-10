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
      if (urlStr.includes("Wildlife_meta")) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "0" }, postCount: { integerValue: "2" } } }), { status: 200 });
      }
      if (urlStr.includes("Wildlife_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "p_wild_1" }, { stringValue: "p_wild_2" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_wild_1")) {
        return new Response(JSON.stringify({
          fields: {
            postId: { stringValue: "p_wild_1" },
            userId: { stringValue: "artist_1" },
            description: { stringValue: "Great Grey Owl in mist" },
            tags: { arrayValue: { values: [{ stringValue: "Wildlife" }] } },
            imageUrl: { stringValue: "https://foto.storage/p1.jpg" },
            nudityRating: { doubleValue: 0.01 }
          }
        }), { status: 200 });
      }
      if (urlStr.includes("posts/p_wild_2")) {
        return new Response(JSON.stringify({
          fields: {
            postId: { stringValue: "p_wild_2" },
            userId: { stringValue: "artist_2" },
            description: { stringValue: "Alpine Ibex at dawn" },
            tags: { arrayValue: { values: [{ stringValue: "Wildlife" }] } },
            imageUrl: { stringValue: "https://foto.storage/p2.jpg" },
            nudityRating: { doubleValue: 0.01 }
          }
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const browseResult = await client.browseTag({ tag: "Wildlife" });
    assert.strictEqual(browseResult.tag, "Wildlife");
    assert.strictEqual(browseResult.shard, 0);
    assert.strictEqual(browseResult.totalPostsInShard, 2);
    assert.strictEqual(browseResult.returnedCount, 2);
    assert.strictEqual(browseResult.posts[0].postId, "p_wild_2"); // newest first

    // Test with explicit shard
    const browseShardResult = await client.browseTag({ tag: "Wildlife", shard: 0, limit: 1 });
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
      if (urlStr.includes("Wildlife_meta")) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "0" } } }), { status: 200 });
      }
      if (urlStr.includes("Wildlife_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "p_wild_1" }, { stringValue: "p_wild_2" }, { stringValue: "p_wild_3" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_wild_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_wild_1" }, userId: { stringValue: "artist_1" }, description: { stringValue: "Shot 1" }, tags: { arrayValue: { values: [{ stringValue: "Wildlife" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_wild_2")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_wild_2" }, userId: { stringValue: "artist_2" }, description: { stringValue: "Shot 2" }, tags: { arrayValue: { values: [{ stringValue: "Wildlife" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_wild_3")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_wild_3" }, userId: { stringValue: "artist_1" }, description: { stringValue: "Shot 3" }, tags: { arrayValue: { values: [{ stringValue: "Wildlife" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/artist_1")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "elena_wild" }, displayName: { stringValue: "Elena Rostova" }, bio: { stringValue: "Alpine wildlife and nature studies" }, postCount: { integerValue: "42" }, followerCount: { integerValue: "1850" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/artist_2")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "marcus_lens" }, displayName: { stringValue: "Marcus Vance" }, postCount: { integerValue: "15" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const photogs = await client.findPhotographersByTag({ tag: "Wildlife" });
    assert.strictEqual(photogs.tag, "Wildlife");
    assert.strictEqual(photogs.photographerCount, 2);
    assert.strictEqual(photogs.photographers[0].username, "elena_wild");
    assert.strictEqual(photogs.photographers[0].displayName, "Elena Rostova");
    assert.strictEqual(photogs.photographers[0].bio, "Alpine wildlife and nature studies");
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

    const unfollowBatchRes = await client.unfollowUsers(["u_target_1", "u_target_2", "u_me"]);
    assert.strictEqual(unfollowBatchRes.unfollowedCount, 2);

    // deletePost
    const delRes = await client.deletePost("p_del_1");
    assert.strictEqual(delRes.success, true);
    assert.strictEqual(delRes.postId, "p_del_1");

    await assert.rejects(async () => {
      await client.deletePost("");
    }, /Invalid postId provided/);

    // updatePost
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_up")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_up" }, userId: { stringValue: "u_me" }, description: { stringValue: "Updated" }, tags: { arrayValue: { values: [{ stringValue: "Street" }] } } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    };

    const upRes = await client.updatePost({ postId: "p_up", caption: "Updated", tags: ["Street"] });
    assert.strictEqual(upRes.success, true);
    assert.strictEqual(upRes.post.description, "Updated");

    await assert.rejects(async () => {
      await client.updatePost({ postId: "" });
    }, /Invalid postId provided/);

    await assert.rejects(async () => {
      await client.updatePost({ postId: "p_up", tags: ["NotARealTag"] });
    }, /Tag validation failed/);

    // getPost
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_get")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_get" }, userId: { stringValue: "u_me" }, privateMetadataId: { stringValue: "meta_1" } } }), { status: 200 });
      }
      if (urlStr.includes("image-private-metadata/meta_1")) {
        return new Response(JSON.stringify({ fields: { exif: { mapValue: { fields: { Model: { stringValue: "500CM" } } } } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const gotPost = await client.getPost("p_get");
    assert.strictEqual(gotPost.postId, "p_get");
    assert.strictEqual(gotPost.exif?.Model, "500CM");

    await assert.rejects(async () => {
      await client.getPost("");
    }, /Invalid postId provided/);

    await assert.rejects(async () => {
      await client.getPost("p_missing");
    }, /not found/);

    // getPhotographerProfile (by userId and by username)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("usernames/wildlife_fan")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_wild" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_wild")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "wildlife_fan" }, postIds: { arrayValue: { values: [{ stringValue: "post_w1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/post_w1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "post_w1" }, description: { stringValue: "Elk in meadow" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const profByUsername = await client.getPhotographerProfile({ username: "@wildlife_fan" });
    assert.strictEqual(profByUsername.username, "wildlife_fan");
    assert.strictEqual(profByUsername.recentPosts.length, 1);

    const profByUserId = await client.getPhotographerProfile({ userId: "u_wild" });
    assert.strictEqual(profByUserId.userId, "u_wild");

    await assert.rejects(async () => {
      await client.getPhotographerProfile({});
    }, /Please provide either userId or username/);

    await assert.rejects(async () => {
      await client.getPhotographerProfile({ username: "unknown_person" });
    }, /not found/);

    await assert.rejects(async () => {
      await client.getPhotographerProfile({ userId: "u_missing" });
    }, /not found/);

    // likePost & unlikePost
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    const likeRes = await client.likePost("p_like_1");
    assert.strictEqual(likeRes.success, true);
    assert.strictEqual(likeRes.postId, "p_like_1");

    await assert.rejects(async () => {
      await client.likePost("");
    }, /Invalid postId provided/);

    const unlikeRes = await client.unlikePost("p_like_1");
    assert.strictEqual(unlikeRes.success, true);

    await assert.rejects(async () => {
      await client.unlikePost("");
    }, /Invalid postId provided/);

    // getComments & postComment
    globalThis.fetch = async () => new Response(JSON.stringify([{ document: { name: "projects/.../comments/c1", fields: { text: { stringValue: "Nice!" } } } }]), { status: 200 });
    const clientComments = await client.getComments("p_like_1");
    assert.strictEqual(clientComments.length, 1);

    await assert.rejects(async () => {
      await client.getComments("");
    }, /Invalid postId provided/);

    globalThis.fetch = async () => new Response(JSON.stringify({ name: "c_new" }), { status: 200 });
    const postComRes = await client.postComment("p_like_1", "Stunning tones");
    assert.strictEqual(postComRes.success, true);
    assert.strictEqual(postComRes.comment.text, "Stunning tones");

    await assert.rejects(async () => {
      await client.postComment("", "text");
    }, /Invalid postId provided/);

    await assert.rejects(async () => {
      await client.postComment("p1", "");
    }, /Comment text cannot be empty/);

    // getNotifications
    globalThis.fetch = async () => new Response(JSON.stringify([{ document: { name: "n1", fields: { type: { stringValue: "follow" } } } }]), { status: 200 });
    const notifs = await client.getNotifications();
    assert.strictEqual(notifs.length, 1);

    // getHomeFeed
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_browse") || urlStr.includes("user-profiles/u_me")) {
        return new Response(JSON.stringify({ fields: { following: { arrayValue: { values: [{ stringValue: "u_target_1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_target_1")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "p_feed_1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_feed_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_feed_1" }, userId: { stringValue: "u_target_1" }, description: { stringValue: "Feed post" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const feed = await client.getHomeFeed();
    assert.strictEqual(feed.length, 1);
    assert.strictEqual(feed[0].postId, "p_feed_1");

    // createPortfolio - validations
    await assert.rejects(async () => {
      await client.createPortfolio({ title: "", images: [{ filePath: img1 }], tags: ["Landscape"] });
    }, /Portfolio title is required/);

    await assert.rejects(async () => {
      await client.createPortfolio({ title: "My Portfolio", images: [{ filePath: img1 }], tags: ["Landscape"] });
    }, /must contain at least 2 images/);

    await assert.rejects(async () => {
      await client.createPortfolio({ title: "My Portfolio", images: [{ filePath: img1 }, { filePath: img1 }], tags: ["InvalidTagXYZ"] });
    }, /Invalid tags/);

    await assert.rejects(async () => {
      await client.createPortfolio({ title: "My Portfolio", images: [{ filePath: "" }, { filePath: img1 }], tags: ["Landscape"] });
    }, /missing filePath/);

    // createPortfolio - dryRun
    const dryPortfolio = await client.createPortfolio({
      title: "Alpine Visions",
      images: [
        { filePath: img1, caption: "Peak 1" },
        { filePath: img1, caption: "Peak 2" }
      ],
      tags: ["Landscape", "Travel"],
      dryRun: true
    });
    assert.strictEqual(dryPortfolio.dryRun, true);
    assert.strictEqual(dryPortfolio.title, "Alpine Visions");
    assert.strictEqual(dryPortfolio.imageCount, 2);

    // createPortfolio - live flow
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("firebasestorage")) {
        return new Response(JSON.stringify({ downloadTokens: "token_abc" }), { status: 200 });
      }
      if (urlStr.includes("api.sightengine.com")) {
        return new Response(JSON.stringify({ status: "success", nudity: { safe: 0.99, raw: 0.01 }, weapon: 0, recreational_drug: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    };

    const pubPortfolio = await client.createPortfolio({
      title: "Nordic Series",
      images: [
        { filePath: img1, caption: "Fjord 1" },
        { filePath: img1, caption: "Fjord 2" }
      ],
      tags: ["Landscape"],
      coverIndex: 1,
      coverAlignmentX: 0.8
    });
    assert.strictEqual(pubPortfolio.success, true);
    assert.strictEqual(pubPortfolio.title, "Nordic Series");
    assert.strictEqual(pubPortfolio.imageCount, 2);
    assert(pubPortfolio.coverImageUrl?.includes("firebasestorage"));

    // listPortfolios - target userId
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_artist")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "port_1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/port_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "port_1" }, type: { stringValue: "portfolio" }, title: { stringValue: "Artist Portfolio" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const userPortfolios = await client.listPortfolios({ userId: "u_artist" });
    assert.strictEqual(userPortfolios.length, 1);
    assert.strictEqual(userPortfolios[0].title, "Artist Portfolio");

    // listPortfolios - target username
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("usernames/elena")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_elena" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_elena")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "port_elena" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/port_elena")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "port_elena" }, type: { stringValue: "portfolio" }, title: { stringValue: "Elena Portfolio" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const elenaPorts = await client.listPortfolios({ username: "elena" });
    assert.strictEqual(elenaPorts.length, 1);
    assert.strictEqual(elenaPorts[0].title, "Elena Portfolio");

    // v3.0.0: deleteComment, getPostLikes, updatePortfolio, deletePortfolio, updateUserProfile, reportContent, parseXmp
    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("comments/c_client_del") && (!init?.method || init?.method === "GET")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_me" }, postId: { stringValue: "p1" } } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const delComClient = await client.deleteComment({ commentId: "c_client_del", postId: "p1" });
    assert.strictEqual(delComClient.success, true);

    await assert.rejects(async () => client.deleteComment({ commentId: "", postId: "p1" }), /Invalid commentId/);
    await assert.rejects(async () => client.deleteComment({ commentId: "c1", postId: "" }), /Invalid postId/);

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_likes_client")) {
        return new Response(JSON.stringify({ fields: { likes: { arrayValue: { values: [{ stringValue: "u_fan" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_fan")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "fan_user" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const likesRes = await client.getPostLikes("p_likes_client", 10);
    assert.strictEqual(likesRes.totalLikes, 1);
    assert.strictEqual(likesRes.users[0].username, "fan_user");

    await assert.rejects(async () => client.getPostLikes(""), /Invalid postId/);

    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/port_c_1") && (!init?.method || init?.method === "GET")) {
        return new Response(
          JSON.stringify({
            fields: {
              postId: { stringValue: "port_c_1" },
              userId: { stringValue: "u_me" },
              type: { stringValue: "portfolio" },
              title: { stringValue: "Old" }
            }
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ name: "ok" }), { status: 200 });
    };
    const upPortClient = await client.updatePortfolio({
      postId: "port_c_1",
      title: "Updated Portfolio",
      tags: ["Street"]
    });
    assert.strictEqual(upPortClient.success, true);

    await assert.rejects(async () => client.updatePortfolio({ postId: "" }), /Invalid portfolio postId/);
    await assert.rejects(async () => client.updatePortfolio({ postId: "port_c_1", tags: ["NotACuratedTag"] }), /Tag validation failed/);

    const delPortClient = await client.deletePortfolio("port_c_1");
    assert.strictEqual(delPortClient.success, true);
    await assert.rejects(async () => client.deletePortfolio(""), /Invalid portfolio postId/);

    globalThis.fetch = async () => new Response(JSON.stringify({ fields: { username: { stringValue: "u_me" }, bio: { stringValue: "New Bio" } } }), { status: 200 });
    const upUserClient = await client.updateUserProfile({ bio: "New Bio", website: "https://sven.photo" });
    assert.strictEqual(upUserClient.success, true);
    assert.strictEqual(upUserClient.profile.bio, "New Bio");

    globalThis.fetch = async () => new Response(JSON.stringify({ name: "rep_1" }), { status: 200 });
    const repClient = await client.reportContent({ targetType: "post", targetId: "p_spam", reason: "Spam" });
    assert.strictEqual(repClient.success, true);
    await assert.rejects(async () => client.reportContent({ targetType: "post", targetId: "", reason: "Spam" }), /targetId is required/);
    await assert.rejects(async () => client.reportContent({ targetType: "post", targetId: "p1", reason: "" }), /Report reason is required/);

    const sampleXmp = path.join(tempDir, "img1.xmp");
    await fs.writeFile(
      sampleXmp,
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmp:Rating="5" xmp:Label="Green"/></rdf:RDF></x:xmpmeta>`,
      "utf-8"
    );
    const parsedXmpClient = await client.parseXmp(img1);
    assert.strictEqual(parsedXmpClient.rating, 5);
    assert.strictEqual(parsedXmpClient.colorLabel, "Green");

    // checkUsername
    const invalidFormat = await client.checkUsername("a");
    assert.strictEqual(invalidFormat.available, false);
    assert(invalidFormat.reason?.includes("between 3 and 30 characters"));
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("usernames/taken_user")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_other" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const availRes = await client.checkUsername("available_user");
    assert.strictEqual(availRes.available, true);
    const takenRes = await client.checkUsername("taken_user");
    assert.strictEqual(takenRes.available, false);

    // getUserFollowers
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_target")) {
        return new Response(JSON.stringify({ fields: { followers: { arrayValue: { values: [{ stringValue: "u_follower1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_follower1")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "follower_one" }, displayName: { stringValue: "Follower One" } } }), { status: 200 });
      }
      if (urlStr.includes("usernames/target_handle")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_target" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const followersRes = await client.getUserFollowers({ username: "target_handle" });
    assert.strictEqual(followersRes.totalFollowers, 1);
    assert.strictEqual(followersRes.followers[0].username, "follower_one");
    await assert.rejects(async () => client.getUserFollowers({ username: "nonexistent_target" }), /not found/);

    // getUserFollowing
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_client_test") || urlStr.includes("user-profiles/u_me")) {
        return new Response(JSON.stringify({ fields: { following: { arrayValue: { values: [{ stringValue: "u_following1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_following1")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "following_one" }, displayName: { stringValue: "Following One" } } }), { status: 200 });
      }
      if (urlStr.includes("usernames/target_handle")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_target" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_target")) {
        return new Response(JSON.stringify({ fields: { following: { arrayValue: { values: [] } } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const followingRes = await client.getUserFollowing();
    assert.strictEqual(followingRes.totalFollowing, 1);
    assert.strictEqual(followingRes.following[0].username, "following_one");
    const targetFollowing = await client.getUserFollowing({ username: "target_handle" });
    assert.strictEqual(targetFollowing.totalFollowing, 0);
    await assert.rejects(async () => client.getUserFollowing({ username: "nonexistent_target" }), /not found/);

    // getFeaturedPhotographers
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes(":runQuery")) {
        return new Response(JSON.stringify([
          { document: { name: "projects/.../ambassador-usernames/ambassador_user" } }
        ]), { status: 200 });
      }
      if (urlStr.includes("usernames/ambassador_user")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_amb" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_amb")) {
        return new Response(JSON.stringify({
          fields: {
            username: { stringValue: "ambassador_user" },
            displayName: { stringValue: "Ambassador Creator" },
            bio: { stringValue: "Street ambassador" }
          }
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const featured = await client.getFeaturedPhotographers(5);
    assert.strictEqual(featured.count, 1);
    assert.strictEqual(featured.featuredPhotographers[0].username, "ambassador_user");

    // uploadProfilePhoto
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("firebasestorage.googleapis.com")) {
        return new Response(JSON.stringify({ name: "avatars/u_client_test/avatar_123.jpg", downloadTokens: "tok-avatar" }), { status: 200 });
      }
      if (urlStr.includes("firestore.googleapis.com")) {
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const avatarRes = await client.uploadProfilePhoto(img1);
    assert.strictEqual(avatarRes.success, true);
    assert(avatarRes.profilePhotoUrl.includes("avatars"));
    await assert.rejects(async () => client.uploadProfilePhoto(""), /filePath is required/);

    // dismissNotification
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    const dismissRes = await client.dismissNotification("notif_to_del");
    assert.strictEqual(dismissRes.success, true);
    await assert.rejects(async () => client.dismissNotification(""), /notificationId is required/);

    // getExploreFeed
    globalThis.fetch = async (url: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "p_exp_c" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_exp_c")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_exp_c" }, userId: { stringValue: "u_exp" }, description: { stringValue: "Explore photo" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const exploreFeed = await client.getExploreFeed({ limit: 5 });
    assert(exploreFeed.length > 0);
    assert.strictEqual(exploreFeed[0].postId, "p_exp_c");

    await clearCredentials();
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ FotoClient unit tests passed");
}
