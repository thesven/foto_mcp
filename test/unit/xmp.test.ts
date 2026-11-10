import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { parseXmpString, findXmpSidecarForImage, parseXmpFile } from "../../src/media/xmp.js";
import { inspectImage, prepareImageForUpload } from "../../src/media/processor.js";

export async function runXmpTests() {
  console.log("--- Testing XMP Sidecar Parser module ---");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "foto-xmp-test-"));

  try {
    // 1. Parse attribute-based Lightroom XMP string
    const sampleLightroomXmp = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      xmp:Rating="5"
      xmp:Label="Select"
      tiff:Make="FUJIFILM"
      tiff:Model="X-T5"
      aux:Lens="XF35mmF1.4 R"
      crs:CameraProfile="Camera Classic Chrome"
      AnalogExif:Film="Kodak Portra 400">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">Shinjuku Neon Rain</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">Reflections on wet asphalt at midnight &amp; neon glow.</rdf:li>
        </rdf:Alt>
      </dc:description>
      <dc:rights>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">Copyright 2026 Studio</rdf:li>
        </rdf:Alt>
      </dc:rights>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>Alex Photographer</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:subject>
        <rdf:Bag>
          <rdf:li>street</rdf:li>
          <rdf:li>night</rdf:li>
        </rdf:Bag>
      </dc:subject>
      <lr:hierarchicalSubject>
        <rdf:Bag>
          <rdf:li>Genre|Street|Urban</rdf:li>
        </rdf:Bag>
      </lr:hierarchicalSubject>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

    const parsed = parseXmpString(sampleLightroomXmp, "sample.xmp");
    assert.strictEqual(parsed.rating, 5);
    assert.strictEqual(parsed.colorLabel, "Select");
    assert.strictEqual(parsed.title, "Shinjuku Neon Rain");
    assert.strictEqual(parsed.description, "Reflections on wet asphalt at midnight & neon glow.");
    assert.strictEqual(parsed.cameraMake, "FUJIFILM");
    assert.strictEqual(parsed.cameraModel, "X-T5");
    assert.strictEqual(parsed.lensModel, "XF35mmF1.4 R");
    assert.strictEqual(parsed.filmSimulation, "Camera Classic Chrome");
    assert.strictEqual(parsed.filmStock, "Kodak Portra 400");
    assert.strictEqual(parsed.copyright, "Copyright 2026 Studio");
    assert.strictEqual(parsed.creator, "Alex Photographer");
    assert(parsed.keywords.includes("street"));
    assert(parsed.keywords.includes("Urban"));
    assert(parsed.suggestedTags.includes("Analog"));

    // 2. Parse element-based Capture One / Darktable XMP file & sidecar discovery
    const imgPath = path.join(tempDir, "DSC0042.jpg");
    const xmpPath = path.join(tempDir, "DSC0042.xmp");

    await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 60, g: 70, b: 80 } }
    })
      .jpeg()
      .toFile(imgPath);

    await fs.writeFile(
      xmpPath,
      `<x:xmpmeta><rdf:RDF><rdf:Description><xmp:Rating>4</xmp:Rating><xmp:Label>Green</xmp:Label><tiff:Make>Leica</tiff:Make><tiff:Model>M11</tiff:Model></rdf:Description></rdf:RDF></x:xmpmeta>`,
      "utf-8"
    );

    const foundSidecar = await findXmpSidecarForImage(imgPath);
    assert.strictEqual(foundSidecar, xmpPath);

    const parsedFromImg = await parseXmpFile(imgPath);
    assert.strictEqual(parsedFromImg.rating, 4);
    assert.strictEqual(parsedFromImg.colorLabel, "Green");
    assert.strictEqual(parsedFromImg.cameraMake, "Leica");

    // 3. Verify inspectImage automatically attaches xmp metadata and prepareImageForUpload embeds sRGB ICC
    const inspection = await inspectImage(imgPath, { preview: false });
    assert(inspection.xmp);
    assert.strictEqual(inspection.xmp.rating, 4);
    assert.strictEqual(inspection.exif.Make, "Leica");

    const prepared = await prepareImageForUpload(imgPath);
    const preparedMeta = await sharp(prepared.buffer).metadata();
    assert.strictEqual(Boolean(preparedMeta.icc), true, "Prepared image must embed sRGB ICC profile");

    // 4. Error when no sidecar exists
    const noSidecarImg = path.join(tempDir, "lonely.jpg");
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 10, b: 10 } }
    })
      .jpeg()
      .toFile(noSidecarImg);

    const notFound = await findXmpSidecarForImage(noSidecarImg);
    assert.strictEqual(notFound, null);

    await assert.rejects(
      async () => {
        await parseXmpFile(noSidecarImg);
      },
      /No \.xmp sidecar file found/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("  ✓ XMP Sidecar Parser unit tests passed");
}
