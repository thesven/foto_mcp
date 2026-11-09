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
  fetchUserProfile,
  fetchTagIndexMeta,
  fetchTagShardPosts,
  fetchPostDocument,
  fetchPostsDocuments
} from "./api/firestore.js";
import { PLATFORM_LIMITS } from "./config.js";

export interface BrowseTagParams {
  tag: string;
  limit?: number;
  shard?: number;
}

export interface BrowseTagResult {
  tag: string;
  shard: number;
  totalPostsInShard: number;
  returnedCount: number;
  posts: Array<{
    postId: string;
    userId: string;
    description?: string;
    tags: string[];
    imageUrl?: string;
    imageWidth?: number;
    imageHeight?: number;
    nudityRating?: number;
    timeStamp?: any;
    postUrl: string;
  }>;
}

export interface FindPhotographersParams {
  tag: string;
  limit?: number;
  shard?: number;
}

export interface FindPhotographersResult {
  tag: string;
  photographerCount: number;
  photographers: Array<{
    userId: string;
    username: string;
    displayName: string;
    bio: string | null;
    profilePhotoUrl: string | null;
    postCount: number;
    followerCount: number;
    profileUrl: string;
    samplePostsUnderTag: Array<{
      postId: string;
      imageUrl?: string;
      description?: string;
      tags: string[];
      nudityRating?: number;
      timeStamp?: any;
    }>;
  }>;
}

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

  /**
   * Browse recent posts under a specific curated tag
   */
  async browseTag(params: BrowseTagParams): Promise<BrowseTagResult> {
    const validation = validateTags([params.tag]);
    if (!validation.valid || validation.canonicalTags.length === 0) {
      throw new Error(`Tag "${params.tag}" is not a valid Foto curated tag. Use foto_search_tags to find valid tags.`);
    }
    const canonicalTag = validation.canonicalTags[0];
    const authSession = await getValidAuthSession();

    let shard = params.shard;
    if (shard === undefined) {
      const meta = await fetchTagIndexMeta({ tag: canonicalTag, idToken: authSession.idToken });
      shard = meta?.currentShard ?? 0;
    }

    const postIds = await fetchTagShardPosts({
      tag: canonicalTag,
      shard,
      idToken: authSession.idToken
    });

    const limit = Math.min(params.limit || 20, 50);
    const targetPostIds = [...postIds].reverse().slice(0, limit);
    const postDocs = await fetchPostsDocuments({
      postIds: targetPostIds,
      idToken: authSession.idToken
    });

    const posts = postDocs.map((doc) => ({
      postId: doc.postId || "",
      userId: doc.userId || "",
      description: doc.description || "",
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      imageUrl: doc.imageUrl || (Array.isArray(doc.images) && doc.images[0]?.imageUrl) || "",
      imageWidth: doc.imageWidth,
      imageHeight: doc.imageHeight,
      nudityRating: typeof doc.nudityRating === "number" ? doc.nudityRating : undefined,
      timeStamp: doc.timeStamp,
      postUrl: `https://the.fotoapp.co/app/profile?userId=${doc.userId}`
    }));

    return {
      tag: canonicalTag,
      shard,
      totalPostsInShard: postIds.length,
      returnedCount: posts.length,
      posts
    };
  }

  /**
   * Find photographers who publish under a specific curated tag
   */
  async findPhotographersByTag(params: FindPhotographersParams): Promise<FindPhotographersResult> {
    const validation = validateTags([params.tag]);
    if (!validation.valid || validation.canonicalTags.length === 0) {
      throw new Error(`Tag "${params.tag}" is not a valid Foto curated tag. Use foto_search_tags to find valid tags.`);
    }
    const canonicalTag = validation.canonicalTags[0];
    const authSession = await getValidAuthSession();

    let shard = params.shard;
    if (shard === undefined) {
      const meta = await fetchTagIndexMeta({ tag: canonicalTag, idToken: authSession.idToken });
      shard = meta?.currentShard ?? 0;
    }

    const postIds = await fetchTagShardPosts({
      tag: canonicalTag,
      shard,
      idToken: authSession.idToken
    });

    // Inspect recent posts to discover active photographers
    const recentPostIds = [...postIds].reverse().slice(0, 100);
    const postDocs = await fetchPostsDocuments({
      postIds: recentPostIds,
      idToken: authSession.idToken
    });

    // Group posts by author
    const postsByUser = new Map<string, Array<Record<string, any>>>();
    for (const doc of postDocs) {
      if (!doc.userId) continue;
      if (!postsByUser.has(doc.userId)) {
        postsByUser.set(doc.userId, []);
      }
      postsByUser.get(doc.userId)!.push(doc);
    }

    const limit = Math.min(params.limit || 10, 25);
    const userIds = Array.from(postsByUser.keys()).slice(0, limit);

    // Fetch user profiles for each photographer
    const photographers = await Promise.all(
      userIds.map(async (userId) => {
        let profile: Record<string, any> | null = null;
        try {
          profile = await fetchUserProfile({ userId, idToken: authSession.idToken });
        } catch {
          // Gracefully continue if single profile fetch errors
        }

        const userPosts = postsByUser.get(userId) || [];
        const username = profile?.username || `user_${userId.substring(0, 8)}`;
        const displayName = profile?.displayName || profile?.name || username;
        const postCount =
          typeof profile?.postCount === "number"
            ? profile.postCount
            : Array.isArray(profile?.postIds)
            ? profile.postIds.length
            : userPosts.length;
        const followerCount =
          typeof profile?.followerCount === "number"
            ? profile.followerCount
            : Array.isArray(profile?.followers)
            ? profile.followers.length
            : 0;

        return {
          userId,
          username,
          displayName,
          bio: profile?.bio || null,
          profilePhotoUrl: profile?.profilePhotoUrl || profile?.avatarUrl || null,
          postCount,
          followerCount,
          profileUrl: `https://the.fotoapp.co/app/profile?userId=${userId}`,
          samplePostsUnderTag: userPosts.slice(0, 3).map((p) => ({
            postId: p.postId || "",
            imageUrl: p.imageUrl || (Array.isArray(p.images) && p.images[0]?.imageUrl) || "",
            description: p.description || "",
            tags: Array.isArray(p.tags) ? p.tags : [],
            nudityRating: typeof p.nudityRating === "number" ? p.nudityRating : undefined,
            timeStamp: p.timeStamp
          }))
        };
      })
    );

    return {
      tag: canonicalTag,
      photographerCount: photographers.length,
      photographers
    };
  }
}

