import path from "node:path";
import { InstagramSyncTool } from "../src/sync/instagram.js";
import { FotoClient } from "../src/foto-client.js";

async function main() {
  console.log("=================================================");
  console.log("   FOTO MCP - INSTAGRAM SYNC DRY RUN TEST       ");
  console.log("=================================================\n");

  const client = new FotoClient();
  const syncTool = new InstagramSyncTool(client);

  console.log("Fetching existing Foto profile to check for duplicate posts...");
  let existingFotoCaptions: string[] = [];
  try {
    const profile = await client.getUserProfile();
    console.log(`Authenticated as Foto user: @${profile.username} (${profile.name})`);
    console.log(`Current published Foto posts count: ${profile.postIds?.length || 0}`);
    
    // Add known sample strings to test deduplication detection
    existingFotoCaptions = [
      "We had spent most of the day looking for moose",
      "Moose (Bulls) Alces alces"
    ];
  } catch (err: any) {
    console.log("Warning: Could not fetch profile, running without remote deduplication check:", err.message);
  }

  console.log("\n--- TEST 1: Dry run on Latest Export (posts_1.html) ---");
  const reportLatest = await syncTool.runSync({
    htmlFilePath: "/tmp/posts_1.html",
    mediaDir: "/tmp",
    maxPosts: 5,
    dryRun: true,
    existingFotoCaptions
  });

  console.log(`Total parsed posts: ${reportLatest.totalParsed}`);
  console.log(`Ready to publish (dry run): ${reportLatest.readyToPublish}`);
  console.log(`Already published (skipped): ${reportLatest.alreadyPublishedCount}\n`);

  for (const c of reportLatest.candidates) {
    console.log(`Title: ${c.post.title}`);
    console.log(`Date: ${c.post.dateStr || "Unknown"}`);
    console.log(`Status: ${c.status}`);
    console.log(`Resolved Image: ${c.resolvedImagePath || "None (Not downloaded yet)"}`);
    if (c.uploadDimensions) {
      console.log(`Target Foto Dimensions: ${c.uploadDimensions.width}x${c.uploadDimensions.height}px`);
    }
    console.log(`Original Hashtags count: ${c.post.hashtags.length} (#${c.post.hashtags.slice(0, 4).join(" #")}...)`);
    console.log(`Selected Foto Curated Tags: [${c.suggestedTags.join(", ")}]`);
    console.log(`Tag Assignment Note: ${c.tagExplanation}`);
    console.log(`GPS Scrubbed: ${c.gpsScrubbed ? "YES (strips recorded GPS for wildlife protection)" : "No GPS detected"}`);
    console.log(`\nProposed Cleaned Caption for Foto:\n${c.post.cleanedCaption}\n`);
    console.log("-------------------------------------------------\n");
  }

  console.log("\n--- TEST 2: Dry run on Earlier Wildlife Batch (posts_earlier.html) ---");
  const reportEarlier = await syncTool.runSync({
    htmlFilePath: "/tmp/posts_earlier.html",
    mediaDir: "/tmp",
    maxPosts: 12,
    dryRun: true,
    existingFotoCaptions
  });

  console.log(`Total parsed posts: ${reportEarlier.totalParsed}`);
  console.log(`Already on Foto (Deduplicated): ${reportEarlier.alreadyPublishedCount}`);
  console.log(`Candidates summary:`);
  reportEarlier.candidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. [${c.status}] "${c.post.title}" -> Tags: [${c.suggestedTags.join(", ")}] ${c.isAlreadyPublished ? "(DUPLICATE DETECTED)" : ""}`);
  });

  console.log("\n=================================================");
  console.log("             DRY RUN COMPLETED SUCCESSFULLY       ");
  console.log("=================================================");
}

main().catch(console.error);
