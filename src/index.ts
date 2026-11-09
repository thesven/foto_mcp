#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FotoClient } from "./foto-client.js";
import { signInWithEmailAndPassword, clearCredentials, getAuthStatus } from "./api/auth.js";
import { searchTags, suggestTags, FOTO_ALLOWED_TAGS } from "./tags.js";
import { InstagramSyncTool } from "./sync/instagram.js";

const client = new FotoClient();

const server = new McpServer({
  name: "foto_mcp",
  version: "1.1.0"
});

// Tool 1: foto_auth_status
server.tool(
  "foto_auth_status",
  "Check the current authentication status with Foto app (logged-in user, token validity).",
  {},
  async () => {
    try {
      const status = await getAuthStatus();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error checking auth status: ${err.message}` }]
      };
    }
  }
);

// Tool 2: foto_login
server.tool(
  "foto_login",
  "Authenticate with Foto app using your account email and password. Securely stores credentials locally.",
  {
    email: z.string().email().describe("Your Foto account email address"),
    password: z.string().min(1).describe("Your Foto account password")
  },
  async ({ email, password }) => {
    try {
      const creds = await signInWithEmailAndPassword(email, password);
      return {
        content: [
          {
            type: "text",
            text: `Successfully authenticated with Foto!\nUser ID: ${creds.userId}\nEmail: ${creds.email}\nSession token cached securely.`
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Foto login failed: ${err.message}` }]
      };
    }
  }
);

// Tool 3: foto_logout
server.tool(
  "foto_logout",
  "Log out of Foto app and delete stored credentials from local disk.",
  {},
  async () => {
    try {
      await clearCredentials();
      return {
        content: [
          {
            type: "text",
            text: "Successfully logged out of Foto and cleared cached credentials."
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error during logout: ${err.message}` }]
      };
    }
  }
);

// Tool 4: foto_inspect_image
server.tool(
  "foto_inspect_image",
  "Inspect a local image file without uploading: extracts technical EXIF (camera, lens, ISO, shutter, aperture), dimensions, aspect ratio, and checks for GPS presence.",
  {
    filePath: z.string().describe("Absolute file path to the local image (JPEG, PNG, WebP, HEIC, TIFF)")
  },
  async ({ filePath }) => {
    try {
      const inspection = await client.inspectPhoto(filePath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(inspection, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to inspect image: ${err.message}` }]
      };
    }
  }
);

// Tool 5: foto_suggest_tags
server.tool(
  "foto_suggest_tags",
  "Suggest 1 to 3 valid tags from Foto's official 303 curated tags list based on caption, camera/film notes, or subject keywords.",
  {
    caption: z.string().optional().describe("Intended photo caption or description"),
    cameraInfo: z.string().optional().describe("Camera model, lens, or film stock (e.g. 'Leica M6, Portra 400')"),
    keywords: z.array(z.string()).optional().describe("Optional subject/style keywords (e.g. ['street', 'night'])")
  },
  async (params) => {
    try {
      const suggestions = suggestTags(params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(suggestions, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tag suggestion failed: ${err.message}` }]
      };
    }
  }
);

// Tool 6: foto_search_tags
server.tool(
  "foto_search_tags",
  "Search Foto's official 303 curated allowed tags whitelist by keyword or prefix.",
  {
    query: z.string().describe("Search keyword (e.g. 'film', 'analog', 'street', 'light')"),
    limit: z.number().int().positive().optional().describe("Maximum number of results to return (default: 20)")
  },
  async ({ query, limit = 20 }) => {
    try {
      const matches = searchTags(query, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                totalCuratedTags: FOTO_ALLOWED_TAGS.length,
                matchedCount: matches.length,
                matches
              },
              null,
              2
            )
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tag search error: ${err.message}` }]
      };
    }
  }
);

// Tool 7: foto_draft_post
server.tool(
  "foto_draft_post",
  "Preview and validate a post draft without publishing. Validates tag constraints (1-3 from whitelist), formats EXIF summary, and checks image parameters.",
  {
    filePath: z.string().describe("Absolute file path to local image"),
    caption: z.string().describe("The post caption or narrative description"),
    tags: z.array(z.string()).describe("1 to 3 tags chosen from Foto's curated list")
  },
  async ({ filePath, caption, tags }) => {
    try {
      const draft = await client.draftPost({ filePath, caption, tags });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(draft, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Draft validation failed: ${err.message}` }]
      };
    }
  }
);

// Tool 8: foto_publish_post
server.tool(
  "foto_publish_post",
  "Publish a single photo post to Foto. Automatically normalizes resolution (max 1820px, JPEG 80%), scrubs GPS for privacy, uploads to Storage, passes moderation, and creates the post. Use dryRun=true to test locally without publishing.",
  {
    filePath: z.string().describe("Absolute file path to local photo"),
    caption: z.string().describe("The post caption or narrative description"),
    tags: z.array(z.string()).describe("1 to 3 tags chosen from Foto's curated whitelist"),
    dryRun: z.boolean().optional().describe("If true, validates and prepares image without uploading or requiring login")
  },
  async ({ filePath, caption, tags, dryRun = false }) => {
    try {
      const result = await client.publishPost({
        filePath,
        caption,
        tags,
        dryRun
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to publish post: ${err.message}` }]
      };
    }
  }
);

