process.env.NODE_ENV = "test";
process.env.FOTO_MCP_TEST = "true";

import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.FOTO_CONFIG_DIR = path.join(os.tmpdir(), `foto-mcp-test-${Date.now()}`);
import sharp from "sharp";
import { validateTags, searchTags, suggestTags, FOTO_ALLOWED_TAGS } from "../src/tags.js";
import { inspectImage, prepareImageForUpload } from "../src/media/processor.js";
import { FotoClient } from "../src/foto-client.js";
import { generateFotoPostId } from "../src/api/firestore.js";
import { getAuthStatus } from "../src/api/auth.js";
import { parseInstagramPostsHtml } from "../src/sync/instagram.js";

import { runFirestoreTests } from "./unit/firestore.test.js";
import { runAuthTests } from "./unit/auth.test.js";
import { runStorageTests } from "./unit/storage.test.js";
import { runModerationTests } from "./unit/moderation.test.js";
import { runProcessorTests } from "./unit/processor.test.js";
import { runTagTests } from "./unit/tags.test.js";
import { runFotoClientTests } from "./unit/foto-client.test.js";
import { runInstagramTests } from "./unit/instagram.test.js";
import { runFlickrTests } from "./unit/flickr.test.js";
import { runVaultTests } from "./unit/vault.test.js";
import { runWatcherTests } from "./unit/watcher.test.js";
import { runXmpTests } from "./unit/xmp.test.js";
import { runVscoTests } from "./unit/vsco.test.js";
import { runQueueTests } from "./unit/queue.test.js";
import { runMcpServerTests } from "./unit/mcp-server.test.js";

