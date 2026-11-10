import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { WatchFolderService } from "../../src/sync/watcher.js";
import { FotoClient } from "../../src/foto-client.js";

export async function runWatcherTests() {
  console.log("--- Testing Watch Folder module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-watch-"));
  const client = new FotoClient();
  const watcher = new WatchFolderService(client);

  try {
    // 1. Error on non-directory or non-existent
    await assert.rejects(
      async () => {
        await watcher.scanWatchDirectory({ directoryPath: path.join(tempDir, "non_existent_folder") });
      },
      /does not exist/
    );

    // 2. Scan directory with photos
    const exportFolder = path.join(tempDir, "lightroom_exports");
    await fs.mkdir(exportFolder, { recursive: true });

    // Write sample photos
    await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: { r: 50, g: 70, b: 90 } }
    }).jpeg().toFile(path.join(exportFolder, "tokyo_rain_street.jpg"));

    await sharp({
      create: { width: 1200, height: 1600, channels: 3, background: { r: 120, g: 90, b: 60 } }
    }).png().toFile(path.join(exportFolder, "studio_portrait_session.png"));

    // Also write non-image file that should be ignored
    await fs.writeFile(path.join(exportFolder, "notes.txt"), "Camera settings log");

    const report = await watcher.scanWatchDirectory({
      directoryPath: exportFolder,
      includePreview: true
    });

    assert.strictEqual(report.totalImagesFound, 2);
    assert.strictEqual(report.drafts.length, 2);

    const tokyoDraft = report.drafts.find(d => d.fileName.includes("tokyo_rain"));
    assert(tokyoDraft);
    assert(tokyoDraft.readyToPublish);
    assert(tokyoDraft.suggestedTags.length > 0);
    assert(tokyoDraft.inspection.previewBase64);

    // 3. Scan with preview disabled
    const noPrevReport = await watcher.scanWatchDirectory({
      directoryPath: exportFolder,
      includePreview: false
    });
    assert.strictEqual(noPrevReport.totalImagesFound, 2);
    assert.strictEqual(noPrevReport.drafts[0].inspection.previewBase64, undefined);

    // 4. Scan with XMP sidecar rating & color label filtering
    await fs.writeFile(
      path.join(exportFolder, "tokyo_rain_street.xmp"),
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmp:Rating="5" xmp:Label="Green"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Shinjuku Neon</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>`,
      "utf-8"
    );

    const ratedReport = await watcher.scanWatchDirectory({
      directoryPath: exportFolder,
      includePreview: false,
      minRating: 4,
      colorLabel: "Green"
    });
    assert.strictEqual(ratedReport.drafts.length, 1);
    assert.strictEqual(ratedReport.filteredOutByXmp, 1);
    assert(ratedReport.drafts[0].suggestedCaption?.includes("Shinjuku Neon"));
    assert.strictEqual(ratedReport.drafts[0].xmp?.rating, 5);

  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Watch Folder unit tests passed");
}
