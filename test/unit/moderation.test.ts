import assert from "node:assert";
import { checkContentModeration } from "../../src/api/moderation.js";

export async function runModerationTests() {
  console.log("--- Testing Moderation API module ---");

  const originalFetch = globalThis.fetch;

  try {
    // 1. Pass: clean photo
    globalThis.fetch = async (url: any) => {
      assert(String(url).includes("api.sightengine.com"));
      return new Response(
        JSON.stringify({
          status: "success",
          nudity: {
            sexual_activity: 0.05,
            sexual_display: 0.1,
            erotica: 0.02
          }
        }),
        { status: 200 }
      );
    };

    const cleanResult = await checkContentModeration("https://img.jpg");
    assert.strictEqual(cleanResult.passed, true);
    assert.strictEqual(cleanResult.sexualActivity, 0.05);
    assert.strictEqual(cleanResult.sexualDisplay, 0.1);
    assert.strictEqual(cleanResult.nudityRating, 0.1);
    assert.strictEqual(cleanResult.failureReason, undefined);

    // 2. Reject: sexual activity exceeds 0.7
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          status: "success",
          nudity: {
            sexual_activity: 0.85,
            sexual_display: 0.2,
            erotica: 0.5
          }
        }),
        { status: 200 }
      );
    };

    const rejectedActivity = await checkContentModeration("https://unsafe1.jpg");
    assert.strictEqual(rejectedActivity.passed, false);
    assert(rejectedActivity.failureReason?.includes("activity=0.85"));

    // 3. Reject: sexual display exceeds 0.9
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          status: "success",
          nudity: {
            sexual_activity: 0.1,
            sexual_display: 0.95,
            erotica: 0.2
          }
        }),
        { status: 200 }
      );
    };

    const rejectedDisplay = await checkContentModeration("https://unsafe2.jpg");
    assert.strictEqual(rejectedDisplay.passed, false);
    assert(rejectedDisplay.failureReason?.includes("display=0.95"));

    // 4. API failure / error response
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          status: "failure",
          error: { message: "Invalid image URL" }
        }),
        { status: 400 }
      );
    };

    const apiError = await checkContentModeration("https://bad.jpg");
    assert.strictEqual(apiError.passed, false);
    assert.strictEqual(apiError.nudityRating, -1);
    assert(apiError.failureReason?.includes("Moderation check failed: Invalid image URL"));

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("  ✓ Moderation unit tests passed");
}
