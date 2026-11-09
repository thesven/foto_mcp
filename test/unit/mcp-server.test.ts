import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

// Guard against automatic stdio connect
process.env.FOTO_MCP_TEST = "true";

import { server, client } from "../../src/index.js";
import { saveCredentials, clearCredentials } from "../../src/api/auth.js";

export async function runMcpServerTests() {
  console.log("--- Testing MCP Server Tools, Resources & Prompts ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-srv-"));
  const testImg = path.join(tempDir, "sample.jpg");
  await sharp({ create: { width: 1820, height: 1200, channels: 3, background: { r: 80, g: 100, b: 120 } } }).jpeg().toFile(testImg);

  const tools = (server as any)._registeredTools;
  const resources = (server as any)._registeredResources;
  const prompts = (server as any)._registeredPrompts;

  const originalFetch = globalThis.fetch;

  try {
    // 1. Resource: foto://curated-tags
    const resourceHandler = resources["foto://curated-tags"];
    assert(resourceHandler, "foto://curated-tags resource must be registered");
    const resResult = await resourceHandler.readCallback(new URL("foto://curated-tags"), {} as any);
    assert(resResult.contents.length > 0);
    const parsedTags = JSON.parse(resResult.contents[0].text);
    assert.strictEqual(parsedTags.length, 303);

    // 2. Prompt: curate_foto_post
    const promptHandler = prompts["curate_foto_post"];
    assert(promptHandler, "curate_foto_post prompt must be registered");
    const promptResult = await promptHandler.callback({}, {} as any);
    assert(promptResult.messages.length > 0);
    assert(promptResult.messages[0].content.text.includes("Foto guidelines"));

    // 3. Tool: foto_auth_status
    await clearCredentials();
    const authStatusRes = await tools.foto_auth_status.handler({}, {} as any);
    assert(!authStatusRes.isError);
    assert(authStatusRes.content[0].text.includes("loggedIn"));

    // 4. Tool: foto_login (success and error)
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ localId: "u_mcp_login", email: "login@test.com", idToken: "tok", refreshToken: "ref", expiresIn: "3600" }), { status: 200 });
    };
    const loginSuccess = await tools.foto_login.handler({ email: "login@test.com", password: "pwd" }, {} as any);
    assert(!loginSuccess.isError);
    assert(loginSuccess.content[0].text.includes("Successfully authenticated"));

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }), { status: 400 });
    };
    const loginFail = await tools.foto_login.handler({ email: "login@test.com", password: "wrong" }, {} as any);
    assert.strictEqual(loginFail.isError, true);
    assert(loginFail.content[0].text.includes("Foto login failed"));

    // 5. Tool: foto_logout
    const logoutRes = await tools.foto_logout.handler({}, {} as any);
    assert(!logoutRes.isError);
    assert(logoutRes.content[0].text.includes("Successfully logged out"));

    // 6. Tool: foto_inspect_image (success and error)
    const inspectRes = await tools.foto_inspect_image.handler({ filePath: testImg }, {} as any);
    assert(!inspectRes.isError);
    assert(inspectRes.content[0].text.includes("originalWidth"));
    assert(inspectRes.content.some((c: any) => c.type === "image"));

    const inspectNoPrev = await tools.foto_inspect_image.handler({ filePath: testImg, includePreview: false }, {} as any);
    assert(!inspectNoPrev.isError);
    assert(!inspectNoPrev.content.some((c: any) => c.type === "image"));

    const inspectFail = await tools.foto_inspect_image.handler({ filePath: "/non/existent/path.jpg" }, {} as any);
    assert.strictEqual(inspectFail.isError, true);
    assert(inspectFail.content[0].text.includes("Failed to inspect image"));

    // 7. Tool: foto_suggest_tags
    const suggestRes = await tools.foto_suggest_tags.handler({ caption: "Walking in foggy redwood forest" }, {} as any);
    assert(!suggestRes.isError);
    assert(suggestRes.content[0].text.includes("suggestedTags"));

    // 8. Tool: foto_search_tags
    const searchRes = await tools.foto_search_tags.handler({ query: "Film", limit: 5 }, {} as any);
    assert(!searchRes.isError);
    assert(searchRes.content[0].text.includes("totalCuratedTags"));

    // 9. Tool: foto_draft_post (success and error)
    const draftRes = await tools.foto_draft_post.handler({ filePath: testImg, caption: "Post caption", tags: ["Street"] }, {} as any);
    assert(!draftRes.isError);
    assert(draftRes.content[0].text.includes("readyToPublish"));

    const draftFail = await tools.foto_draft_post.handler({ filePath: "/no/file.jpg", caption: "", tags: [] }, {} as any);
    assert.strictEqual(draftFail.isError, true);

    // 10. Tool: foto_publish_post (dryRun = true, and error)
    const pubDryRes = await tools.foto_publish_post.handler({ filePath: testImg, caption: "Dry run test", tags: ["Landscape"], dryRun: true }, {} as any);
    assert(!pubDryRes.isError);
    assert(pubDryRes.content[0].text.includes("[DRY RUN]"));

    const pubFail = await tools.foto_publish_post.handler({ filePath: testImg, caption: "Invalid tags", tags: ["InvalidTag"], dryRun: true }, {} as any);
    assert.strictEqual(pubFail.isError, true);

    // 11. Tool: foto_publish_series (dryRun = true, and error)
    const seriesDryRes = await tools.foto_publish_series.handler({ filePaths: [testImg, testImg], caption: "Series dry run", tags: ["Street"], dryRun: true }, {} as any);
    assert(!seriesDryRes.isError);
    assert(seriesDryRes.content[0].text.includes("[DRY RUN]"));

    const seriesFail = await tools.foto_publish_series.handler({ filePaths: [testImg], caption: "Series of 1", tags: ["Street"], dryRun: true }, {} as any);
    assert.strictEqual(seriesFail.isError, true);

    // 12. Tool: foto_get_user_profile (success and error)
    await saveCredentials({
      userId: "u_mcp_prof",
      idToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600000
    });
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ fields: { username: { stringValue: "mcp_user" } } }), { status: 200 });
    };
    const profRes = await tools.foto_get_user_profile.handler({}, {} as any);
    assert(!profRes.isError);
    assert(profRes.content[0].text.includes("mcp_user"));

    await clearCredentials();
    const profFail = await tools.foto_get_user_profile.handler({}, {} as any);
    assert.strictEqual(profFail.isError, true);

    // 13. Tool: foto_sync_instagram (success and error)
    const sampleHtmlFile = path.join(tempDir, "posts.html");
    await fs.writeFile(
      sampleHtmlFile,
      '<div class="uiBoxWhite"><h2>Sample caption</h2><img src="pic.jpg" /></div>'
    );

    const igRes = await tools.foto_sync_instagram.handler({ htmlFilePath: sampleHtmlFile, dryRun: true }, {} as any);
    assert(!igRes.isError);
    assert(igRes.content[0].text.includes("candidates"));

    // Test with profile containing recentTags
    await saveCredentials({ userId: "u_ig", idToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3600000 });
    globalThis.fetch = async () => new Response(JSON.stringify({ fields: { recentTags: { arrayValue: { values: [{ stringValue: "Existing caption" }] } } } }), { status: 200 });
    const igResWithProfile = await tools.foto_sync_instagram.handler({ htmlFilePath: sampleHtmlFile, dryRun: true }, {} as any);
    assert(!igResWithProfile.isError);

    const igFail = await tools.foto_sync_instagram.handler({ htmlFilePath: "/no/ig.html" }, {} as any);
    assert.strictEqual(igFail.isError, true);

    // 14. Tool: foto_browse_tag (success and error)
    await saveCredentials({ userId: "u_browse", idToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3600000 });
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("Boudoir_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "b1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/b1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "b1" }, userId: { stringValue: "u_boudoir" }, tags: { arrayValue: { values: [{ stringValue: "Boudoir" }] } } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const browseRes = await tools.foto_browse_tag.handler({ tag: "Boudoir", limit: 5 }, {} as any);
    assert(!browseRes.isError);
    assert(browseRes.content[0].text.includes("Boudoir"));
    assert(browseRes.content[0].text.includes("b1"));

    const browseFail = await tools.foto_browse_tag.handler({ tag: "InvalidNotRealTag" }, {} as any);
    assert.strictEqual(browseFail.isError, true);
    assert(browseFail.content[0].text.includes("Failed to browse tag"));

    // 15. Tool: foto_find_photographers_by_tag (success and error)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("Boudoir_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "b1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/b1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "b1" }, userId: { stringValue: "u_boudoir" }, tags: { arrayValue: { values: [{ stringValue: "Boudoir" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_boudoir")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "boudoir_studio" }, displayName: { stringValue: "Intimate Light Studio" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const findPhotogRes = await tools.foto_find_photographers_by_tag.handler({ tag: "Boudoir" }, {} as any);
    assert(!findPhotogRes.isError);
    assert(findPhotogRes.content[0].text.includes("boudoir_studio"));
    assert(findPhotogRes.content[0].text.includes("Intimate Light Studio"));

    const findPhotogFail = await tools.foto_find_photographers_by_tag.handler({ tag: "NotAValidTag" }, {} as any);
    assert.strictEqual(findPhotogFail.isError, true);
    assert(findPhotogFail.content[0].text.includes("Failed to find photographers"));

    // 16. Tool: foto_follow_user (single, batch, neither, and error)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes(":commit")) {
        return new Response(JSON.stringify({ writeResults: [{}, {}] }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const followSingleRes = await tools.foto_follow_user.handler({ userId: "u_target_1" }, {} as any);
    assert(!followSingleRes.isError);
    assert(followSingleRes.content[0].text.includes("u_target_1"));

    const followBatchRes = await tools.foto_follow_user.handler({ userIds: ["u_target_1", "u_target_2"] }, {} as any);
    assert(!followBatchRes.isError);
    assert(followBatchRes.content[0].text.includes("followedCount"));

    const followNoArgRes = await tools.foto_follow_user.handler({}, {} as any);
    assert.strictEqual(followNoArgRes.isError, true);
    assert(followNoArgRes.content[0].text.includes("Please provide either userId or userIds"));

    const followSelfRes = await tools.foto_follow_user.handler({ userId: "u_browse" }, {} as any);
    assert.strictEqual(followSelfRes.isError, true);
    assert(followSelfRes.content[0].text.includes("Cannot follow yourself"));

    // 17. Tool: foto_unfollow_user (single, batch, neither, and error)
    const unfollowSingleRes = await tools.foto_unfollow_user.handler({ userId: "u_target_1" }, {} as any);
    assert(!unfollowSingleRes.isError);
    assert(unfollowSingleRes.content[0].text.includes("u_target_1"));

    const unfollowBatchRes = await tools.foto_unfollow_user.handler({ userIds: ["u_target_1", "u_target_2"] }, {} as any);
    assert(!unfollowBatchRes.isError);
    assert(unfollowBatchRes.content[0].text.includes("unfollowedCount"));

    const unfollowNoArgRes = await tools.foto_unfollow_user.handler({}, {} as any);
    assert.strictEqual(unfollowNoArgRes.isError, true);
    assert(unfollowNoArgRes.content[0].text.includes("Please provide either userId or userIds"));

    // 18. Tool: foto_delete_post (success and error)
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    const delPostRes = await tools.foto_delete_post.handler({ postId: "p_del" }, {} as any);
    assert(!delPostRes.isError);
    assert(delPostRes.content[0].text.includes("Successfully deleted post"));

    // 19. Tool: foto_update_post (success and error)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_update")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_update" }, userId: { stringValue: "u_browse" }, description: { stringValue: "Old" } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "updated" }), { status: 200 });
    };
    const updatePostRes = await tools.foto_update_post.handler({ postId: "p_update", caption: "New", tags: ["Street"] }, {} as any);
    assert(!updatePostRes.isError);
    assert(updatePostRes.content[0].text.includes("Successfully updated post"));

    const updatePostFail = await tools.foto_update_post.handler({ postId: "p_update", tags: ["NotARealTag"] }, {} as any);
    assert.strictEqual(updatePostFail.isError, true);

    // 20. Tool: foto_get_post (success and error)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_get_tool")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_get_tool" }, userId: { stringValue: "u_browse" }, privateMetadataId: { stringValue: "meta_tool" } } }), { status: 200 });
      }
      if (urlStr.includes("image-private-metadata/meta_tool")) {
        return new Response(JSON.stringify({ fields: { exif: { mapValue: { fields: { LensModel: { stringValue: "50mm" } } } } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const getPostRes = await tools.foto_get_post.handler({ postId: "p_get_tool" }, {} as any);
    assert(!getPostRes.isError);
    assert(getPostRes.content[0].text.includes("p_get_tool"));

    const getPostFail = await tools.foto_get_post.handler({ postId: "p_missing" }, {} as any);
    assert.strictEqual(getPostFail.isError, true);

    // 21. Tool: foto_get_photographer_profile (success and error)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("usernames/photog_alex")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u_alex" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_alex")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "photog_alex" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const getProfRes = await tools.foto_get_photographer_profile.handler({ username: "photog_alex" }, {} as any);
    assert(!getProfRes.isError);
    assert(getProfRes.content[0].text.includes("photog_alex"));

    const getProfFail = await tools.foto_get_photographer_profile.handler({}, {} as any);
    assert.strictEqual(getProfFail.isError, true);

    // 22. Dynamic Resource Templates: foto://posts/{postId} and foto://users/{userId}
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_get_tool")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_get_tool" }, userId: { stringValue: "u_browse" } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_alex")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "photog_alex" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const resourceTemplates = (server as any)._registeredResourceTemplates;
    const postTemplate = resourceTemplates["foto-post-detail"];
    assert(postTemplate, "foto-post-detail template must be registered");
    const postTmplRes = await postTemplate.readCallback(new URL("foto://posts/p_get_tool"), { postId: "p_get_tool" } as any, {} as any);
    assert(postTmplRes.contents.length > 0);
    assert(postTmplRes.contents[0].text.includes("p_get_tool"));

    const userTemplate = resourceTemplates["foto-user-profile"];
    assert(userTemplate, "foto-user-profile template must be registered");
    const userTmplRes = await userTemplate.readCallback(new URL("foto://users/u_alex"), { userId: "u_alex" } as any, {} as any);
    assert(userTmplRes.contents.length > 0);
    assert(userTmplRes.contents[0].text.includes("photog_alex"));

    // 23. Tools: foto_like_post & foto_unlike_post
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    const likeToolRes = await tools.foto_like_post.handler({ postId: "p_like_tool" }, {} as any);
    assert(!likeToolRes.isError);
    assert(likeToolRes.content[0].text.includes("Successfully liked post"));

    const unlikeToolRes = await tools.foto_unlike_post.handler({ postId: "p_like_tool" }, {} as any);
    assert(!unlikeToolRes.isError);
    assert(unlikeToolRes.content[0].text.includes("Successfully unliked post"));

    // 24. Tools: foto_get_comments & foto_post_comment
    globalThis.fetch = async () => new Response(JSON.stringify([{ document: { name: "c1", fields: { text: { stringValue: "Great composition" } } } }]), { status: 200 });
    const getComRes = await tools.foto_get_comments.handler({ postId: "p_like_tool" }, {} as any);
    assert(!getComRes.isError);
    assert(getComRes.content[0].text.includes("Great composition"));

    globalThis.fetch = async () => new Response(JSON.stringify({ name: "c_new" }), { status: 200 });
    const postComRes = await tools.foto_post_comment.handler({ postId: "p_like_tool", text: "Lovely shadow play" }, {} as any);
    assert(!postComRes.isError);
    assert(postComRes.content[0].text.includes("Lovely shadow play"));

    // 25. Tools: foto_get_notifications & foto_get_home_feed
    globalThis.fetch = async () => new Response(JSON.stringify([{ document: { name: "n1", fields: { type: { stringValue: "comment" } } } }]), { status: 200 });
    const notifsRes = await tools.foto_get_notifications.handler({}, {} as any);
    assert(!notifsRes.isError);
    assert(notifsRes.content[0].text.includes("comment"));

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_browse")) {
        return new Response(JSON.stringify({ fields: { following: { arrayValue: { values: [{ stringValue: "u_target_1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_target_1")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "p_feed_mcp" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_feed_mcp")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_feed_mcp" }, description: { stringValue: "Morning fog" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const feedRes = await tools.foto_get_home_feed.handler({}, {} as any);
    assert(!feedRes.isError);
    assert(feedRes.content[0].text.includes("Morning fog"));

    // 26. Dynamic Resources: foto://my/feed and foto://my/notifications
    const feedResource = resources["foto://my/feed"];
    assert(feedResource, "foto://my/feed resource must be registered");
    const feedResourceRes = await feedResource.readCallback(new URL("foto://my/feed"), {} as any);
    assert(feedResourceRes.contents.length > 0);
    assert(feedResourceRes.contents[0].text.includes("Morning fog"));

    const notifResource = resources["foto://my/notifications"];
    assert(notifResource, "foto://my/notifications resource must be registered");
    globalThis.fetch = async () => new Response(JSON.stringify([{ document: { name: "n2", fields: { type: { stringValue: "like" } } } }]), { status: 200 });
    const notifResourceRes = await notifResource.readCallback(new URL("foto://my/notifications"), {} as any);
    assert(notifResourceRes.contents.length > 0);
    assert(notifResourceRes.contents[0].text.includes("like"));

    // 27. Masterclass Prompts: critique_photograph and curate_photo_series
    const critiquePrompt = prompts["critique_photograph"];
    assert(critiquePrompt, "critique_photograph prompt must be registered");
    const critiqueRes = await critiquePrompt.callback({}, {} as any);
    assert(critiqueRes.messages[0].content.text.includes("Composition & Framing"));

    const seriesPrompt = prompts["curate_photo_series"];
    assert(seriesPrompt, "curate_photo_series prompt must be registered");
    const seriesRes = await seriesPrompt.callback({}, {} as any);
    assert(seriesRes.messages[0].content.text.includes("Pacing & Flow"));

    // 28. Tool: foto_create_portfolio (dryRun and error)
    const createPortDry = await tools.foto_create_portfolio.handler(
      {
        title: "Test Portfolio",
        images: [{ filePath: testImg }, { filePath: testImg }],
        tags: ["Landscape"],
        dryRun: true
      },
      {} as any
    );
    assert(!createPortDry.isError);
    assert(createPortDry.content[0].text.includes("Test Portfolio"));

    const createPortFail = await tools.foto_create_portfolio.handler(
      {
        title: "Fail",
        images: [{ filePath: testImg }],
        tags: ["InvalidTag"],
        dryRun: true
      },
      {} as any
    );
    assert.strictEqual(createPortFail.isError, true);

    // 29. Tool: foto_list_portfolios (success and error)
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_port_mcp")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "p_port_mcp" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_port_mcp")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_port_mcp" }, type: { stringValue: "portfolio" }, title: { stringValue: "MCP Portfolio" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const listPortRes = await tools.foto_list_portfolios.handler({ userId: "u_port_mcp" }, {} as any);
    assert(!listPortRes.isError);
    assert(listPortRes.content[0].text.includes("MCP Portfolio"));

  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
    await clearCredentials();
  }

  console.log("  ✓ MCP Server unit tests passed");
}
