import { FotoClient } from "../src/foto-client.js";

async function run() {
  console.log("=== FOTO MCP: PUBLISHING LIVE POST TO FOTO APP ===");

  const client = new FotoClient();

  const filePath = "/tmp/18113309399234410.jpg";
  const caption = `🐿️ American Red Squirrel (Peeking)

Tamiasciurus hudsonicus

Ever have the feeling you're the one being watched? I was out watching some deer in the morning and turn around to see this guy watching me watching them.

Fair enough, too — red squirrels are famously territorial and will scold anything that wanders into their patch, humans included.

📷 ISO 2000 · 300mm · f/2.8 · 1/1000s

📌 Southern Ontario`;

  const tags = ["Wildlife", "Animals", "Nature"];

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
