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

  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
    await clearCredentials();
  }

  console.log("  ✓ MCP Server unit tests passed");
}