// Tool 9: foto_publish_series
server.tool(
  "foto_publish_series",
  "Publish a multi-image Series (2 to 5 photos) under a single post to Foto. Use dryRun=true to validate locally without uploading.",
  {
    filePaths: z.array(z.string()).min(2).max(5).describe("List of 2 to 5 image file paths in display order"),
    caption: z.string().describe("The series caption or narrative description"),
    tags: z.array(z.string()).describe("1 to 3 tags chosen from Foto's curated whitelist"),
    dryRun: z.boolean().optional().describe("If true, validates and prepares all images without uploading or requiring login")
  },
  async ({ filePaths, caption, tags, dryRun = false }) => {
    try {
      const result = await client.publishSeries({
        filePaths,
        caption,
        tags,
        dryRun
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to publish series: ${err.message}` }]
      };
    }
  }
);

// Tool 10: foto_get_user_profile
server.tool(
  "foto_get_user_profile",
  "Retrieve profile details and stats for the authenticated Foto user (username, bio, post count, following/followers).",
  {},
  async () => {
    try {
      const profile = await client.getUserProfile();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(profile, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to retrieve user profile: ${err.message}` }]
      };
    }
  }
);

// Tool 11: foto_sync_instagram
server.tool(
  "foto_sync_instagram",
  "Synchronize posts from an Instagram data export (HTML/JSON) to Foto. Cleans hashtags, suggests 1-3 curated tags, normalizes dimensions, scrubs GPS, and checks against already-published Foto posts. Default dryRun=true validates everything without publishing.",
  {
    htmlFilePath: z.string().describe("File path to Instagram export HTML file (e.g. posts_1.html)"),
    mediaDir: z.string().optional().describe("Directory containing extracted Instagram images"),
    maxPosts: z.number().int().positive().optional().describe("Maximum posts to process in this run (default: 5)"),
    dryRun: z.boolean().optional().describe("If true (default), performs complete dry-run validation without uploading")
  },
  async ({ htmlFilePath, mediaDir, maxPosts = 5, dryRun = true }) => {
    try {
      let existingFotoCaptions: string[] = [];
      try {
        const profile = await client.getUserProfile();
        // Extract existing post IDs/descriptions if available
        if (profile && profile.recentTags) {
          existingFotoCaptions = profile.recentTags;
        }
      } catch {
        // Continue if profile fetch fails
      }

      const syncTool = new InstagramSyncTool(client);
      const report = await syncTool.runSync({
        htmlFilePath,
        mediaDir,
        maxPosts,
        dryRun,
        existingFotoCaptions
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(report, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Instagram sync failed: ${err.message}` }]
      };
    }
  }
);

// Tool 12: foto_browse_tag
server.tool(
  "foto_browse_tag",
  "Browse recent public posts on Foto under a curated tag (e.g. 'Fine Art Nude', 'Boudoir', 'Street', 'Landscape', 'Analog').",
  {
    tag: z.string().describe("Curated tag name from Foto's 303 allowed tags list (e.g. 'Fine Art Nude', 'Boudoir', 'Street')"),
    limit: z.number().int().positive().max(50).optional().describe("Maximum number of posts to return (default: 20)"),
    shard: z.number().int().min(0).optional().describe("Specific tag index shard number (defaults to latest shard)")
  },
  async ({ tag, limit, shard }) => {
    try {
      const results = await client.browseTag({ tag, limit, shard });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to browse tag "${tag}": ${err.message}` }]
      };
    }
  }
);

// Tool 13: foto_find_photographers_by_tag
server.tool(
  "foto_find_photographers_by_tag",
  "Find photographers on Foto who publish under a specific curated tag (such as 'Fine Art Nude', 'Boudoir', 'Portrait', 'Street', etc.). Resolves user profiles, bios, stats, and profile URLs.",
  {
    tag: z.string().describe("Curated tag name from Foto's 303 allowed tags list (e.g. 'Fine Art Nude', 'Boudoir')"),
    limit: z.number().int().positive().max(25).optional().describe("Maximum number of photographers to return (default: 10)")
  },
  async ({ tag, limit }) => {
    try {
      const results = await client.findPhotographersByTag({ tag, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to find photographers for tag "${tag}": ${err.message}` }]
      };
    }
  }
);

// MCP Resource: Official 303 Curated Allowed Tags Whitelist
server.registerResource(
  "foto-curated-tags",
  "foto://curated-tags",
  {
    title: "Foto Official Curated Tags",
    description: "The complete whitelist of 303 curated tags permitted on Foto.",
    mimeType: "application/json"
  },
  async () => {
    return {
      contents: [
        {
          uri: "foto://curated-tags",
          mimeType: "application/json",
          text: JSON.stringify(FOTO_ALLOWED_TAGS, null, 2)
        }
      ]
    };
  }
);

// MCP Prompt: Formulate & Curate a Foto Post
server.registerPrompt(
  "curate_foto_post",
  {
    title: "Curate and Prepare Foto Post",
    description: "Formulate a thoughtful photographic post for Foto adhering to platform ethos (no hashtags, 1-3 curated tags, technical EXIF summary)."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please help me prepare a photo for publishing to Foto (https://fotoapp.co/).

Here are the Foto guidelines to follow:
1. Pure photography focus: Inspect the photo with foto_inspect_image to check aspect ratio, geometry, and technical EXIF (camera, lens, shutter, aperture, ISO).
2. Curated tags only: Choose 1 to 3 tags strictly from the 303 allowed curated tags list (use foto_suggest_tags or foto_search_tags). Never include Instagram-style hashtags or spam tags.
3. Narrative & Context: Draft a thoughtful caption discussing the creative intent, subject, location, or technical conditions.
4. Privacy: GPS data will be automatically stripped upon publishing.
5. Review draft: Preview the post with foto_draft_post before publishing live with foto_publish_post.`
          }
        }
      ]
    };
  }
);

export { server, client };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Foto MCP Server running on stdio transport.");
}

if (process.env.NODE_ENV !== "test" && !process.env.FOTO_MCP_TEST) {
  main().catch((err) => {
    console.error("Fatal error starting Foto MCP Server:", err);
    process.exit(1);
  });
}
