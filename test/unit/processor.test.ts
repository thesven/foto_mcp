import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { inspectImage, prepareImageForUpload, generateImagePreview, prepareAvatarImage } from "../../src/media/processor.js";

export async function runProcessorTests() {
  console.log("--- Testing Media Processor module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-mcp-proc-"));

  try {
    // 1. Generate images of varying aspect ratios
    // 1:1 Square
    const squarePath = path.join(tempDir, "square.jpg");
    await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 100, g: 100, b: 100 } } }).jpeg().toFile(squarePath);
    const squareInsp = await inspectImage(squarePath);
    assert.strictEqual(squareInsp.aspectRatioFormatted, "1:1");
    assert.strictEqual(squareInsp.targetUploadDimensions.width, 1000);
    assert.strictEqual(squareInsp.targetUploadDimensions.height, 1000);

    // 2:3 Portrait (vertical)
    const portraitPath = path.join(tempDir, "portrait_2_3.jpg");
    await sharp({ create: { width: 2000, height: 3000, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(portraitPath);
    const portraitInsp = await inspectImage(portraitPath);
    assert.strictEqual(portraitInsp.aspectRatioFormatted, "2:3 (Portrait)");
    assert.strictEqual(portraitInsp.targetUploadDimensions.height, 1820);
    assert.strictEqual(portraitInsp.targetUploadDimensions.width, 1213);

    // 4:3 Landscape
    const fourThreePath = path.join(tempDir, "four_three.jpg");
    await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(fourThreePath);
    const fourThreeInsp = await inspectImage(fourThreePath);
    assert.strictEqual(fourThreeInsp.aspectRatioFormatted, "4:3 (Landscape)");
    assert.strictEqual(fourThreeInsp.targetUploadDimensions.width, 1820);

    // 3:4 Portrait
    const threeFourPath = path.join(tempDir, "three_four.jpg");
    await sharp({ create: { width: 1800, height: 2400, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(threeFourPath);
    const threeFourInsp = await inspectImage(threeFourPath);
    assert.strictEqual(threeFourInsp.aspectRatioFormatted, "3:4 (Portrait)");

    // 16:9 Landscape
    const widePath = path.join(tempDir, "wide.jpg");
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(widePath);
    const wideInsp = await inspectImage(widePath);
    assert.strictEqual(wideInsp.aspectRatioFormatted, "16:9 (Landscape)");

    // 9:16 Portrait
    const verticalWidePath = path.join(tempDir, "vertical_wide.jpg");
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(verticalWidePath);
    const verticalWideInsp = await inspectImage(verticalWidePath);
    assert.strictEqual(verticalWideInsp.aspectRatioFormatted, "9:16 (Portrait)");

    // 6:7 Landscape
    const sixSevenPath = path.join(tempDir, "six_seven.jpg");
    await sharp({ create: { width: 7000, height: 6000, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(sixSevenPath);
    const sixSevenInsp = await inspectImage(sixSevenPath);
    assert.strictEqual(sixSevenInsp.aspectRatioFormatted, "6:7 (Landscape)");

    // 7:6 Portrait
    const sevenSixPath = path.join(tempDir, "seven_six.jpg");
    await sharp({ create: { width: 6000, height: 7000, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(sevenSixPath);
    const sevenSixInsp = await inspectImage(sevenSixPath);
    assert.strictEqual(sevenSixInsp.aspectRatioFormatted, "7:6 (Portrait)");

    // 65:24 Panoramic (e.g. Hasselblad XPan)
    const xpanPath = path.join(tempDir, "xpan.jpg");
    await sharp({ create: { width: 6500, height: 2400, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(xpanPath);
    const xpanInsp = await inspectImage(xpanPath);
    assert.strictEqual(xpanInsp.aspectRatioFormatted, "65:24 (Panoramic)");

    // Non-standard landscape (e.g. 2.1:1)
    const customRatioPath = path.join(tempDir, "custom_ratio.jpg");
    await sharp({ create: { width: 2100, height: 1000, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(customRatioPath);
    const customInsp = await inspectImage(customRatioPath);
    assert.strictEqual(customInsp.aspectRatioFormatted, "2.10:1");

    // Non-standard portrait (e.g. 1:2.10)
    const customPortraitPath = path.join(tempDir, "custom_portrait.jpg");
    await sharp({ create: { width: 1000, height: 2100, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toFile(customPortraitPath);
    const customPortraitInsp = await inspectImage(customPortraitPath);
    // EXIF orientation (orientation 6: Rotate 90 CW - storage 3000x2000 becomes 2000x3000 portrait)
    const orientedPath = path.join(tempDir, "oriented_exif_6.jpg");
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 60, g: 70, b: 80 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(orientedPath);
    const orientedInsp = await inspectImage(orientedPath);
    assert.strictEqual(orientedInsp.originalWidth, 2000);
    assert.strictEqual(orientedInsp.originalHeight, 3000);
    assert.strictEqual(orientedInsp.aspectRatioFormatted, "2:3 (Portrait)");
    assert.strictEqual(orientedInsp.targetUploadDimensions.width, 1213);
    assert.strictEqual(orientedInsp.targetUploadDimensions.height, 1820);

    const orientedPrepared = await prepareImageForUpload(orientedPath);
    assert.strictEqual(orientedPrepared.width, 1213);
    assert.strictEqual(orientedPrepared.height, 1820);
    const gifPath = path.join(tempDir, "animation.gif");
    await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } }).gif().toFile(gifPath);
    const gifInsp = await inspectImage(gifPath);
    assert.strictEqual(gifInsp.supportedFormat, false);
    assert(gifInsp.warning?.includes("Foto does not allow GIF images"));

    // prepareImageForUpload with GIF throws
    await assert.rejects(
      async () => {
        await prepareImageForUpload(gifPath);
      },
      /Foto does not allow GIF images/
    );

    // Unsupported format warning (SVG/BMP)
    const svgPath = path.join(tempDir, "vector.svg");
    await fs.writeFile(svgPath, "<svg width='100' height='100'></svg>");
    const svgInsp = await inspectImage(svgPath);
    assert.strictEqual(svgInsp.supportedFormat, false);
    assert(svgInsp.warning?.includes("might need conversion"));

    // 3. prepareImageForUpload with valid image
    const prepared = await prepareImageForUpload(portraitPath);
    assert.strictEqual(prepared.width, 1213);
    assert.strictEqual(prepared.height, 1820);
    assert(prepared.buffer.length > 0);
    assert.strictEqual(typeof prepared.hasStrippedGps, "boolean");

    // 4. Multimodal Preview & color space tests
    const preview = await generateImagePreview(portraitPath, 200);
    assert(typeof preview.base64 === "string" && preview.base64.length > 0);
    assert.strictEqual(preview.mimeType, "image/jpeg");
    assert(preview.width <= 200 && preview.height <= 200);

    const inspWithPreview = await inspectImage(squarePath, { preview: true });
    assert(typeof inspWithPreview.previewBase64 === "string");
    assert(typeof inspWithPreview.colorSpace === "string");

    const inspNoPreview = await inspectImage(squarePath, { preview: false });
    assert.strictEqual(inspNoPreview.previewBase64, undefined);

    // 5. prepareAvatarImage test (400x400 square crop, JPEG)
    const avatarBuf = await prepareAvatarImage(portraitPath);
    const avatarMeta = await sharp(avatarBuf).metadata();
    assert.strictEqual(avatarMeta.width, 400);
    assert.strictEqual(avatarMeta.height, 400);
    assert.strictEqual(avatarMeta.format, "jpeg");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ Media Processor unit tests passed");
}