async function runTests() {
  console.log("=== Running Foto MCP Test Suite ===\n");

  // Test 1: Tag Whitelist & Validation
  console.log("Test 1: Tag validation & whitelist check");
  assert.strictEqual(FOTO_ALLOWED_TAGS.length, 303, "Must have exactly 303 curated tags");

  const validTest = validateTags(["35mm", "Analog", "Street"]);
  assert.strictEqual(validTest.valid, true, "Valid tags must pass");
  assert.deepStrictEqual(validTest.canonicalTags, ["35mm", "Analog", "Street"]);

  // Case-insensitive normalization
  const caseTest = validateTags(["analog", "STREET", "golden hour"]);
  assert.strictEqual(caseTest.valid, true);
  assert.deepStrictEqual(caseTest.canonicalTags, ["Analog", "Street", "Golden Hour"]);

  // Tag count boundaries
  const zeroTags = validateTags([]);
  assert.strictEqual(zeroTags.valid, false, "0 tags must fail");

  const fourTags = validateTags(["35mm", "Street", "Analog", "Portrait"]);
  assert.strictEqual(fourTags.valid, false, "4 tags must fail (Foto max 3)");

  const invalidTagTest = validateTags(["#instalike", "fake_tag"]);
  assert.strictEqual(invalidTagTest.valid, false, "Non-curated tags must fail");
  console.log("  ✓ Tag validation tests passed");

  // Test 2: Tag Search & Auto-Suggestion
  console.log("\nTest 2: Tag search & suggestion");
  const filmMatches = searchTags("film");
  assert(filmMatches.length > 0, "Must find film tags");
  assert(filmMatches.includes("Film") || filmMatches.includes("Instant Film"));

  const suggestions = suggestTags({
    caption: "Misty morning walking through redwoods during golden hour",
    cameraInfo: "Hasselblad 500C/M on Kodak Portra 400"
  });
  console.log("  Suggested tags for sample caption:", suggestions.suggestedTags);
  console.log("  Explanation:", suggestions.explanation);
  assert(suggestions.suggestedTags.length >= 1 && suggestions.suggestedTags.length <= 3);
  assert(suggestions.suggestedTags.includes("Medium Format") || suggestions.suggestedTags.includes("Analog"));
  console.log("  ✓ Tag search & suggestion tests passed");

  // Test 3: Post ID Generation
  console.log("\nTest 3: Post ID generation algorithm");
  const testUserId = "Q7rrA5L9okTVO4g36bsTZUEZ2Cu2";
  const postId = generateFotoPostId(testUserId);
  console.log("  Generated Post ID:", postId);
  assert(postId.includes(testUserId), "Post ID must include userId");
  assert.match(postId, /^\d{14}-[a-zA-Z0-9]+-[a-zA-Z0-9]{8}$/, "Matches yyyyMMddHHmmss-<userId>-<8alnum>");
  console.log("  ✓ Post ID generation passed");

  // Test 4: Image Processing & Resizing
  console.log("\nTest 4: Image inspection & upload preparation");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-test-"));
  const testImagePath = path.join(tempDir, "sample_landscape.jpg");

  // Generate a mock 3000x2000 (3:2) photo using sharp
  await sharp({
    create: {
      width: 3000,
      height: 2000,
      channels: 3,
      background: { r: 120, g: 150, b: 180 }
    }
  })
    .jpeg({ quality: 90 })
    .toFile(testImagePath);

  const inspection = await inspectImage(testImagePath);
  console.log(`  Inspected image: ${inspection.originalWidth}x${inspection.originalHeight} (${inspection.aspectRatioFormatted})`);
  assert.strictEqual(inspection.originalWidth, 3000);
  assert.strictEqual(inspection.originalHeight, 2000);
  assert.strictEqual(inspection.aspectRatioFormatted, "3:2 (Landscape)");
  assert.strictEqual(inspection.targetUploadDimensions.width, 1820);
  assert.strictEqual(inspection.targetUploadDimensions.height, 1213);

  const prepared = await prepareImageForUpload(testImagePath);
  console.log(`  Prepared for upload: ${prepared.width}x${prepared.height}px, ${(prepared.fileSizeBytes / 1024).toFixed(1)} KB`);
  assert.strictEqual(prepared.width, 1820);
  assert.strictEqual(prepared.height, 1213);
  assert(prepared.buffer.length > 0);
  console.log("  ✓ Image processing tests passed");

  // Test 5: Client Dry-Run Post Creation
  console.log("\nTest 5: Client Dry-Run single post creation");
  const client = new FotoClient();
  const dryRunResult = await client.publishPost({
    filePath: testImagePath,
    caption: "Morning fog drifting across the bay. Pentax 67 on Tri-X 400.",
    tags: ["Medium Format", "Analog", "Fog"],
    dryRun: true
  });

  console.log("  Dry run result:", dryRunResult.message);
  assert.strictEqual(dryRunResult.success, true);
  assert.strictEqual(dryRunResult.dryRun, true);
  assert.strictEqual(dryRunResult.dimensions.width, 1820);
  assert.deepStrictEqual(dryRunResult.tags, ["Medium Format", "Analog", "Fog"]);
  console.log("  ✓ Dry-run single post passed");

  // Test 6: Client Dry-Run Series Creation
  console.log("\nTest 6: Client Dry-Run multi-image series");
  const testImage2 = path.join(tempDir, "sample_portrait.jpg");
  await sharp({
    create: {
      width: 2000,
      height: 2500, // 4:5 vertical
      channels: 3,
      background: { r: 80, g: 90, b: 100 }
    }
  })
    .jpeg({ quality: 90 })
    .toFile(testImage2);

  const seriesResult = await client.publishSeries({
    filePaths: [testImagePath, testImage2],
    caption: "A study of light and shade in two frames.",
    tags: ["Black and White", "Fine Art"],
    dryRun: true
  });

  console.log("  Dry run series result:", seriesResult.message);
  assert.strictEqual(seriesResult.success, true);
  assert.strictEqual(seriesResult.dryRun, true);
  assert.strictEqual(seriesResult.imageCount, 2);
  console.log("  ✓ Dry-run series passed");

  // Test 7: Auth Status (Unauthenticated initial state)
  console.log("\nTest 7: Auth status check");
  const authStatus = await getAuthStatus();
  console.log("  Auth status:", authStatus.message);
  assert(typeof authStatus.loggedIn === "boolean");
  console.log("  ✓ Auth status passed");

  // Test 8: Draft Post preview validation
  console.log("\nTest 8: Draft post validation");
  const draft = await client.draftPost({
    filePath: testImagePath,
    caption: "A quiet moment in the mountains.",
    tags: ["Landscape", "Mountains"]
  });
  assert.strictEqual(draft.readyToPublish, true);
  assert.strictEqual(draft.canonicalTags.length, 2);
  assert.strictEqual(draft.dimensions.uploadTargetWidth, 1820);
  console.log("  ✓ Draft post validation passed");

  // Test 9: Series boundaries enforcement (reject < 2 or > 5)
  console.log("\nTest 9: Series image count boundaries");
  await assert.rejects(
    async () => {
      await client.publishSeries({
        filePaths: [testImagePath],
        caption: "Only one image",
        tags: ["Landscape"],
        dryRun: true
      });
    },
    /at least 2 photos/,
    "Must reject series with fewer than 2 images"
  );

  await assert.rejects(
    async () => {
      await client.publishSeries({
        filePaths: [testImagePath, testImagePath, testImagePath, testImagePath, testImagePath, testImagePath],
        caption: "Six images",
        tags: ["Landscape"],
        dryRun: true
      });
    },
    /maximum of 5 photos/,
    "Must reject series with more than 5 images"
  );
  console.log("  ✓ Series boundary checks passed");

  // Test 10: Instagram export HTML parsing
  console.log("\nTest 10: Instagram HTML export parsing");
  const mockInstagramHtml = `
    <div class="uiBoxWhite">
      <h2>Mallard Drake on the Grand River&#039;s edge.&#10;&#10;📷 300mm · f/2.8 · 1/1000s&#10;&#10;#bird #wildlife #nature #canon</h2>
      <img src="media/posts/202611/duck.jpg" />
      <div>Latitude</div><div><div class="_a6-q">43.4516</div></div>
      <div>Longitude</div><div><div class="_a6-q">-80.4925</div></div>
      <div class="_3-94 _a6-o">Nov 9, 2026 8:00am</div></div>
    </div>
  `;
  const parsedInstagram = parseInstagramPostsHtml(mockInstagramHtml);
  assert.strictEqual(parsedInstagram.length, 1);
  assert.strictEqual(parsedInstagram[0].title, "Mallard Drake on the Grand River's edge.");
  assert.strictEqual(parsedInstagram[0].imageFileName, "duck.jpg");
  assert.strictEqual(parsedInstagram[0].gpsDetected?.lat, 43.4516);
  assert.deepStrictEqual(parsedInstagram[0].hashtags, ["bird", "wildlife", "nature", "canon"]);
  assert(parsedInstagram[0].cleanedCaption.includes("📷 300mm · f/2.8 · 1/1000s"));
  assert(!parsedInstagram[0].cleanedCaption.includes("#bird"), "Hashtags must be scrubbed from caption");
  console.log("  ✓ Instagram export HTML parsing passed");

  // Clean up test files
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log("\n=== Running Modular Unit Test Suites ===");
  await runFirestoreTests();
  await runAuthTests();
  await runStorageTests();
  await runModerationTests();
  await runProcessorTests();
  await runTagTests();
  await runFotoClientTests();
  await runInstagramTests();
  await runFlickrTests();
  await runVaultTests();
  await runWatcherTests();
  await runXmpTests();
  await runVscoTests();
  await runQueueTests();
  await runMcpServerTests();

  console.log("\n=== All Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
