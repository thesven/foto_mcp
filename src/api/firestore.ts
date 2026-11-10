import crypto from "node:crypto";
import { FOTO_FIREBASE_CONFIG, PLATFORM_LIMITS } from "../config.js";
import { formatFotoTimestamp } from "./storage.js";

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

/**
 * Generates a standard Foto post ID: yyyyMMddHHmmss-<userId>-<8_random_alnum>
 */
export function generateFotoPostId(userId: string): string {
  const ts = formatFotoTimestamp();
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPart = "";
  for (let i = 0; i < 8; i++) {
    randomPart += chars.charAt(crypto.randomInt(chars.length));
  }
  return `${ts}-${userId}-${randomPart}`;
}

/**
 * Converts a native JavaScript value to a Firestore REST API typed Value object.
 */
export function toFirestoreValue(val: any): Record<string, any> {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === "boolean") {
    return { booleanValue: val };
  }
  if (typeof val === "number") {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === "string") {
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue)
      }
    };
  }
  if (typeof val === "object") {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return {
      mapValue: {
        fields
      }
    };
  }
  return { stringValue: String(val) };
}

/**
 * Converts a Firestore REST API typed Value object back to a native JavaScript value.
 */
export function fromFirestoreValue(val: Record<string, any>): any {
  if (!val || typeof val !== "object") return null;
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return parseFloat(val.doubleValue);
  if ("stringValue" in val) return val.stringValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("arrayValue" in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map(fromFirestoreValue);
  }
  if ("mapValue" in val) {
    const res: Record<string, any> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = fromFirestoreValue(v as any);
    }
    return res;
  }
  return null;
}

/**
 * Writes or updates a document in Firestore via REST API
 */
export async function setFirestoreDocument(params: {
  collectionPath: string;
  documentId: string;
  data: Record<string, any>;
  idToken: string;
}): Promise<Record<string, any>> {
  const { collectionPath, documentId, data, idToken } = params;

  const url = `${FIRESTORE_BASE_URL}/${collectionPath}/${documentId}`;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });

  const resJson = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(
      `Firestore write error on ${collectionPath}/${documentId}: ${resJson.error?.message || response.statusText}`
    );
  }

  return resJson;
}

/**
 * Reads a document from Firestore via REST API
 */
export async function getFirestoreDocument(params: {
  collectionPath: string;
  documentId: string;
  idToken: string;
}): Promise<Record<string, any> | null> {
  const { collectionPath, documentId, idToken } = params;
  const url = `${FIRESTORE_BASE_URL}/${collectionPath}/${documentId}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`
    }
  });

  if (response.status === 404) {
    return null;
  }

  const resJson = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(
      `Firestore read error on ${collectionPath}/${documentId}: ${resJson.error?.message || response.statusText}`
    );
  }

  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(resJson.fields || {})) {
    result[k] = fromFirestoreValue(v as any);
  }
  return result;
}

/**
 * Saves image private metadata (including parsed EXIF and camera gear) to image-private-metadata
 */
