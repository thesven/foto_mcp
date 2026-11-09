import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { validateTags, searchTags, suggestTags, FOTO_ALLOWED_TAGS } from "../src/tags.js";
import { inspectImage, prepareImageForUpload } from "../src/media/processor.js";
import { FotoClient } from "../src/foto-client.js";
import { generateFotoPostId } from "../src/api/firestore.js";
import { getAuthStatus } from "../src/api/auth.js";

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

  // Clean up test files
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log("\n=== All Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
