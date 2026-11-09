import crypto from "node:crypto";
import { inspectImage, prepareImageForUpload, ImageInspection, PreparedImage } from "./media/processor.js";
import { validateTags, suggestTags, searchTags } from "./tags.js";
import { getValidAuthSession, getAuthStatus } from "./api/auth.js";
import { uploadImageToFotoStorage } from "./api/storage.js";
import { checkContentModeration } from "./api/moderation.js";
import {
  generateFotoPostId,
  savePrivateMetadata,
  savePostDocument,
  appendPostToUserProfile,
  indexPostTags,
  fetchUserProfile
} from "./api/firestore.js";
import { PLATFORM_LIMITS } from "./config.js";

export interface PublishPostParams {
  filePath: string;
  caption: string;
  tags: string[];
  dryRun?: boolean;
}

export interface PublishSeriesParams {
  filePaths: string[];
  caption: string;
  tags: string[];
  dryRun?: boolean;
}

export interface PublishResult {
  success: boolean;
  dryRun: boolean;
  postId: string;
  postUrl?: string;
  userId?: string;
  caption: string;
  tags: string[];
  dimensions: { width: number; height: number; aspectRatio: number };
  imageUrl?: string;
  exif: Record<string, any>;
  hasStrippedGps: boolean;
  moderationScore?: number;
  message: string;
}

export interface PublishSeriesResult {
  success: boolean;
  dryRun: boolean;
  postId: string;
  postUrl?: string;
  userId?: string;
  caption: string;
  tags: string[];
  imageCount: number;
  images: Array<{
    imageId: string;
    width: number;
    height: number;
    imageUrl?: string;
  }>;
  message: string;
}

export class FotoClient {
  /**
   * Inspects a local image file without modifying or uploading it
   */
  async inspectPhoto(filePath: string): Promise<ImageInspection> {
    return await inspectImage(filePath);
  }

  /**
   * Previews a post draft with tag validation and EXIF summary
   */
  async draftPost(params: {
    filePath: string;
    caption: string;
    tags: string[];
  }) {
    const tagValidation = validateTags(params.tags);
    const inspection = await inspectImage(params.filePath);

    return {
      filePath: params.filePath,
      caption: params.caption,
      tagValidation,
      canonicalTags: tagValidation.canonicalTags,
      dimensions: {
        originalWidth: inspection.originalWidth,
        originalHeight: inspection.originalHeight,
        aspectRatioFormatted: inspection.aspectRatioFormatted,
        uploadTargetWidth: inspection.targetUploadDimensions.width,
        uploadTargetHeight: inspection.targetUploadDimensions.height
      },
      hasGps: inspection.hasGps,
      exifSummary: inspection.exif,
      readyToPublish: tagValidation.valid && inspection.supportedFormat,
      warnings: [
        ...(inspection.warning ? [inspection.warning] : []),
        ...(tagValidation.error ? [tagValidation.error] : []),
        ...(inspection.hasGps ? ["GPS coordinates detected in photo. They will be automatically removed for privacy upon publishing."] : [])
      ]
    };
  }