export async function savePrivateMetadata(params: {
  privateMetadataId: string;
  userId: string;
  imagePath: string;
  imageUrl: string;
  publicDocPath: string;
  exif: Record<string, any>;
  idToken: string;
  portfolioImageId?: string;
}): Promise<void> {
  const {
    privateMetadataId,
    userId,
    imagePath,
    imageUrl,
    publicDocPath,
    exif,
    idToken,
    portfolioImageId
  } = params;

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const docPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/image-private-metadata/${privateMetadataId}`;

  const fields: Record<string, any> = {
    privateMetadataId: toFirestoreValue(privateMetadataId),
    userId: toFirestoreValue(userId),
    imagePath: toFirestoreValue(imagePath),
    imageUrl: toFirestoreValue(imageUrl),
    type: toFirestoreValue("post"),
    publicDocPath: toFirestoreValue(publicDocPath),
    exif: toFirestoreValue(exif),
    schemaVersion: { integerValue: "1" }
  };

  if (portfolioImageId) {
    fields.portfolioImageId = toFirestoreValue(portfolioImageId);
  }

  const response = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docPath,
            fields
          },
          updateTransforms: [
            {
              fieldPath: "createdAt",
              setToServerValue: "REQUEST_TIME"
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = (await response.json()) as any;
    throw new Error(`Failed to save image-private-metadata: ${err.error?.message || response.statusText}`);
  }
}

/**
 * Writes the main public post document to `posts/<postId>` matching Foto schema and server timestamp
 */
export async function savePostDocument(params: {
  postId: string;
  userId: string;
  imageUrl: string;
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  description: string;
  tags: string[];
  nudityRating: number;
  privateMetadataId: string;
  images?: any[] | null;
  idToken: string;
}): Promise<void> {
  const {
    postId,
    userId,
    imageUrl,
    imagePath,
    imageWidth,
    imageHeight,
    description,
    tags,
    nudityRating,
    privateMetadataId,
    images = null,
    idToken
  } = params;

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const docPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/posts/${postId}`;

  const fields: Record<string, any> = {
    userId: toFirestoreValue(userId),
    postId: toFirestoreValue(postId),
    type: toFirestoreValue("post"),
    imageUrl: toFirestoreValue(imageUrl),
    imagePath: toFirestoreValue(imagePath),
    imageWidth: { doubleValue: imageWidth },
    imageHeight: { doubleValue: imageHeight },
    description: toFirestoreValue(description),
    tags: toFirestoreValue(tags),
    likes: toFirestoreValue([]),
    commentCount: { integerValue: "0" },
    nudityRating: { doubleValue: nudityRating },
    violenceRating: { doubleValue: 0.0 },
    privateMetadataId: toFirestoreValue(privateMetadataId),
    images: images ? toFirestoreValue(images) : { nullValue: null },
    coverAlignmentX: { nullValue: null },
    coverImageId: { nullValue: null },
    title: { nullValue: null },
    isActive: toFirestoreValue(true),
    inactiveReason: { nullValue: null },
    inactiveSince: { nullValue: null }
  };

  const response = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docPath,
            fields
          },
          updateTransforms: [
            {
              fieldPath: "timeStamp",
              setToServerValue: "REQUEST_TIME"
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = (await response.json()) as any;
    throw new Error(`Failed to save post document: ${err.error?.message || response.statusText}`);
  }
}

/**
 * Appends the new postId to the user's `user-profiles/<userId>` document
 */
export async function appendPostToUserProfile(params: {
  userId: string;
  postId: string;
  idToken: string;
}): Promise<void> {
  const { userId, postId, idToken } = params;

  // Use Firestore REST commit with FieldTransform appendMissingElements
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const documentPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${userId}`;

  try {
    const response = await fetch(commitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        writes: [
          {
            transform: {
              document: documentPath,
              fieldTransforms: [
                {
                  fieldPath: "postIds",
                  appendMissingElements: {
                    values: [{ stringValue: postId }]
                  }
                }
              ]
            }
          }
        ]
      })
    });

    if (!response.ok) {
      // Fallback: read user-profile, update, and write
      const current = await getFirestoreDocument({
        collectionPath: "user-profiles",
        documentId: userId,
        idToken
      });
      if (current) {
        const postIds = Array.isArray(current.postIds) ? current.postIds : [];
        if (!postIds.includes(postId)) {
          postIds.push(postId);
          await setFirestoreDocument({
            collectionPath: "user-profiles",
            documentId: userId,
            data: { ...current, postIds },
            idToken
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal if user profile update encounters a transient issue
    console.error("Warning: Could not append postId to user-profile:", err);
  }
}

/**
 * Updates Foto's sharded tag index (tag_index/<tag>_meta and tag_index/<tag>_<shard>)
 */
export async function indexPostTags(params: {
  postId: string;
  tags: string[];
  idToken: string;
}): Promise<void> {
  const { postId, tags, idToken } = params;

  for (const tag of tags) {
    try {
      const metaDocId = `${tag}_meta`;
      const meta = await getFirestoreDocument({
        collectionPath: "tag_index",
        documentId: metaDocId,
        idToken
      });

      let currentShard = 0;
      let postCount = 0;

      if (meta) {
        currentShard = typeof meta.currentShard === "number" ? meta.currentShard : 0;
        postCount = typeof meta.postCount === "number" ? meta.postCount : 0;
      }

      if (postCount >= PLATFORM_LIMITS.maxShardPostCount) {
        currentShard += 1;
        postCount = 0;
      }

      const shardDocId = `${tag}_${currentShard}`;

      // Append postId to shard document
      const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
      const shardPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/tag_index/${shardDocId}`;

      await fetch(commitUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          writes: [
            {
              transform: {
                document: shardPath,
                fieldTransforms: [
                  {
                    fieldPath: "posts",
                    appendMissingElements: {
                      values: [{ stringValue: postId }]
                    }
                  }
                ]
              }
            }
          ]
        })
      });

      // Update metadata doc
      postCount += 1;
      await setFirestoreDocument({
        collectionPath: "tag_index",
        documentId: metaDocId,
        data: { currentShard, postCount },
        idToken
      });
    } catch (err) {
      console.error(`Warning: Failed to update tag shard for tag "${tag}":`, err);
    }
  }
}

