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
 * Deletes a post document, cleans up associated private metadata, and removes postId from user profile.
 */
export async function deletePostFromFirestore(params: {
  postId: string;
  userId: string;
  idToken: string;
}): Promise<boolean> {
  const { postId, userId, idToken } = params;

  // 1. Fetch post doc to find associated privateMetadataId
  const postDoc = await getFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    idToken
  });

  const privateMetadataId = postDoc?.privateMetadataId;

  // 2. Delete posts/{postId}
  await deleteFirestoreDocument({
    collectionPath: "posts",
    documentId: postId,
    idToken
  });

  // 3. Delete image-private-metadata if present
  if (privateMetadataId) {
    try {
      await deleteFirestoreDocument({
        collectionPath: "image-private-metadata",
        documentId: privateMetadataId,
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
