import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { FotoClient } from "../../src/foto-client.js";
import { VscoSyncTool, mapVscoPresetToTags } from "../../src/sync/vsco.js";

export async function runVscoTests() {
  console.log("--- Testing VSCO Sync module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-vsco-test-"));
  const client = new FotoClient();
  const vscoTool = new VscoSyncTool(client);

  try {
    // 1. Test preset mapping heuristics
    assert.deepStrictEqual(mapVscoPresetToTags("B1"), ["Black and White", "Analog"]);
    assert.deepStrictEqual(mapVscoPresetToTags("KX4"), ["Black and White", "Analog"]);
    assert.deepStrictEqual(mapVscoPresetToTags("A6"), ["Analog", "Minimalist"]);
    assert.deepStrictEqual(mapVscoPresetToTags("M5"), ["Analog", "Minimalist"]);
    assert.deepStrictEqual(mapVscoPresetToTags("KP1"), ["Analog", "Film", "Color"]);
    assert.deepStrictEqual(mapVscoPresetToTags("C1"), ["Color", "Analog"]);
    assert.deepStrictEqual(mapVscoPresetToTags("T1"), ["Analog", "Fine Art"]);
    assert.deepStrictEqual(mapVscoPresetToTags("UNKNOWN_XYZ"), []);
    assert.deepStrictEqual(mapVscoPresetToTags(undefined), []);

    // 2. Create sample images and VSCO JSON export
    const img1 = path.join(tempDir, "vsco_1.jpg");
    const img2 = path.join(tempDir, "vsco_2.jpg");
    await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 90, g: 90, b: 90 } } })
      .jpeg()
      .toFile(img1);
    await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: 120, g: 110, b: 100 } } })
      .jpeg()
      .toFile(img2);

    const exportJsonPath = path.join(tempDir, "vsco_export.json");
    const vscoData = {
      media: [
        {
          id: "vsco_1",
          description: "Quiet afternoon shadows in Lisbon #street #minimal",
          preset: { code: "B5" },
          camera_make: "Leica",
          camera_model: "Q2",
          file: "vsco_1.jpg"
        },
        {
          id: "vsco_2",
          description: "Pacific coast highway at sunset",
          preset: "A6",
          journal_title: "California Coast",
          tags: ["coast", "golden hour"],
          file: "vsco_2.jpg"
        },
        {
          id: "vsco_missing",
          description: "Missing local file",
          preset: "C1",
          file: "not_here.jpg"
        }
      ]
    };

    await fs.writeFile(exportJsonPath, JSON.stringify(vscoData, null, 2), "utf-8");

    // 3. Dry-run sync
    const report = await vscoTool.sync({
      exportPath: exportJsonPath,
      mediaDir: tempDir,
      dryRun: true
    });

    assert.strictEqual(report.dryRun, true);
    assert.strictEqual(report.totalParsed, 3);
    assert.strictEqual(report.readyToPublish, 2);
    assert.strictEqual(report.candidates[0].status, "READY");
    assert(report.candidates[0].suggestedTags.includes("Black and White"));
    assert(!report.candidates[0].entry.description.includes("#street"), "Hashtags must be cleaned");
    assert.strictEqual(report.candidates[1].status, "READY");
    assert(report.candidates[1].suggestedTags.includes("Analog"));
    assert.strictEqual(report.candidates[2].status, "IMAGE_NOT_FOUND");

    // 4. Directory parsing mode
    const dirReport = await vscoTool.sync({
      exportPath: tempDir,
      dryRun: true
    });
    assert(dirReport.totalParsed >= 3);

    // 5. Test duplicate detection
    client.getUserProfile = async () => ({
      userId: "u_vsco",
      posts: [{ description: "Quiet afternoon shadows in Lisbon" }]
    });
    const dupReport = await vscoTool.sync({
      exportPath: exportJsonPath,
      mediaDir: tempDir,
      dryRun: true
    });
    assert.strictEqual(dupReport.candidates[0].status, "ALREADY_PUBLISHED");

    // 6. Test live publishing with mocked publishPost
    const origPublish = client.publishPost;
    try {
      client.publishPost = async () => ({ postId: "vsco_live_post" } as any);
      client.getUserProfile = async () => ({ userId: "u_vsco", posts: [] });

      const liveReport = await vscoTool.sync({
        exportPath: exportJsonPath,
        mediaDir: tempDir,
        dryRun: false,
        maxPhotos: 1,
        defaultTags: ["Street", "Minimalist"]
      });
      assert.strictEqual(liveReport.dryRun, false);
      assert.strictEqual(liveReport.candidates[0].status, "READY");
      assert.strictEqual(liveReport.candidates[0].publishResult?.postId, "vsco_live_post");
    } finally {
      client.publishPost = origPublish;
    }

    // 7. Test prefix filename resolution
    const prefixImg = path.join(tempDir, "vsco999_extra.jpg");
    await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toFile(prefixImg);
    const resolvedPrefix = await vscoTool.resolveImageFile(tempDir, { id: "vsco999", description: "", tags: [] });
    assert.strictEqual(resolvedPrefix, prefixImg);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ VSCO Sync unit tests passed");
}
