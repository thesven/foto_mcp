import fs from "node:fs/promises";
import path from "node:path";
import { suggestTags } from "../tags.js";

export interface XmpMetadata {
  sidecarPath: string;
  rating?: number; // xmp:Rating (-1 to 5)
  colorLabel?: string; // xmp:Label (e.g. "Select", "Red", "Green", "Blue", "Yellow", "Purple")
  title?: string; // dc:title
  description?: string; // dc:description / ImageDescription
  keywords: string[]; // dc:subject / lr:hierarchicalSubject
  copyright?: string; // dc:rights
  creator?: string; // dc:creator
  cameraMake?: string; // tiff:Make
  cameraModel?: string; // tiff:Model
  lensModel?: string; // aux:Lens / exifEX:LensModel
  filmSimulation?: string; // Fujifilm FilmMode / FilmSimulation
  filmStock?: string; // Analog film stock note
  suggestedTags: string[];
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#xA;/gi, "\n")
    .trim();
}

function extractAttributeOrTag(xml: string, nsTag: string): string | undefined {
  // Check attribute form: xmp:Rating="5"
  const attrRegex = new RegExp(`\\b${nsTag}\\s*=\\s*"([^"]*)"`, "i");
  const attrMatch = xml.match(attrRegex);
  if (attrMatch && attrMatch[1].trim() !== "") {
    return decodeXmlEntities(attrMatch[1]);
  }

  // Check element form: <xmp:Rating>5</xmp:Rating>
  const elemRegex = new RegExp(`<${nsTag}[^>]*>([\\s\\S]*?)<\\/${nsTag}>`, "i");
  const elemMatch = xml.match(elemRegex);
  if (elemMatch && elemMatch[1].trim() !== "") {
    // If it contains <rdf:Alt> or <rdf:Seq> or <rdf:li>, extract inner text of first <rdf:li>
    const liMatch = elemMatch[1].match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (liMatch) {
      return decodeXmlEntities(liMatch[1].replace(/<[^>]+>/g, ""));
    }
    return decodeXmlEntities(elemMatch[1].replace(/<[^>]+>/g, ""));
  }

  return undefined;
}

function extractListItems(xml: string, containerTag: string): string[] {
  const results: string[] = [];
  const blockRegex = new RegExp(`<${containerTag}[^>]*>([\\s\\S]*?)<\\/${containerTag}>`, "gi");
  for (const match of xml.matchAll(blockRegex)) {
    const inner = match[1];
    for (const li of inner.matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/gi)) {
      const cleaned = decodeXmlEntities(li[1].replace(/<[^>]+>/g, ""));
      if (cleaned) {
        // Handle hierarchical subjects like "Genre|Street|Night"
        const parts = cleaned.split("|").map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
          if (!results.includes(p)) {
            results.push(p);
          }
        }
      }
    }
  }
  return results;
}

/**
 * Parses raw XMP XML string into structured XmpMetadata
 */
export function parseXmpString(xml: string, sidecarPath = "memory.xmp"): XmpMetadata {
  const ratingRaw = extractAttributeOrTag(xml, "xmp:Rating");
  const rating = ratingRaw !== undefined && !isNaN(Number(ratingRaw)) ? Number(ratingRaw) : undefined;

  const colorLabel = extractAttributeOrTag(xml, "xmp:Label") || extractAttributeOrTag(xml, "photoshop:Urgency");
  const title = extractAttributeOrTag(xml, "dc:title");
  const description =
    extractAttributeOrTag(xml, "dc:description") ||
    extractAttributeOrTag(xml, "exif:UserComment") ||
    extractAttributeOrTag(xml, "photoshop:Headline");
  const copyright = extractAttributeOrTag(xml, "dc:rights");
  const creator = extractAttributeOrTag(xml, "dc:creator");
  const cameraMake = extractAttributeOrTag(xml, "tiff:Make");
  const cameraModel = extractAttributeOrTag(xml, "tiff:Model");
  const lensModel =
    extractAttributeOrTag(xml, "aux:Lens") ||
    extractAttributeOrTag(xml, "exifEX:LensModel") ||
    extractAttributeOrTag(xml, " lens:LensModel");

  const filmSimulation =
    extractAttributeOrTag(xml, "crs:CameraProfile") ||
    extractAttributeOrTag(xml, "Fujifilm:FilmMode") ||
    extractAttributeOrTag(xml, "exif:FilmSimulation");

  const filmStock =
    extractAttributeOrTag(xml, "AnalogExif:Film") ||
    extractAttributeOrTag(xml, "xmp:FilmStock");

  const dcSubjects = extractListItems(xml, "dc:subject");
  const hierarchicalSubjects = extractListItems(xml, "lr:hierarchicalSubject");
  const keywords = Array.from(new Set([...dcSubjects, ...hierarchicalSubjects]));

  const cameraInfo = [cameraMake, cameraModel, lensModel, filmSimulation, filmStock]
    .filter(Boolean)
    .join(" ");

  const tagSuggestion = suggestTags({
    caption: [title, description].filter(Boolean).join(" "),
    cameraInfo,
    keywords
  });

  return {
    sidecarPath,
    rating,
    colorLabel,
    title,
    description,
    keywords,
    copyright,
    creator,
    cameraMake,
    cameraModel,
    lensModel,
    filmSimulation,
    filmStock,
    suggestedTags: tagSuggestion.suggestedTags
  };
}

/**
 * Resolves an accompanying .xmp sidecar file for a given image path if one exists
 * (supports both `photo.xmp` and `photo.jpg.xmp` conventions from Lightroom, Capture One, and Darktable).
 */
export async function findXmpSidecarForImage(imageFilePath: string): Promise<string | null> {
  const dir = path.dirname(imageFilePath);
  const ext = path.extname(imageFilePath);
  const baseNoExt = path.basename(imageFilePath, ext);
  const fullBase = path.basename(imageFilePath);

  const candidates = [
    path.join(dir, `${baseNoExt}.xmp`),
    path.join(dir, `${baseNoExt}.XMP`),
    path.join(dir, `${fullBase}.xmp`),
    path.join(dir, `${fullBase}.XMP`)
  ];

  for (const candidate of candidates) {
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) {
        return candidate;
      }
    } catch {
      // try next
    }
  }

  return null;
}

/**
 * Parses an .xmp sidecar file (or resolves the sidecar for an image file path)
 */
export async function parseXmpFile(filePath: string): Promise<XmpMetadata> {
  let targetXmpPath = filePath;
  if (!filePath.toLowerCase().endsWith(".xmp")) {
    const found = await findXmpSidecarForImage(filePath);
    if (!found) {
      throw new Error(`No .xmp sidecar file found for "${filePath}".`);
    }
    targetXmpPath = found;
  }

  const xml = await fs.readFile(targetXmpPath, "utf-8");
  return parseXmpString(xml, targetXmpPath);
}
