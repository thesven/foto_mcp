import fs from "node:fs/promises";
import sharp from "sharp";
import exifr from "exifr";
import { PLATFORM_LIMITS } from "../config.js";

export interface ImageInspection {
  filePath: string;
  format?: string;
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  aspectRatioFormatted: string;
  fileSizeBytes: number;
  hasGps: boolean;
  gpsDetails?: { latitude?: number; longitude?: number };
  exif: Record<string, any>;
  targetUploadDimensions: {
    width: number;
    height: number;
  };
  supportedFormat: boolean;
  warning?: string;
}

export interface PreparedImage {
  buffer: Buffer;
  width: number;
  height: number;
  aspectRatio: number;
  fileSizeBytes: number;
  exif: Record<string, any>;
  hasStrippedGps: boolean;
}

/**
 * Calculates display aspect ratio in common photographic terms (e.g. 3:2, 4:3, 1:1, 16:9, 6:7)
 */
function formatAspectRatio(width: number, height: number): string {
  if (!width || !height) return "unknown";
  const ratio = width / height;

  const standardRatios: Array<{ name: string; val: number }> = [
    { name: "1:1", val: 1.0 },
    { name: "3:2 (Landscape)", val: 1.5 },
    { name: "2:3 (Portrait)", val: 0.667 },
    { name: "4:3 (Landscape)", val: 1.333 },
    { name: "3:4 (Portrait)", val: 0.75 },
    { name: "16:9 (Landscape)", val: 1.778 },
    { name: "9:16 (Portrait)", val: 0.5625 },
    { name: "6:7 (Landscape)", val: 1.167 },
    { name: "7:6 (Portrait)", val: 0.857 },
    { name: "65:24 (Panoramic)", val: 2.708 }
  ];

  for (const std of standardRatios) {
    if (Math.abs(ratio - std.val) < 0.04) {
      return std.name;
    }
  }

  return ratio > 1
    ? `${(ratio).toFixed(2)}:1`
    : `1:${(1 / ratio).toFixed(2)}`;
}

/**
 * Format shutter speed decimal into standard photographic fraction (e.g. 1/125s)
 */
function formatExposureTime(exposureTime?: number): string | undefined {
  if (!exposureTime || typeof exposureTime !== "number") return undefined;
  if (exposureTime >= 1) {
    return `${exposureTime}s`;
  }
  const denominator = Math.round(1 / exposureTime);
  return `1/${denominator}s`;
}

/**
 * Inspects a local image file and parses technical EXIF and geometry without modifying it.
 */
export async function inspectImage(filePath: string): Promise<ImageInspection> {
  const fileStat = await fs.stat(filePath);
  const metadata = await sharp(filePath).metadata();

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const format = (metadata.format || "").toLowerCase();

  // Validate format (Foto only allows still photography; no GIFs or videos)
  const isGif = format === "gif" || filePath.toLowerCase().endsWith(".gif");
  const isSupported = ["jpeg", "jpg", "png", "webp", "tiff", "heic", "avif"].includes(format) && !isGif;

  let warning: string | undefined;
  if (isGif) {
    warning = "Foto does not allow GIF images. Please supply a static photo (JPEG, PNG, WebP).";
  } else if (!isSupported) {
    warning = `Format "${format}" might need conversion before upload. Recommended formats are JPEG, PNG, or WebP.`;
  }

  // Parse EXIF
  let rawExif: any = {};
  let gpsData: any = null;
  try {
    rawExif = (await exifr.parse(filePath, {
      tiff: true,
      xmp: true,
      icc: false,
      jfif: false
    })) || {};
  } catch (err) {
    rawExif = {};
  }

  try {
    gpsData = await exifr.gps(filePath);
  } catch (err) {
    gpsData = null;
  }

  const hasGps = Boolean(gpsData && (gpsData.latitude !== undefined || gpsData.longitude !== undefined));

  const cleanExif: Record<string, any> = {};
  if (rawExif.Make) cleanExif.Make = String(rawExif.Make).trim();
  if (rawExif.Model) cleanExif.Model = String(rawExif.Model).trim();
  if (rawExif.LensModel || rawExif.Lens) cleanExif.LensModel = String(rawExif.LensModel || rawExif.Lens).trim();
  if (rawExif.ISO) cleanExif.ISO = Number(rawExif.ISO);
  if (rawExif.FNumber) cleanExif.FNumber = Number(rawExif.FNumber);
  if (rawExif.ExposureTime) {
    cleanExif.ExposureTime = formatExposureTime(rawExif.ExposureTime);
    cleanExif.ExposureTimeRaw = rawExif.ExposureTime;
  }
  if (rawExif.FocalLength) cleanExif.FocalLength = Number(rawExif.FocalLength);
  if (rawExif.FocalLengthIn35mmFormat) cleanExif.FocalLengthIn35mmFormat = Number(rawExif.FocalLengthIn35mmFormat);
  if (rawExif.DateTimeOriginal) cleanExif.DateTimeOriginal = String(rawExif.DateTimeOriginal);
  if (rawExif.Software) cleanExif.Software = String(rawExif.Software);

  // Calculate target upload dimensions
  const maxDim = PLATFORM_LIMITS.maxDimension;
  let targetWidth = width;
  let targetHeight = height;

  if (Math.max(width, height) > maxDim) {
    if (width >= height) {
      targetWidth = maxDim;
      targetHeight = Math.round((height * maxDim) / width);
    } else {
      targetHeight = maxDim;
      targetWidth = Math.round((width * maxDim) / height);
    }
  }

  return {
    filePath,
    format,
    originalWidth: width,
    originalHeight: height,
    aspectRatio: width && height ? width / height : 1,
    aspectRatioFormatted: formatAspectRatio(width, height),
    fileSizeBytes: fileStat.size,
    hasGps,
    gpsDetails: hasGps ? { latitude: gpsData.latitude, longitude: gpsData.longitude } : undefined,
    exif: cleanExif,
    targetUploadDimensions: {
      width: targetWidth,
      height: targetHeight
    },
    supportedFormat: isSupported,
    warning
  };
}

/**
 * Prepares an image for upload according to Foto platform rules:
 * 1. Resizes so max dimension <= 1820px, keeping exact aspect ratio.
 * 2. Compresses to JPEG 80%.
 * 3. Scrubs GPS and thumbnail metadata from binary for privacy.
 * 4. Extracts sanitized camera EXIF map for image-private-metadata Firestore storage.
 */
export async function prepareImageForUpload(filePath: string): Promise<PreparedImage> {
  const inspection = await inspectImage(filePath);

  if (!inspection.supportedFormat) {
    throw new Error(inspection.warning || `Unsupported file format: ${inspection.format}`);
  }

  const { width: targetWidth, height: targetHeight } = inspection.targetUploadDimensions;

  // Sharp processing: resize + strip GPS metadata by not preserving GPS tags, encode as JPEG 80%
  const processedBuffer = await sharp(filePath)
    .rotate() // Automatically orient based on EXIF orientation
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: PLATFORM_LIMITS.jpegQuality,
      progressive: true,
      mozjpeg: true
    })
    .toBuffer();

  const finalMetadata = await sharp(processedBuffer).metadata();

  return {
    buffer: processedBuffer,
    width: finalMetadata.width || targetWidth,
    height: finalMetadata.height || targetHeight,
    aspectRatio: (finalMetadata.width || targetWidth) / (finalMetadata.height || targetHeight),
    fileSizeBytes: processedBuffer.length,
    exif: inspection.exif,
    hasStrippedGps: inspection.hasGps
  };
}