/**
 * Fetches user profile by user ID
 */
export async function fetchUserProfile(params: {
  userId: string;
  idToken: string;
}): Promise<Record<string, any> | null> {
  return await getFirestoreDocument({
    collectionPath: "user-profiles",
    documentId: params.userId,
    idToken: params.idToken
  });
}

/**
 * Deletes a Firestore document by path and ID
 */
export async function deleteFirestoreDocument(params: {
  collectionPath: string;
  documentId: string;
  idToken: string;
}): Promise<boolean> {
  const url = `${FIRESTORE_BASE_URL}/${params.collectionPath}/${params.documentId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${params.idToken}`
    }
  });
  return res.ok;
}

/**
 * Clears the postIds array on a user profile
 */
export async function resetUserProfilePosts(params: {
  userId: string;
  idToken: string;
}): Promise<boolean> {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${params.userId}`;

  const res = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: userDocPath,
            fields: {
              postIds: {
                arrayValue: {
                  values: []
                }
              }
            }
          },
          updateMask: {
            fieldPaths: ["postIds"]
          }
        }
      ]
    })
  });
  return res.ok;
}

/**
 * Fetches metadata for a curated tag index (e.g. tag_index/<tag>_meta)
 */
export async function fetchTagIndexMeta(params: {
  tag: string;
  idToken: string;
}): Promise<{ currentShard: number; postCount: number } | null> {
  const meta = await getFirestoreDocument({
    collectionPath: "tag_index",
    documentId: `${params.tag}_meta`,
    idToken: params.idToken
  });

  if (!meta) return null;

  return {
    currentShard: typeof meta.currentShard === "number" ? meta.currentShard : 0,
    postCount: typeof meta.postCount === "number" ? meta.postCount : 0
  };
}

/**
 * Fetches post IDs recorded under a specific tag shard (e.g. tag_index/<tag>_<shard>)
 */
export async function fetchTagShardPosts(params: {
  tag: string;
  shard?: number;
  idToken: string;
}): Promise<string[]> {
  const shard = params.shard ?? 0;
  const shardDoc = await getFirestoreDocument({
    collectionPath: "tag_index",
    documentId: `${params.tag}_${shard}`,
    idToken: params.idToken
  });

  if (!shardDoc || !Array.isArray(shardDoc.posts)) {
    return [];
  }

  return shardDoc.posts.filter((p: any): p is string => typeof p === "string");
}

/**
 * Fetches a single post document by post ID
 */
export async function fetchPostDocument(params: {
  postId: string;
  idToken: string;
}): Promise<Record<string, any> | null> {
  return await getFirestoreDocument({
    collectionPath: "posts",
    documentId: params.postId,
    idToken: params.idToken
  });
}

/**
 * Fetches multiple post documents in parallel by their post IDs
 */
export async function fetchPostsDocuments(params: {
  postIds: string[];
  idToken: string;
}): Promise<Array<Record<string, any>>> {
  const fetchPromises = params.postIds.map(async (postId) => {
    try {
      return await fetchPostDocument({ postId, idToken: params.idToken });
    } catch {
      return null;
    }
  });

  const results = await Promise.all(fetchPromises);
  return results.filter((doc): doc is Record<string, any> => doc !== null && typeof doc === "object");
}

/**
 * Follows a photographer on Foto by atomically updating the current user's following
 * array and the target user's followers array.
 */
export async function followUserInFirestore(params: {
  currentUserId: string;
  targetUserId: string;
  idToken: string;
}): Promise<boolean> {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const myDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${params.currentUserId}`;
  const targetDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${params.targetUserId}`;

  const res = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          transform: {
            document: myDocPath,
            fieldTransforms: [
              {
                fieldPath: "following",
                appendMissingElements: {
                  values: [{ stringValue: params.targetUserId }]
                }
              }
            ]
          }
        },
        {
          transform: {
            document: targetDocPath,
            fieldTransforms: [
              {
                fieldPath: "followers",
                appendMissingElements: {
                  values: [{ stringValue: params.currentUserId }]
                }
              }
            ]
          }
        }
      ]
    })
  });

  return res.ok;
}

/**
 * Unfollows a photographer on Foto by removing the target user from following and current user from followers.
 */
export async function unfollowUserInFirestore(params: {
  currentUserId: string;
  targetUserId: string;
  idToken: string;
}): Promise<boolean> {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const myDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${params.currentUserId}`;
  const targetDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${params.targetUserId}`;

  const res = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          transform: {
            document: myDocPath,
            fieldTransforms: [
              {
                fieldPath: "following",
                removeAllFromArray: {
                  values: [{ stringValue: params.targetUserId }]
                }
              }
            ]
          }
        },
        {
          transform: {
            document: targetDocPath,
            fieldTransforms: [
              {
                fieldPath: "followers",
                removeAllFromArray: {
                  values: [{ stringValue: params.currentUserId }]
                }
              }
            ]
          }
        }
      ]
    })
  });

  return res.ok;
}

/**
 * Deletes a post document, cleans up associated private metadata (including series/portfolio slides),
 * removes postId from user profile, and prunes tag_index shards.
 */
export async function deletePostFromFirestore(params: {
  postId: string;
  userId: string;
  idToken: string;
}): Promise<boolean> {
  const { postId, userId, idToken } = params;

  // 1. Fetch post doc to find associated privateMetadataId(s) and tags
  const postDoc = await getFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    idToken
  });

  const metadataIds = new Set<string>();
  if (postDoc?.privateMetadataId && typeof postDoc.privateMetadataId === "string") {
    metadataIds.add(postDoc.privateMetadataId);
  }
  if (Array.isArray(postDoc?.images)) {
    for (const img of postDoc.images) {
      if (img?.privateMetadataId && typeof img.privateMetadataId === "string") {
        metadataIds.add(img.privateMetadataId);
      }
    }
  }

  // 2. Delete posts/{postId}
  await deleteFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    idToken
  });

  // 3. Delete all image-private-metadata documents (single + series/portfolio slides)
  for (const metaId of metadataIds) {
    try {
      await deleteFirestoreDocument({
        collectionPath: "image-private-metadata",
        documentId: metaId,
        idToken
      });
    } catch {
      // Best-effort cleanup
    }
  }

  // 4. Remove postId from user profile
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const userDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/user-profiles/${userId}`;

  try {
    await fetch(commitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        writes: [
          {
            transform: {
              document: userDocPath,
              fieldTransforms: [
                {
                  fieldPath: "postIds",
                  removeAllFromArray: {
                    values: [{ stringValue: postId }]
                  }
                }
              ]
            }
          }
        ]
      })
    });
  } catch {
    // Non-fatal if profile update fails
  }

  // 5. Remove postId from tag_index shards if tags are present on the post
  if (Array.isArray(postDoc?.tags) && postDoc.tags.length > 0) {
    for (const tag of postDoc.tags) {
      try {
        const meta = await fetchTagIndexMeta({ tag, idToken });
        const shard = meta?.currentShard ?? 0;
        const shardDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/tag_index/${tag}_${shard}`;
        await fetch(commitUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            writes: [
              {
                transform: {
                  document: shardDocPath,
                  fieldTransforms: [
                    {
                      fieldPath: "posts",
                      removeAllFromArray: {
                        values: [{ stringValue: postId }]
                      }
                    }
                  ]
                }
              }
            ]
          })
        });
      } catch {
        // Non-fatal shard prune
      }
    }
  }

  return true;
}

/**
 * Updates description and/or tags on an existing post document.
 */
export async function updatePostInFirestore(params: {
  postId: string;
  userId: string;
  description?: string;
  tags?: string[];
  idToken: string;
}): Promise<Record<string, any>> {
  const { postId, userId, description, tags, idToken } = params;

  const current = await getFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    idToken
  });

  if (!current) {
    throw new Error(`Post "${postId}" not found.`);
  }

  if (current.userId && current.userId !== userId) {
    throw new Error(`Permission denied: You can only edit your own posts.`);
  }

  const updatedData: Record<string, any> = { ...current };
  if (description !== undefined) {
    updatedData.description = description;
  }
  if (tags !== undefined) {
    updatedData.tags = tags;
  }

  await setFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    data: updatedData,
    idToken
  });

  if (tags && tags.length > 0) {
    await indexPostTags({ postId, tags, idToken });
  }

  return updatedData;
}

/**
 * Fetches a post document combined with camera EXIF from image-private-metadata.
 */
export async function fetchPostWithMetadata(params: {
  postId: string;
  idToken: string;
}): Promise<Record<string, any> | null> {
  const post = await fetchPostDocument({ postId: params.postId, idToken: params.idToken });
  if (!post) return null;

  let exif: Record<string, any> | null = null;
  if (post.privateMetadataId) {
    try {
      const meta = await getFirestoreDocument({
        collectionPath: "image-private-metadata",
        documentId: post.privateMetadataId,
        idToken: params.idToken
      });
      if (meta?.exif) {
        exif = meta.exif;
      }
    } catch {
      // Continue if metadata doc unavailable
    }
  }

  return {
    ...post,
    exif,
    postUrl: `https://the.fotoapp.co/app/profile?userId=${post.userId}`
  };
}

/**
 * Resolves a username to its associated userId via the usernames collection registry.
 */
export async function resolveUserByUsername(params: {
  username: string;
  idToken: string;
}): Promise<string | null> {
  const cleanUsername = params.username.trim().replace(/^@/, "").toLowerCase();
  const doc = await getFirestoreDocument({
    collectionPath: "usernames",
    documentId: cleanUsername,
    idToken: params.idToken
  });

  if (!doc) return null;
  return doc.userId || doc.uid || (typeof doc === "string" ? doc : null);
}

/**
 * Likes a post on Foto by atomically appending userId to the post's likes array.
 */
export async function likePostInFirestore(params: {
  postId: string;
  userId: string;
  idToken: string;
}): Promise<boolean> {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const postDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/posts/${params.postId}`;

  const res = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          transform: {
            document: postDocPath,
            fieldTransforms: [
              {
                fieldPath: "likes",
                appendMissingElements: {
                  values: [{ stringValue: params.userId }]
                }
              }
            ]
          }
        }
      ]
    })
  });
  return res.ok;
}

/**
 * Unlikes a post on Foto by atomically removing userId from the post's likes array.
 */
export async function unlikePostInFirestore(params: {
  postId: string;
  userId: string;
  idToken: string;
}): Promise<boolean> {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const postDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/posts/${params.postId}`;

  const res = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          transform: {
            document: postDocPath,
            fieldTransforms: [
              {
                fieldPath: "likes",
                removeAllFromArray: {
                  values: [{ stringValue: params.userId }]
                }
              }
            ]
          }
        }
      ]
    })
  });
  return res.ok;
}