  /**
   * Publishes a single photo post to Foto
   */
  async publishPost(params: PublishPostParams): Promise<PublishResult> {
    const { filePath, caption, tags, dryRun = false } = params;

    // 1. Validate tags
    const tagValidation = validateTags(tags);
    if (!tagValidation.valid) {
      throw new Error(`Tag validation failed: ${tagValidation.error}`);
    }
    const validatedTags = tagValidation.canonicalTags;

    // 2. Prepare image (resize to max 1820px, JPEG 80, strip GPS, extract EXIF)
    const prepared = await prepareImageForUpload(filePath);

    // Dry Run mode
    if (dryRun) {
      const simulatedPostId = generateFotoPostId("SIMULATED_USER");
      return {
        success: true,
        dryRun: true,
        postId: simulatedPostId,
        caption,
        tags: validatedTags,
        dimensions: {
          width: prepared.width,
          height: prepared.height,
          aspectRatio: prepared.aspectRatio
        },
        imageUrl: `[SIMULATED_FIREBASE_STORAGE_URL: ${prepared.width}x${prepared.height}]`,
        exif: prepared.exif,
        hasStrippedGps: prepared.hasStrippedGps,
        moderationScore: 0.01,
        message: `[DRY RUN] Post successfully validated! Image prepared to ${prepared.width}x${prepared.height}px (${(prepared.fileSizeBytes / 1024).toFixed(1)} KB). GPS scrubbed: ${prepared.hasStrippedGps}. 0 API calls made.`
      };
    }

    // 3. Authenticate
    const authSession = await getValidAuthSession();
    const { userId, idToken } = authSession;

    // 4. Upload to Firebase Storage
    const storageResult = await uploadImageToFotoStorage({
      buffer: prepared.buffer,
      userId,
      idToken,
      folder: "posts"
    });

    // 5. Sightengine Content Moderation
    const moderation = await checkContentModeration(storageResult.imageUrl);
    if (!moderation.passed) {
      throw new Error(`Upload rejected by content moderation: ${moderation.failureReason}`);
    }

    // 6. Generate IDs
    const postId = generateFotoPostId(userId);
    const privateMetadataId = crypto.randomUUID();

    // 7. Save main post document in posts collection
    await savePostDocument({
      postId,
      userId,
      imageUrl: storageResult.imageUrl,
      imagePath: storageResult.imagePath,
      imageWidth: prepared.width,
      imageHeight: prepared.height,
      description: caption,
      tags: validatedTags,
      nudityRating: moderation.nudityRating,
      privateMetadataId,
      idToken
    });

    // 8. Save image-private-metadata (EXIF and technical details)
    await savePrivateMetadata({
      privateMetadataId,
      userId,
      imagePath: storageResult.imagePath,
      imageUrl: storageResult.imageUrl,
      publicDocPath: `posts/${postId}`,
      exif: prepared.exif,
      idToken
    });

    // 9. Update user profile postIds
    await appendPostToUserProfile({
      userId,
      postId,
      idToken
    });

    // 10. Update tag index shards
    await indexPostTags({
      postId,
      tags: validatedTags,
      idToken
    });

    return {
      success: true,
      dryRun: false,
      postId,
      postUrl: `https://the.fotoapp.co/app/profile?userId=${userId}`,
      userId,
      caption,
      tags: validatedTags,
      dimensions: {
        width: prepared.width,
        height: prepared.height,
        aspectRatio: prepared.aspectRatio
      },
      imageUrl: storageResult.imageUrl,
      exif: prepared.exif,
      hasStrippedGps: prepared.hasStrippedGps,
      moderationScore: moderation.nudityRating,
      message: `Successfully published photo to Foto! Post ID: ${postId}`
    };
  }

