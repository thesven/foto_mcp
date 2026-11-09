import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { parseInstagramPostsHtml, ParsedInstagramPost } from "../src/sync/instagram.js";

const execAsync = promisify(exec);

interface CatalogItem {
  folderName: string;
  postHtmlFile: string;
  post: ParsedInstagramPost;
  parsedDate?: Date;
}

async function run() {
  console.log("=== CATALOGING INSTAGRAM ARCHIVE FROM GOOGLE DRIVE ===");
  const exportsDir = "/tmp/instagram_exports";
  await fs.mkdir(exportsDir, { recursive: true });

  // 1. Search all posts HTML files in Drive
  console.log("Searching Drive for posts HTML files...");
  const { stdout } = await execAsync('gdrive readonly search --name-contains "posts" --json');
  const files: Array<{ id: string; name: string; mimeType: string }> = JSON.parse(stdout);

  const postsHtmlFiles = files.filter(
    (f) =>
      (f.name === "posts.html" || f.name.startsWith("posts_")) &&
      !f.name.includes("posts_viewed") &&
      f.name.endsWith(".html")
  );

  console.log(`Found ${postsHtmlFiles.length} posts HTML files in Drive.`);

  const postsByNormalizedKey = new Map<string, CatalogItem>();

  for (let i = 0; i < postsHtmlFiles.length; i++) {
    const f = postsHtmlFiles[i];
    const localPath = path.join(exportsDir, `${f.id}_${f.name}`);
    
    // Download if not already downloaded
    try {
      await fs.access(localPath);
    } catch {
      console.log(`Downloading (${i + 1}/${postsHtmlFiles.length}): ${f.name} (ID: ${f.id})...`);
      try {
        await execAsync(`gdrive readonly download ${f.id} --out ${localPath}`);
      } catch (err: any) {
        console.warn(`Failed to download ${f.id}:`, err.message);
        continue;
      }
    }

    // Parse posts from HTML
    const content = await fs.readFile(localPath, "utf-8");
    const parsed = parseInstagramPostsHtml(content);

    for (const post of parsed) {
      if (!post.imageFileName) {
        continue;
      }

      let parsedDate: Date | undefined;
      if (post.dateStr) {
        parsedDate = new Date(post.dateStr);
        if (isNaN(parsedDate.getTime())) {
          parsedDate = undefined;
        }
      }

      // Deduplicate identical posts across multiple export zips by normalized caption prefix
      const normKey = (post.title + " " + post.cleanedCaption.slice(0, 50))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      const existing = postsByNormalizedKey.get(normKey);
      if (!existing || (post.originalCaption.length > existing.post.originalCaption.length)) {
        postsByNormalizedKey.set(normKey, {
          folderName: f.name,
          postHtmlFile: localPath,
          post,
          parsedDate
        });
      }
    }
  }

  const allPosts = [...postsByNormalizedKey.values()];

  // Sort chronologically: oldest first -> newest last
  // When posting in this order, the newest ends up at the top of the Foto profile grid!
  allPosts.sort((a, b) => {
    if (a.parsedDate && b.parsedDate) {
      return a.parsedDate.getTime() - b.parsedDate.getTime();
    }
    return 0;
  });

  console.log(`\n=================================================`);
  console.log(`TOTAL UNIQUE INSTAGRAM POSTS FOUND: ${allPosts.length}`);
  console.log(`=================================================\n`);

  console.log("CHRONOLOGICAL PUBLISHING ORDER (Oldest to Newest):");
  console.log("(Posting in this order ensures your newest post is at the top-left on Foto)\n");

  const catalogSummary = allPosts.map((item, idx) => {
    const p = item.post;
    const dateFormatted = item.parsedDate ? item.parsedDate.toISOString().slice(0, 10) : p.dateStr || "Unknown";
    return {
      orderIndex: idx + 1,
      date: dateFormatted,
      title: p.title,
      imageFile: p.imageFileName,
      cameraInfo: p.cameraInfo || "None",
      location: p.location || "None",
      fullCaption: p.cleanedCaption,
      captionPreview: p.cleanedCaption.slice(0, 80).replace(/\n/g, " ") + "..."
    };
  });

  console.log(JSON.stringify(catalogSummary, null, 2));

  // Save catalog
  const catalogPath = path.join(process.cwd(), "backup", "instagram_posts_catalog.json");
  await fs.writeFile(catalogPath, JSON.stringify(catalogSummary, null, 2), "utf-8");
  console.log(`\nCatalog saved to: ${catalogPath}`);
}

run().catch(console.error);