/**
 * Fetches comments and optional threaded replies for a specific post.
 */
export async function fetchPostComments(params: {
  postId: string;
  idToken: string;
  limit?: number;
  includeReplies?: boolean;
}): Promise<Array<Record<string, any>>> {
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery`;
  const limit = Math.min(params.limit || 20, 50);

  const res = await fetch(queryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "comments" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "postId" },
            op: "EQUAL",
            value: { stringValue: params.postId }
          }
        },
        limit
      }
    })
  });

  if (!res.ok) return [];
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) return [];

  const comments: Array<Record<string, any>> = [];
  for (const row of rows) {
    if (row.document?.fields) {
      const commentData: Record<string, any> = {};
      for (const [k, v] of Object.entries(row.document.fields)) {
        commentData[k] = fromFirestoreValue(v as any);
      }
      commentData.commentId = row.document.name.split("/").pop();
      comments.push(commentData);
    }
  }

  if (params.includeReplies && comments.length > 0) {
    try {
      const replyRes = await fetch(queryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "replies" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "postId" },
                op: "EQUAL",
                value: { stringValue: params.postId }
              }
            },
            limit: 100
          }
        })
      });

      if (replyRes.ok) {
        const replyRows = (await replyRes.json()) as any[];
        if (Array.isArray(replyRows)) {
          const repliesByParent = new Map<string, Array<Record<string, any>>>();
          for (const rRow of replyRows) {
            if (rRow.document?.fields) {
              const rData: Record<string, any> = {};
              for (const [k, v] of Object.entries(rRow.document.fields)) {
                rData[k] = fromFirestoreValue(v as any);
              }
              rData.replyId = rRow.document.name.split("/").pop();
              const parentId = rData.parentCommentId || rData.commentId || "";
              if (!repliesByParent.has(parentId)) {
                repliesByParent.set(parentId, []);
              }
              repliesByParent.get(parentId)!.push(rData);
            }
          }
          for (const c of comments) {
            c.replies = repliesByParent.get(c.commentId) || [];
          }
        }
      }
    } catch {
      // Non-fatal if replies query fails
    }
  }

  return comments;
}

/**
 * Adds a new comment (or threaded reply if parentCommentId is provided) to a post
 * and increments the post's commentCount.
 */
export async function addPostComment(params: {
  postId: string;
  userId: string;
  username?: string;
  text: string;
  parentCommentId?: string;
  idToken: string;
}): Promise<Record<string, any>> {
  const commentId = crypto.randomUUID();
  const isReply = Boolean(params.parentCommentId);
  const collectionPath = isReply ? "replies" : "comments";

  const commentData: Record<string, any> = {
    commentId,
    postId: params.postId,
    userId: params.userId,
    username: params.username || `user_${params.userId.substring(0, 8)}`,
    text: params.text,
    createdAt: new Date().toISOString()
  };

  if (params.parentCommentId) {
    commentData.parentCommentId = params.parentCommentId;
    commentData.replyId = commentId;
  }

  await setFirestoreDocument({
    collectionPath,
    documentId: commentId,
    data: commentData,
    idToken: params.idToken
  });

  // Increment commentCount on post
  try {
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
    const postDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/posts/${params.postId}`;
    await fetch(commitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        writes: [
          {
            transform: {
              document: postDocPath,
              fieldTransforms: [
                {
                  fieldPath: "commentCount",
                  increment: { integerValue: "1" }
                }
              ]
            }
          }
        ]
      })
    });
  } catch {
    // Non-fatal
  }

  return commentData;
}

