import crypto from "node:crypto";
import { FOTO_FIREBASE_CONFIG } from "../config.js";

export interface StorageUploadResult {
  imageId: string;
  imagePath: string;
  imageUrl: string;
  bucket: string;
  fileSizeBytes: number;
}

/**
 * Formats a Date object to yyyyMMddHHmmss matching Foto client
 */
export function formatFotoTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

/**
 * Uploads a processed JPEG image buffer directly to Foto's Firebase Storage bucket
 */
export async function uploadImageToFotoStorage(params: {
  buffer: Buffer;
  userId: string;
  idToken: string;
  folder?: "posts" | "portfolios" | "avatars" | string;
  customImageId?: string;
}): Promise<StorageUploadResult> {
  const { buffer, userId, idToken, folder = "posts", customImageId } = params;

  const imageId = customImageId || crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const timestampStr = formatFotoTimestamp();
  const imagePath = `${folder}/${userId}/${imageId}_${timestampStr}`;

  const bucket = FOTO_FIREBASE_CONFIG.storageBucket;
  const encodedPath = encodeURIComponent(imagePath);
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodedPath}&uploadType=media`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "image/jpeg",
      "Content-Length": String(buffer.length)
    },
    body: buffer
  });

  const data = (await response.json()) as any;

  if (!response.ok) {
    throw new Error(`Failed to upload image to Foto Storage: ${data.error?.message || response.statusText}`);
  }

  // Extract or generate download token
  const downloadToken = data.downloadTokens || crypto.randomUUID();
  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return {
    imageId,
    imagePath,
    imageUrl,
    bucket,
    fileSizeBytes: buffer.length
  };
}
