import assert from "node:assert";
import { formatFotoTimestamp, uploadImageToFotoStorage } from "../../src/api/storage.js";

export async function runStorageTests() {
  console.log("--- Testing Storage API module ---");

  // 1. formatFotoTimestamp
  const testDate = new Date(2026, 10, 9, 14, 5, 9); // Month is 0-indexed: 10 = Nov
  const formatted = formatFotoTimestamp(testDate);
  assert.strictEqual(formatted, "20261109140509");

  const defaultFormatted = formatFotoTimestamp();
  assert.match(defaultFormatted, /^\d{14}$/);

  // 2. uploadImageToFotoStorage - Success (with customImageId and folder)
  const originalFetch = globalThis.fetch;
  const mockBuffer = Buffer.from("fake-jpeg-data");

  try {
    globalThis.fetch = async (url: any, init: any) => {
      assert(String(url).includes("firebasestorage.googleapis.com"));
      assert.strictEqual(init.headers["Content-Type"], "image/jpeg");
      return new Response(
        JSON.stringify({
          name: "posts/u1/custom-id_20261109140509",
          downloadTokens: "download-token-abc"
        }),
        { status: 200 }
      );
    };

    const result = await uploadImageToFotoStorage({
      buffer: mockBuffer,
      userId: "u1",
      idToken: "tok",
      folder: "portfolios",
      customImageId: "custom-id"
    });

    assert.strictEqual(result.imageId, "custom-id");
    assert(result.imagePath.startsWith("portfolios/u1/custom-id_"));
    assert(result.imageUrl.includes("download-token-abc"));
    assert.strictEqual(result.fileSizeBytes, mockBuffer.length);

    // 3. uploadImageToFotoStorage - Success (default folder 'posts', no custom id, auto downloadToken)
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          name: "posts/u1/auto_20261109140509"
          // omit downloadTokens to test crypto.randomUUID fallback
        }),
        { status: 200 }
      );
    };

    const defaultResult = await uploadImageToFotoStorage({
      buffer: mockBuffer,
      userId: "u1",
      idToken: "tok"
    });

    assert(defaultResult.imagePath.startsWith("posts/u1/"));
    assert(defaultResult.imageUrl.includes("alt=media&token="));

    // 4. uploadImageToFotoStorage - Error handling
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: { message: "Storage quota exceeded" }
        }),
        { status: 403 }
      );
    };

    await assert.rejects(
      async () => {
        await uploadImageToFotoStorage({
          buffer: mockBuffer,
          userId: "u1",
          idToken: "tok"
        });
      },
      /Failed to upload image to Foto Storage: Storage quota exceeded/
    );

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("  ✓ Storage unit tests passed");
}