/**
 * Deletes a comment or threaded reply and decrements the post's commentCount.
 */
export async function deleteCommentFromFirestore(params: {
  commentId: string;
  postId: string;
  userId: string;
  isReply?: boolean;
  idToken: string;
}): Promise<boolean> {
  const collectionPath = params.isReply ? "replies" : "comments";
  const existing = await getFirestoreDocument({
    collectionPath,
    documentId: params.commentId,
    idToken: params.idToken
  });

  if (existing && existing.userId && existing.userId !== params.userId) {
    throw new Error("Permission denied: You can only delete your own comments.");
  }

  const deleted = await deleteFirestoreDocument({
    collectionPath,
    documentId: params.commentId,
    idToken: params.idToken
  });

  if (deleted && params.postId) {
    try {
      const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
      const postDocPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/posts/${params.postId}`;
      await fetch(commitUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          writes: [
            {
              transform: {
                document: postDocPath,
                fieldTransforms: [
                  {
                    fieldPath: "commentCount",
                    increment: { integerValue: "-1" }
                  }
                ]
              }
            }
          ]
        })
      });
    } catch {
      // Non-fatal
    }
  }

  return deleted;
}

/**
 * Resolves the photographer profiles of users who liked a post (/app/liked-by/:postId).
 */
export async function fetchPostLikesUsers(params: {
  postId: string;
  idToken: string;
  limit?: number;
}): Promise<{
  postId: string;
  totalLikes: number;
  users: Array<{
    userId: string;
    username: string;
    displayName: string;
    profilePhotoUrl: string | null;
    profileUrl: string;
  }>;
}> {
  const postDoc = await fetchPostDocument({ postId: params.postId, idToken: params.idToken });
  if (!postDoc) {
    throw new Error(`Post "${params.postId}" not found.`);
  }

  const likeUserIds: string[] = Array.isArray(postDoc.likes) ? postDoc.likes : [];
  const limit = Math.min(params.limit || 25, 50);
  const selectedIds = likeUserIds.slice(0, limit);

  const users = await Promise.all(
    selectedIds.map(async (uid) => {
      let profile: Record<string, any> | null = null;
      try {
        profile = await fetchUserProfile({ userId: uid, idToken: params.idToken });
      } catch {
        // Ignore single fetch error
      }
      const username = profile?.username || `user_${uid.substring(0, 8)}`;
      return {
        userId: uid,
        username,
        displayName: profile?.displayName || profile?.name || username,
        profilePhotoUrl: profile?.profilePhotoUrl || profile?.avatarUrl || null,
        profileUrl: `https://the.fotoapp.co/app/profile?userId=${uid}`
      };
    })
  );

  return {
    postId: params.postId,
    totalLikes: likeUserIds.length,
    users
  };
}