  /**
   * Publishes a multi-image Series (2 to 5 photos) to Foto
   */
  async publishSeries(params: PublishSeriesParams): Promise<PublishSeriesResult> {
    const { filePaths, caption, tags, dryRun = false } = params;

    if (!Array.isArray(filePaths) || filePaths.length < PLATFORM_LIMITS.minSeriesImages) {
      throw new Error(`A series must contain at least ${PLATFORM_LIMITS.minSeriesImages} photos.`);
    }

    if (filePaths.length > PLATFORM_LIMITS.maxSeriesImages) {
      throw new Error(`Foto limits series to a maximum of ${PLATFORM_LIMITS.maxSeriesImages} photos.`);
    }

    const tagValidation = validateTags(tags);
    if (!tagValidation.valid) {
      throw new Error(`Tag validation failed: ${tagValidation.error}`);
    }
    const validatedTags = tagValidation.canonicalTags;

    // Prepare all images
    const preparedList: PreparedImage[] = [];
    for (const fp of filePaths) {
      preparedList.push(await prepareImageForUpload(fp));
    }

    if (dryRun) {
      const simulatedPostId = generateFotoPostId("SIMULATED_USER");
      return {
        success: true,
        dryRun: true,
        postId: simulatedPostId,
        caption,
        tags: validatedTags,
        imageCount: preparedList.length,
        images: preparedList.map((p, idx) => ({
          imageId: `simulated-image-${idx + 1}`,
          width: p.width,
          height: p.height,
          imageUrl: `[SIMULATED_FIREBASE_STORAGE_URL: ${p.width}x${p.height}]`
        })),
        message: `[DRY RUN] Series of ${preparedList.length} photos successfully validated and prepared. 0 API calls made.`
      };
    }

    // Authenticate
    const authSession = await getValidAuthSession();
    const { userId, idToken } = authSession;

    const postId = generateFotoPostId(userId);
    const seriesImages: any[] = [];
    let primaryStorageResult: any = null;

    // Upload each image in sequence
    for (let i = 0; i < preparedList.length; i++) {
      const prep = preparedList[i];
      const storageResult = await uploadImageToFotoStorage({
        buffer: prep.buffer,
        userId,
        idToken,
        folder: "posts"
      });

      if (i === 0) {
        primaryStorageResult = storageResult;
      }

      // Moderation
      const moderation = await checkContentModeration(storageResult.imageUrl);
      if (!moderation.passed) {
        throw new Error(
          `Image #${i + 1} rejected by content moderation: ${moderation.failureReason}`
        );
      }

      // Save private metadata
      const privateMetadataId = crypto.randomUUID();
      await savePrivateMetadata({
        privateMetadataId,
        userId,
        imagePath: storageResult.imagePath,
        imageUrl: storageResult.imageUrl,
        publicDocPath: `posts/${postId}`,
        exif: prep.exif,
        idToken
      });

      seriesImages.push({
        imageId: storageResult.imageId,
        imageUrl: storageResult.imageUrl,
        imagePath: storageResult.imagePath,
        privateMetadataId,
        nudityRating: moderation.nudityRating,
        violenceRating: 0.0,
        imageHeight: prep.height,
        imageWidth: prep.width
      });
    }

    // Save main post document with images array
    await savePostDocument({
      postId,
      userId,
      imageUrl: primaryStorageResult.imageUrl,
      imagePath: primaryStorageResult.imagePath,
      imageWidth: preparedList[0].width,
      imageHeight: preparedList[0].height,
      description: caption,
      tags: validatedTags,
      nudityRating: seriesImages[0].nudityRating,
      privateMetadataId: seriesImages[0].privateMetadataId,
      images: seriesImages,
      idToken
    });

    // Update user profile
    await appendPostToUserProfile({
      userId,
      postId,
      idToken
    });

    // Update tag index
    await indexPostTags({
      postId,
      tags: validatedTags,
      idToken
    });

    return {
      success: true,
      dryRun: false,
      postId,
      postUrl: `https://the.fotoapp.co/app/profile?userId=${userId}`,
      userId,
      caption,
      tags: validatedTags,
      imageCount: seriesImages.length,
      images: seriesImages.map(img => ({
        imageId: img.imageId,
        width: img.imageWidth,
        height: img.imageHeight,
        imageUrl: img.imageUrl
      })),
      message: `Successfully published series of ${seriesImages.length} photos to Foto! Post ID: ${postId}`
    };
  }

  /**
   * Fetches user profile for the current authenticated user
   */
  async getUserProfile(): Promise<Record<string, any>> {
    const authSession = await getValidAuthSession();
    const profile = await fetchUserProfile({
      userId: authSession.userId,
      idToken: authSession.idToken
    });

    return {
      userId: authSession.userId,
      email: authSession.email,
      ...(profile || {})
    };
  }
}
