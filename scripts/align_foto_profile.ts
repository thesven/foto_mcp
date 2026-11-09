import fs from "node:fs/promises";
import path from "node:path";
import { FotoClient } from "../src/foto-client.js";
import { getValidAuthSession } from "../src/api/auth.js";
import {
  fetchUserProfile,
  deleteFirestoreDocument,
  resetUserProfilePosts
} from "../src/api/firestore.js";

const POST_TAGS_MAP: Record<string, string[]> = {
  "17943527556357482.jpg": ["Nature", "Landscape", "Blue Hour"],
  "18447252322130391.jpg": ["Wildlife", "Animals", "Nature"],
  "18128112380479074.jpg": ["Wildlife", "Animals", "Nature"],
  "17907347256582787.jpg": ["Birds", "Wildlife", "Nature"],
  "18140269009616778.jpg": ["Wildlife", "Animals"],
  "18638607670057010.jpg": ["Wildlife", "Animals"],
  "18069430703517992.jpg": ["Birds", "Wildlife"],
  "17914533627507191.jpg": ["Wildlife", "Animals", "Nature"],
  "18118274168077134.jpg": ["Wildlife", "Animals"],
  "18128899228633224.jpg": ["Wildlife", "Animals"],
  "18135668089677333.jpg": ["Birds", "Wildlife", "Water"],
  "18024820286868773.jpg": ["Wildlife", "Animals", "Water"],
  "18060755771800064.jpg": ["Wildlife", "Animals", "Water"],
  "18113309399234410.jpg": ["Wildlife", "Animals"]
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log("=================================================");
  console.log("      FOTO PROFILE ALIGNMENT ROUTINE            ");
  console.log("=================================================\n");

  const mediaDir = "/tmp/instagram_media";
  const catalogPath = path.join(process.cwd(), "backup", "instagram_posts_catalog.json");
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf-8"));

  // 1. Authenticate
  console.log("1. Authenticating with Foto...");
  const auth = await getValidAuthSession();
  const { userId, idToken } = auth;
  console.log(`   Authenticated as UID: ${userId}\n`);

  // 2. Fetch current profile
  console.log("2. Fetching current Foto profile state...");
  const profile = await fetchUserProfile({ userId, idToken });
  if (!profile) {
    throw new Error(`Profile not found for userId ${userId}`);
  }

  const existingPostIds: string[] = profile.postIds || [];
  console.log(`   Found ${existingPostIds.length} existing posts on profile.`);

  // 3. Erase existing posts
  console.log("\n3. Erasing existing posts from Foto...");
  let deletedCount = 0;
  for (const postId of existingPostIds) {
    try {
      await deleteFirestoreDocument({
        collectionPath: "posts",
        documentId: postId,
        idToken
      });
      deletedCount++;
      process.stdout.write(`   Deleted post ${deletedCount}/${existingPostIds.length}: ${postId}\r`);
    } catch (err: any) {
      console.warn(`\n   Warning: Failed to delete post ${postId}:`, err.message);
    }
  }
  console.log(`\n   Finished deleting ${deletedCount} post documents.`);

  // 4. Reset postIds array in profile
  console.log("\n4. Resetting user profile post list in Firestore...");
  await resetUserProfilePosts({ userId, idToken });
  console.log("   User profile postIds cleared successfully.\n");

  // Verify profile reset
  const clearedProfile = await fetchUserProfile({ userId, idToken });
  console.log(`   Verified profile post count: ${(clearedProfile?.postIds || []).length}\n`);

  // 5. Sequential Publishing
  console.log("=================================================");
  console.log(`5. Publishing ${catalog.length} Instagram posts (Oldest -> Newest)...`);
  console.log("=================================================\n");

  const client = new FotoClient();
  const publishedResults = [];

  for (let i = 0; i < catalog.length; i++) {
    const item = catalog[i];
    let imageFileName = item.imageFile;
    let localImagePath = path.join(mediaDir, imageFileName);

    // Check if file exists, fallback to otter alternate if applicable
    try {
      await fs.access(localImagePath);
    } catch {
      if (imageFileName === "18024820286868773.jpg") {
        localImagePath = path.join(mediaDir, "18060755771800064.jpg");
        imageFileName = "18060755771800064.jpg";
      }
    }

    const tags = POST_TAGS_MAP[imageFileName] || ["Wildlife", "Nature"];

    console.log(`[${i + 1}/${catalog.length}] Publishing: "${item.title.slice(0, 40)}" (${item.date})...`);
    console.log(`     Image: ${imageFileName}`);
    console.log(`     Tags: ${tags.join(", ")}`);

    try {
      const result = await client.publishPost({
        filePath: localImagePath,
        caption: item.fullCaption || item.captionPreview,
        tags,
        dryRun: false
      });

      console.log(`     -> SUCCESS! Post ID: ${result.postId}`);
      publishedResults.push({
        orderIndex: i + 1,
        date: item.date,
        title: item.title,
        postId: result.postId,
        tags
      });
    } catch (err: any) {
      console.error(`     -> ERROR publishing ${item.title}:`, err.message);
      throw err;
    }

    // Small delay between posts to ensure clean Firestore server timestamp incrementing
    if (i < catalog.length - 1) {
      console.log("     Waiting 3s before next post...");
      await sleep(3000);
    }
  }

  // 6. Final verification
  console.log("\n=================================================");
  console.log("6. Final Profile Verification...");
  console.log("=================================================\n");
  const finalProfile = await fetchUserProfile({ userId, idToken });
  const finalPostIds: string[] = finalProfile?.postIds || [];
  console.log(`Profile now has ${finalPostIds.length} posts.`);
  console.log("Newest post on top of Foto grid:", finalPostIds[finalPostIds.length - 1]);

  const recordPath = path.join(process.cwd(), "backup", "aligned_posts_record.json");
  await fs.writeFile(recordPath, JSON.stringify(publishedResults, null, 2), "utf-8");
  console.log(`\nAlignment log saved to: ${recordPath}`);
}

run().catch((err) => {
  console.error("\nFATAL ERROR DURING ALIGNMENT:", err);
  process.exit(1);
});