/**
 * Updates an existing portfolio document in Firestore.
 */
export async function updatePortfolioInFirestore(params: {
  postId: string;
  userId: string;
  title?: string;
  description?: string;
  tags?: string[];
  coverImageId?: string;
  coverAlignmentX?: number;
  images?: PortfolioImageRecord[];
  idToken: string;
}): Promise<Record<string, any>> {
  const { postId, userId, title, description, tags, coverImageId, coverAlignmentX, images, idToken } = params;

  const current = await getFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    idToken
  });

  if (!current) {
    throw new Error(`Portfolio "${postId}" not found.`);
  }

  if (current.type && current.type !== "portfolio") {
    throw new Error(`Post "${postId}" is not a portfolio (type="${current.type}").`);
  }

  if (current.userId && current.userId !== userId) {
    throw new Error("Permission denied: You can only edit your own portfolios.");
  }

  const updated: Record<string, any> = { ...current };
  if (title !== undefined) updated.title = title.trim();
  if (description !== undefined) updated.description = description.trim();
  if (tags !== undefined) updated.tags = tags;
  if (coverImageId !== undefined) updated.coverImageId = coverImageId;
  if (coverAlignmentX !== undefined) updated.coverAlignmentX = Math.min(Math.max(coverAlignmentX, 0), 1);
  if (images !== undefined) updated.images = images;

  await setFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    data: updated,
    idToken
  });

  if (tags && tags.length > 0) {
    await indexPostTags({ postId, tags, idToken });
  }

  return updated;
}

