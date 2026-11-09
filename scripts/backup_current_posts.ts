import fs from "node:fs/promises";
import path from "node:path";
import { getValidAuthSession } from "../src/api/auth.js";
import { fetchUserProfile, getFirestoreDocument } from "../src/api/firestore.js";

async function backup() {
  console.log("=== BACKING UP EXISTING FOTO POSTS ===");
  const session = await getValidAuthSession();
  const profile = await fetchUserProfile({
    userId: session.userId,
    idToken: session.idToken
  });

  if (!profile || !profile.postIds) {
    throw new Error("Could not load user profile or postIds.");
  }

  console.log(`Found ${profile.postIds.length} posts for user @${profile.username} (${session.userId}).`);

  const backupDir = path.join(process.cwd(), "backup");
  await fs.mkdir(backupDir, { recursive: true });

  const backupData: {
    timestamp: string;
    profile: any;
    posts: any[];
  } = {
    timestamp: new Date().toISOString(),
    profile,
    posts: []
  };

  for (let i = 0; i < profile.postIds.length; i++) {
    const postId = profile.postIds[i];
    console.log(`Backing up post ${i + 1}/${profile.postIds.length}: ${postId}...`);
    try {
      const doc = await getFirestoreDocument({
        collectionPath: "posts",
        documentId: postId,
        idToken: session.idToken
      });
      backupData.posts.push(doc);
    } catch (err: any) {
      console.warn(`Warning: failed to fetch post ${postId}:`, err.message);
    }
  }

  const backupFile = path.join(backupDir, `foto_posts_backup_${Date.now()}.json`);
  const latestBackupFile = path.join(backupDir, "foto_posts_backup_latest.json");

  await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2), "utf-8");
  await fs.writeFile(latestBackupFile, JSON.stringify(backupData, null, 2), "utf-8");

  console.log(`\n✅ Backup successfully saved to:\n  - ${backupFile}\n  - ${latestBackupFile}`);
  console.log(`Total posts backed up: ${backupData.posts.length}`);
}

backup().catch(console.error);
