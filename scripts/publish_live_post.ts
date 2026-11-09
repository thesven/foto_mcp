import { FotoClient } from "../src/foto-client.js";

async function run() {
  console.log("=== FOTO MCP: PUBLISHING LIVE POST TO FOTO APP ===");

  const filePath = process.argv[2];
  if (!filePath) {
    console.log("\nUsage:\n  npx tsx scripts/publish_live_post.ts <image-path> [caption] [tags...]");
    console.log("\nExample:\n  npx tsx scripts/publish_live_post.ts ~/Photos/sunset.jpg \"Golden hour over the lake\" \"Landscape\" \"Golden Hour\"\n");
    process.exit(1);
  }

  const caption = process.argv[3] || "Captured on a quiet morning.";
  const tags = process.argv.slice(4).length > 0 ? process.argv.slice(4) : ["Everyday Life"];

  const client = new FotoClient();

  console.log("Image File:", filePath);
  console.log("Tags:", tags);
  console.log("Publishing live post now...");

  try {
    const result = await client.publishPost({
      filePath,
      caption,
      tags,
      dryRun: false
    });

    console.log("\n=================================================");
    console.log("🎉 POST PUBLISHED SUCCESSFULLY TO FOTO APP! 🎉");
    console.log("=================================================");
    console.log("Post ID:", result.postId);
    console.log("Post URL:", result.postUrl);
    console.log("Dimensions:", `${result.dimensions.width}x${result.dimensions.height}px`);
    console.log("Image Storage URL:", result.imageUrl);
    console.log("Tags:", result.tags);
    console.log("Moderation Passed! Score:", result.moderationScore);
    console.log("Has Stripped GPS:", result.hasStrippedGps);
    console.log("Message:", result.message);
  } catch (err: any) {
    console.error("\n❌ Live publish failed:", err.message || err);
    process.exit(1);
  }
}

run();