/**
 * Deletes a portfolio document and cascades cleanup across all slide private metadata, user profile, and tag shards.
 */
export async function deletePortfolioFromFirestore(params: {
  postId: string;
  userId: string;
  idToken: string;
}): Promise<boolean> {
  return await deletePostFromFirestore(params);
}

/**
 * Updates the authenticated user's profile fields (displayName, bio, website, profilePhotoUrl).
 */
export async function updateUserProfileInFirestore(params: {
  userId: string;
  displayName?: string;
  bio?: string;
  website?: string;
  profilePhotoUrl?: string;
  idToken: string;
}): Promise<Record<string, any>> {
  const { userId, displayName, bio, website, profilePhotoUrl, idToken } = params;

  const current = (await fetchUserProfile({ userId, idToken })) || { userId };
  const updated: Record<string, any> = { ...current };

  if (displayName !== undefined) updated.displayName = displayName.trim();
  if (bio !== undefined) updated.bio = bio.trim();
  if (website !== undefined) updated.website = website.trim();
  if (profilePhotoUrl !== undefined) updated.profilePhotoUrl = profilePhotoUrl.trim();

  await setFirestoreDocument({
    collectionPath: "user-profiles",
    documentId: userId,
    data: updated,
    idToken
  });

  return updated;
}

/**
 * Submits a community safety report to `reported-posts` or `reported-users`.
 */
export async function reportContentInFirestore(params: {
  reporterUserId: string;
  targetType: "post" | "user";
  targetId: string;
  reason: string;
  details?: string;
  idToken: string;
}): Promise<Record<string, any>> {
  const reportId = crypto.randomUUID();
  const collectionPath = params.targetType === "post" ? "reported-posts" : "reported-users";

  const reportData: Record<string, any> = {
    reportId,
    reporterUserId: params.reporterUserId,
    targetType: params.targetType,
    targetId: params.targetId,
    reason: params.reason.trim(),
    details: params.details?.trim() || "",
    status: "pending",
    createdAt: new Date().toISOString()
  };

  if (params.targetType === "post") {
    reportData.postId = params.targetId;
  } else {
    reportData.reportedUserId = params.targetId;
  }

  await setFirestoreDocument({
    collectionPath,
    documentId: reportId,
    data: reportData,
    idToken: params.idToken
  });

  return reportData;
}

/**
 * Executes an HTTP fetch with courteous exponential backoff on transient rate-limit (429) or server (502/503/504) errors.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: { maxRetries?: number; baseDelayMs?: number }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 150;

  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (![429, 502, 503, 504].includes(res.status) || attempt === maxRetries) {
      return res;
    }
    lastResponse = res;
    const delay = baseDelayMs * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return lastResponse!;
}

/**
 * Fetches recent notifications for a user.
 */
export async function fetchUserNotifications(params: {
  userId: string;
  idToken: string;
  limit?: number;
}): Promise<Array<Record<string, any>>> {
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery`;
  const limit = Math.min(params.limit || 20, 50);

  const res = await fetch(queryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "notifications" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "recipientId" },
            op: "EQUAL",
            value: { stringValue: params.userId }
          }
        },
        limit
      }
    })
  });

  if (!res.ok) return [];
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) return [];

  const notifications: Array<Record<string, any>> = [];
  for (const row of rows) {
    if (row.document?.fields) {
      const notif: Record<string, any> = {};
      for (const [k, v] of Object.entries(row.document.fields)) {
        notif[k] = fromFirestoreValue(v as any);
      }
      notif.notificationId = row.document.name.split("/").pop();
      notifications.push(notif);
    }
  }
  return notifications;
}

/**
 * Fetches recent posts from photographers the user follows to construct the chronological home feed.
 */
export async function fetchHomeFeed(params: {
  userId: string;
  idToken: string;
  limit?: number;
}): Promise<Array<Record<string, any>>> {
  // 1. Fetch user profile to get following list
  const profile = await fetchUserProfile({ userId: params.userId, idToken: params.idToken });
  const following: string[] = Array.isArray(profile?.following) ? profile.following : [];

  if (following.length === 0) {
    return [];
  }

  // 2. Fetch recent post IDs from each followed user
  const limit = Math.min(params.limit || 20, 50);
  const followedProfiles = await Promise.all(
    following.slice(0, 15).map(uid => fetchUserProfile({ userId: uid, idToken: params.idToken }))
  );

  const candidatePostIds: string[] = [];
  for (const fp of followedProfiles) {
    if (fp && Array.isArray(fp.postIds)) {
      candidatePostIds.push(...fp.postIds.slice(-5));
    }
  }

  // Deduplicate and take most recent
  const uniqueIds = Array.from(new Set(candidatePostIds)).reverse().slice(0, limit);
  const postDocs = await fetchPostsDocuments({ postIds: uniqueIds, idToken: params.idToken });

  return postDocs.map(doc => ({
    postId: doc.postId || "",
    userId: doc.userId || "",
    description: doc.description || "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    imageUrl: doc.imageUrl || (Array.isArray(doc.images) && doc.images[0]?.imageUrl) || "",
    imageWidth: doc.imageWidth,
    imageHeight: doc.imageHeight,
    likesCount: Array.isArray(doc.likes) ? doc.likes.length : 0,
    commentCount: typeof doc.commentCount === "number" ? doc.commentCount : 0,
    timeStamp: doc.timeStamp,
    postUrl: `https://the.fotoapp.co/app/profile?userId=${doc.userId}`
  }));
}

