import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { FlickrSyncTool } from "../../src/sync/flickr.js";
import { FotoClient } from "../../src/foto-client.js";
import { saveCredentials, clearCredentials } from "../../src/api/auth.js";

export async function runFlickrTests() {
  console.log("--- Testing Flickr Sync module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-flickr-"));
  const client = new FotoClient();
  const flickr = new FlickrSyncTool(client);

  const originalFetch = globalThis.fetch;

  try {
    // Create sample image
    const sampleImg = path.join(tempDir, "photo123.jpg");
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 80, g: 120, b: 160 } }
    }).jpeg().toFile(sampleImg);

    // 1. Parse JSON file with array
    const exportJsonPath = path.join(tempDir, "flickr_export.json");
    const sampleData = [
      {
        id: "photo123",
        name: "Morning Mist over Lake",
        description: "Taken with Leica M6 <br/> Shot on Kodak Portra 400",
        date_taken: "2024-05-10",
        tags: ["landscape", "film", "lake"],
        albums: ["Travel 2024"],
        file: "photo123.jpg"
      },
      {
        id: "photo456",
        name: "Missing Image Photo",
        description: "No local file",
        tags: ["street"]
      }
    ];
    await fs.writeFile(exportJsonPath, JSON.stringify(sampleData), "utf-8");

    const parsed = await flickr.parseFlickrExport(exportJsonPath);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].id, "photo123");
    assert(parsed[0].description.includes("Taken with Leica M6"));
    assert(!parsed[0].description.includes("<br/>"));

    // 2. Parse directory with individual JSON files
    const dirExport = path.join(tempDir, "export_dir");
    await fs.mkdir(dirExport, { recursive: true });
    await fs.writeFile(
      path.join(dirExport, "photo_single.json"),
      JSON.stringify({ id: "single1", title: "Solo Frame", tags: "monochrome analog" })
    );
    const parsedDir = await flickr.parseFlickrExport(dirExport);
    assert.strictEqual(parsedDir.length, 1);
    assert.strictEqual(parsedDir[0].id, "single1");

    // 3. Resolve image file
    const resolved = await flickr.resolveImageFile(tempDir, parsed[0]);
    assert.strictEqual(resolved, sampleImg);

    const missingResolved = await flickr.resolveImageFile(tempDir, parsed[1]);
    assert.strictEqual(missingResolved, undefined);

    // 4. Sync in dryRun mode
    const dryReport = await flickr.sync({
      exportPath: exportJsonPath,
      mediaDir: tempDir,
      dryRun: true
    });
    assert.strictEqual(dryReport.dryRun, true);
    assert.strictEqual(dryReport.totalParsed, 2);
    assert.strictEqual(dryReport.readyToPublish, 1);
    assert.strictEqual(dryReport.candidates[0].status, "READY");
    assert.strictEqual(dryReport.candidates[1].status, "IMAGE_NOT_FOUND");

    // 5. Sync live publishing mock
    await saveCredentials({
      userId: "u_flickr_test",
      idToken: "tok",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600000
    });

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("firebasestorage")) {
        return new Response(JSON.stringify({ downloadTokens: "token_flickr" }), { status: 200 });
      }
      if (urlStr.includes("api.sightengine.com")) {
        return new Response(JSON.stringify({ status: "success", nudity: { safe: 0.99 }, weapon: 0, recreational_drug: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    };

    const liveReport = await flickr.sync({
      exportPath: exportJsonPath,
      mediaDir: tempDir,
      dryRun: false,
      maxPhotos: 1,
      defaultTags: ["Analog", "Landscape"]
    });

    assert.strictEqual(liveReport.dryRun, false);
    assert.strictEqual(liveReport.readyToPublish, 1);
    assert(liveReport.candidates[0].publishResult?.postId);

    // Test duplicate detection when existing posts match caption
    const origGetProfile = client.getUserProfile;
    client.getUserProfile = async () => ({
      userId: "u_flickr_test",
      posts: [{ description: "Morning Mist over Lake\n\nTaken with Leica M6\nShot on Kodak Portra 400" }]
    });

    const dupReport = await flickr.sync({
      exportPath: exportJsonPath,
      mediaDir: tempDir,
      dryRun: true
    });
    client.getUserProfile = origGetProfile;
    assert.strictEqual(dupReport.candidates[0].status, "ALREADY_PUBLISHED");

    // Test fallback filename matching
    const prefixImg = path.join(tempDir, "prefix999_custom.jpg");
    await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toFile(prefixImg);
    const resolvedPrefix = await flickr.resolveImageFile(tempDir, { id: "prefix999", name: "", description: "", tags: [] });
    assert.strictEqual(resolvedPrefix, prefixImg);

    await clearCredentials();
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Flickr unit tests passed");
}
