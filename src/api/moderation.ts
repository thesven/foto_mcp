import { SIGHTENGINE_CONFIG, PLATFORM_LIMITS } from "../config.js";

export interface ModerationResult {
  passed: boolean;
  sexualActivity: number;
  sexualDisplay: number;
  erotica: number;
  nudityRating: number;
  rawResponse?: any;
  failureReason?: string;
}

/**
 * Checks an uploaded image URL against Sightengine moderation API matching Foto client behavior.
 */
export async function checkContentModeration(imageUrl: string): Promise<ModerationResult> {
  const params = new URLSearchParams({
    url: imageUrl,
    models: SIGHTENGINE_CONFIG.models,
    api_user: SIGHTENGINE_CONFIG.apiUser,
    api_secret: SIGHTENGINE_CONFIG.apiSecret
  });

  const response = await fetch(`${SIGHTENGINE_CONFIG.endpoint}?${params.toString()}`, {
    method: "GET"
  });

  const data = (await response.json()) as any;

  if (!response.ok || data.status === "failure") {
    // If moderation fails or times out, report gracefully
    const msg = data.error?.message || response.statusText || "Sightengine check failed";
    return {
      passed: false,
      sexualActivity: 0,
      sexualDisplay: 0,
      erotica: 0,
      nudityRating: -1,
      failureReason: `Moderation check failed: ${msg}`,
      rawResponse: data
    };
  }

  const nudity = data.nudity || {};
  const sexualActivity = typeof nudity.sexual_activity === "number" ? nudity.sexual_activity : 0;
  const sexualDisplay = typeof nudity.sexual_display === "number" ? nudity.sexual_display : 0;
  const erotica = typeof nudity.erotica === "number" ? nudity.erotica : 0;

  // Foto threshold: sexual_activity <= 0.7, sexual_display <= 0.9
  const passed =
    sexualActivity <= PLATFORM_LIMITS.sightengineMaxSexualActivity &&
    sexualDisplay <= PLATFORM_LIMITS.sightengineMaxSexualDisplay;

  let failureReason: string | undefined;
  if (!passed) {
    failureReason = `Image exceeded Foto community guidelines thresholds (activity=${sexualActivity.toFixed(2)}, display=${sexualDisplay.toFixed(2)}).`;
  }

  // Composite nudity rating stored in Firestore (max score)
  const nudityRating = Math.max(sexualActivity, sexualDisplay, erotica);

  return {
    passed,
    sexualActivity,
    sexualDisplay,
    erotica,
    nudityRating,
    failureReason,
    rawResponse: data
  };
}