export interface PortfolioImageRecord {
  id: string;
  imageUrl: string;
  imagePath: string;
  aspectRatio: number;
  fullWidth: number;
  fullHeight: number;
  caption?: string;
  tags?: string[];
  order: number;
  privateMetadataId: string;
  nudityRating?: number;
}

/**
 * Writes a multi-image portfolio document to `posts/<postId>` matching Foto portfolio schema
 */
export async function savePortfolioDocument(params: {
  postId: string;
  userId: string;
  title: string;
  description?: string;
  tags: string[];
  coverImageId: string;
  coverAlignmentX?: number;
  coverImageUrl: string;
  coverImagePath: string;
  coverImageWidth: number;
  coverImageHeight: number;
  images: PortfolioImageRecord[];
  nudityRating: number;
  idToken: string;
}): Promise<void> {
  const {
    postId,
    userId,
    title,
    description = "",
    tags,
    coverImageId,
    coverAlignmentX = 0.5,
    coverImageUrl,
    coverImagePath,
    coverImageWidth,
    coverImageHeight,
    images,
    nudityRating,
    idToken
  } = params;

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
  const docPath = `projects/${FOTO_FIREBASE_CONFIG.projectId}/databases/(default)/documents/posts/${postId}`;

  const fields: Record<string, any> = {
    userId: toFirestoreValue(userId),
    postId: toFirestoreValue(postId),
    type: toFirestoreValue("portfolio"),
    title: toFirestoreValue(title),
    coverImageId: toFirestoreValue(coverImageId),
    coverAlignmentX: { doubleValue: coverAlignmentX },
    imageUrl: toFirestoreValue(coverImageUrl),
    imagePath: toFirestoreValue(coverImagePath),
    imageWidth: { doubleValue: coverImageWidth },
    imageHeight: { doubleValue: coverImageHeight },
    description: toFirestoreValue(description),
    tags: toFirestoreValue(tags),
    likes: toFirestoreValue([]),
    commentCount: { integerValue: "0" },
    nudityRating: { doubleValue: nudityRating },
    violenceRating: { doubleValue: 0.0 },
    privateMetadataId: toFirestoreValue(images[0]?.privateMetadataId || coverImageId),
    images: toFirestoreValue(images),
    isActive: toFirestoreValue(true),
    inactiveReason: { nullValue: null },
    inactiveSince: { nullValue: null }
  };

  const response = await fetch(commitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docPath,
            fields
          },
          updateTransforms: [
            {
              fieldPath: "timeStamp",
              setToServerValue: "REQUEST_TIME"
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = (await response.json()) as any;
    throw new Error(`Failed to save portfolio document: ${err.error?.message || response.statusText}`);
  }
}

/**
 * Fetches portfolio posts for a user
 */
export async function fetchUserPortfolios(params: {
  userId: string;
  idToken: string;
  limit?: number;
}): Promise<Array<Record<string, any>>> {
  const userProfile = await getFirestoreDocument({
    collectionPath: "user-profiles",
    documentId: params.userId,
    idToken: params.idToken
  });

  if (!userProfile || !Array.isArray(userProfile.postIds) || userProfile.postIds.length === 0) {
    return [];
  }

  const posts = await fetchPostsDocuments({
    postIds: userProfile.postIds,
    idToken: params.idToken
  });

  const portfolios = posts.filter(p => p.type === "portfolio");
  const max = params.limit || 20;
  return portfolios.slice(0, max);
}


