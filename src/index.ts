#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FotoClient } from "./foto-client.js";
import { signInWithEmailAndPassword, clearCredentials, getAuthStatus } from "./api/auth.js";
import { searchTags, suggestTags, FOTO_ALLOWED_TAGS } from "./tags.js";

const client = new FotoClient();

const server = new McpServer({
  name: "foto_mcp",
  version: "0.1.0"
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Foto MCP Server running on stdio transport.");
}

main().catch((err) => {
  console.error("Fatal error starting Foto MCP Server:", err);
  process.exit(1);
});
