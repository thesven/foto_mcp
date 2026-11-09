#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FotoClient } from "./foto-client.js";
import { signInWithEmailAndPassword, clearCredentials, getAuthStatus } from "./api/auth.js";
import { searchTags, suggestTags, FOTO_ALLOWED_TAGS } from "./tags.js";
import { InstagramSyncTool } from "./sync/instagram.js";
import { FlickrSyncTool } from "./sync/flickr.js";
import { VaultExporter } from "./sync/vault.js";
import { WatchFolderService } from "./sync/watcher.js";

const client = new FotoClient();

const server = new McpServer({
  name: "foto_mcp",
  version: "2.0.0"
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
  "Inspect a local image file without uploading: extracts technical EXIF (camera, lens, ISO, shutter, aperture), dimensions, aspect ratio, color space, and checks for GPS presence. Includes base64 preview image thumbnail for visual multimodal inspection.",
  {
    filePath: z.string().describe("Absolute file path to the local image (JPEG, PNG, WebP, HEIC, TIFF)"),
    includePreview: z.boolean().optional().describe("Whether to include base64 visual thumbnail image content (default: true)")
  },
  async ({ filePath, includePreview = true }) => {
    try {
      const inspection = await client.inspectPhoto(filePath, { preview: includePreview });
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [
        {
          type: "text",
          text: JSON.stringify(inspection, null, 2)
        }
      ];

      if (includePreview && inspection.previewBase64) {
        content.push({
          type: "image",
          data: inspection.previewBase64,
          mimeType: "image/jpeg"
        });
      }

      return { content };
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

// Tool 14: foto_follow_user
server.tool(
  "foto_follow_user",
  "Follow one or more photographers on Foto by their user ID(s). Atomically updates following and followers lists.",
  {
    userId: z.string().optional().describe("A single photographer userId to follow"),
    userIds: z.array(z.string()).optional().describe("An array of photographer userIds to follow in batch")
  },
  async ({ userId, userIds }) => {
    try {
      if (userId) {
        const result = await client.followUser(userId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      if (userIds && userIds.length > 0) {
        const result = await client.followUsers(userIds);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: "Please provide either userId or userIds to follow." }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to follow user(s): ${err.message}` }]
      };
    }
  }
);

// Tool 15: foto_unfollow_user
server.tool(
  "foto_unfollow_user",
  "Unfollow one or more photographers on Foto by user ID(s).",
  {
    userId: z.string().optional().describe("A single photographer userId to unfollow"),
    userIds: z.array(z.string()).optional().describe("An array of photographer userIds to unfollow in batch")
  },
  async ({ userId, userIds }) => {
    try {
      if (userId) {
        const result = await client.unfollowUser(userId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      if (userIds && userIds.length > 0) {
        const result = await client.unfollowUsers(userIds);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: "Please provide either userId or userIds to unfollow." }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to unfollow user(s): ${err.message}` }]
      };
    }
  }
);

// Tool 16: foto_delete_post
server.tool(
  "foto_delete_post",
  "Delete a published post on Foto by post ID. Automatically removes the post document, scrubs private metadata, and updates your user profile.",
  {
    postId: z.string().describe("The post ID of the post to delete")
  },
  async ({ postId }) => {
    try {
      const result = await client.deletePost(postId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to delete post "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 17: foto_update_post
server.tool(
  "foto_update_post",
  "Update the caption or tags of an existing Foto post. Tags must be 1 to 3 items selected from the official 303 curated list.",
  {
    postId: z.string().describe("The post ID of the post to update"),
    caption: z.string().optional().describe("New caption or narrative text"),
    tags: z.array(z.string()).optional().describe("New tags list (1 to 3 curated tags)")
  },
  async ({ postId, caption, tags }) => {
    try {
      const result = await client.updatePost({ postId, caption, tags });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to update post "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 18: foto_get_post
server.tool(
  "foto_get_post",
  "Retrieve complete details for a single Foto post by post ID, including high-res image URL, technical camera EXIF, and engagement stats.",
  {
    postId: z.string().describe("The post ID to look up")
  },
  async ({ postId }) => {
    try {
      const result = await client.getPost(postId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to retrieve post "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 19: foto_get_photographer_profile
server.tool(
  "foto_get_photographer_profile",
  "Look up any photographer's public profile on Foto by user ID or username. Returns bio, follower counts, profile link, and sample works.",
  {
    userId: z.string().optional().describe("The photographer user ID"),
    username: z.string().optional().describe("The photographer username / handle (with or without @)")
  },
  async ({ userId, username }) => {
    try {
      const result = await client.getPhotographerProfile({ userId, username });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to retrieve photographer profile: ${err.message}` }]
      };
    }
  }
);

// Tool 20: foto_like_post
server.tool(
  "foto_like_post",
  "Like or bookmark a post on Foto by post ID.",
  {
    postId: z.string().describe("The post ID to like")
  },
  async ({ postId }) => {
    try {
      const result = await client.likePost(postId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to like post "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 21: foto_unlike_post
server.tool(
  "foto_unlike_post",
  "Remove your like from a Foto post by post ID.",
  {
    postId: z.string().describe("The post ID to unlike")
  },
  async ({ postId }) => {
    try {
      const result = await client.unlikePost(postId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to unlike post "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 22: foto_get_comments
server.tool(
  "foto_get_comments",
  "Retrieve comments and discussions on a Foto post by post ID.",
  {
    postId: z.string().describe("The post ID to get comments for"),
    limit: z.number().int().positive().max(50).optional().describe("Maximum comments to retrieve (default: 20)")
  },
  async ({ postId, limit }) => {
    try {
      const comments = await client.getComments(postId, limit);
      return {
        content: [{ type: "text", text: JSON.stringify({ postId, count: comments.length, comments }, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch comments for post "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 23: foto_post_comment
server.tool(
  "foto_post_comment",
  "Post a thoughtful comment or critique on a Foto post.",
  {
    postId: z.string().describe("The post ID to comment on"),
    text: z.string().min(1).describe("Comment text or photographic reflection")
  },
  async ({ postId, text }) => {
    try {
      const result = await client.postComment(postId, text);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to post comment on "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 24: foto_get_notifications
server.tool(
  "foto_get_notifications",
  "Retrieve recent notifications and community interactions on your Foto account (likes, comments, mentions, follows).",
  {
    limit: z.number().int().positive().max(50).optional().describe("Maximum notifications to retrieve (default: 20)")
  },
  async ({ limit }) => {
    try {
      const notifications = await client.getNotifications(limit);
      return {
        content: [{ type: "text", text: JSON.stringify({ count: notifications.length, notifications }, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch notifications: ${err.message}` }]
      };
    }
  }
);

// Tool 25: foto_get_home_feed
server.tool(
  "foto_get_home_feed",
  "Retrieve your chronological Foto home timeline of posts from creators you follow.",
  {
    limit: z.number().int().positive().max(50).optional().describe("Maximum feed posts to return (default: 20)")
  },
  async ({ limit }) => {
    try {
      const feed = await client.getHomeFeed(limit);
      return {
        content: [{ type: "text", text: JSON.stringify({ count: feed.length, posts: feed }, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch home feed: ${err.message}` }]
      };
    }
  }
);

// Tool 25: foto_create_portfolio
server.tool(
  "foto_create_portfolio",
  "Create and publish a multi-image curated portfolio showcase to Foto. Includes title, custom cover image selection, alignment, and 1-3 curated tags. Supports dryRun=true.",
  {
    title: z.string().describe("Title of the portfolio collection (e.g. 'Nordic Nocturnes', 'Tokyo Rain')"),
    images: z.array(
      z.object({
        filePath: z.string().describe("Absolute file path to local image"),
        caption: z.string().optional().describe("Optional caption for this specific photo in the portfolio"),
        tags: z.array(z.string()).optional().describe("Optional tags for this specific photo")
      })
    ).min(2).describe("Ordered array of at least 2 images for the portfolio"),
    tags: z.array(z.string()).min(1).max(3).describe("1 to 3 tags chosen from Foto's official curated whitelist"),
    description: z.string().optional().describe("Optional narrative artist statement or description of the collection"),
    coverIndex: z.number().int().min(0).optional().describe("0-based index of the image to use as the cover (default: 0)"),
    coverAlignmentX: z.number().min(0).max(1).optional().describe("Cover thumbnail horizontal alignment (0.0=left, 0.5=center, 1.0=right; default: 0.5)"),
    dryRun: z.boolean().optional().describe("If true, validates and prepares all images without uploading or mutating remote databases")
  },
  async ({ title, images, tags, description, coverIndex = 0, coverAlignmentX = 0.5, dryRun = false }) => {
    try {
      const result = await client.createPortfolio({
        title,
        images,
        tags,
        description,
        coverIndex,
        coverAlignmentX,
        dryRun
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to create portfolio: ${err.message}` }]
      };
    }
  }
);

// Tool 26: foto_list_portfolios
server.tool(
  "foto_list_portfolios",
  "List portfolio showcase collections for a specific user or the currently authenticated user.",
  {
    userId: z.string().optional().describe("Target user ID (defaults to authenticated user)"),
    username: z.string().optional().describe("Target photographer username (e.g. '@alex' or 'alex')"),
    limit: z.number().int().positive().optional().describe("Maximum number of portfolios to return (default: 20)")
  },
  async ({ userId, username, limit = 20 }) => {
    try {
      const portfolios = await client.listPortfolios({ userId, username, limit });
      return {
        content: [{ type: "text", text: JSON.stringify({ count: portfolios.length, portfolios }, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to list portfolios: ${err.message}` }]
      };
    }
  }
);

// Tool 27: foto_sync_flickr
server.tool(
  "foto_sync_flickr",
  "Migrate and sync photo archives from a Flickr export (JSON account export or photo JSON files) to Foto. Normalizes tags to 303 whitelist, strips GPS, prevents duplicate republishing, and prepares 1820px zero-crop uploads. Supports dryRun=true (default).",
  {
    exportPath: z.string().describe("Path to Flickr export directory or JSON file"),
    mediaDir: z.string().optional().describe("Directory containing extracted Flickr images (defaults to exportPath directory)"),
    maxPhotos: z.number().int().positive().optional().describe("Maximum photos to process in this run (default: 20)"),
    dryRun: z.boolean().optional().describe("If true (default), simulates migration without uploading or creating live posts"),
    defaultTags: z.array(z.string()).optional().describe("Optional default tags to apply if none are suggested")
  },
  async ({ exportPath, mediaDir, maxPhotos = 20, dryRun = true, defaultTags }) => {
    try {
      const syncTool = new FlickrSyncTool(client);
      const report = await syncTool.sync({
        exportPath,
        mediaDir,
        maxPhotos,
        dryRun,
        defaultTags
      });
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Flickr sync failed: ${err.message}` }]
      };
    }
  }
);

// Tool 28: foto_export_vault
server.tool(
  "foto_export_vault",
  "Export a complete offline backup archive of your Foto portfolio: downloads high-resolution 1820px photos, technical EXIF metadata JSON sidecars, and a master manifest.json index.",
  {
    targetDirectory: z.string().describe("Local destination directory path where vault archive will be saved"),
    limit: z.number().int().positive().optional().describe("Maximum number of posts to export (defaults to all)"),
    dryRun: z.boolean().optional().describe("If true, previews what will be backed up without downloading images")
  },
  async ({ targetDirectory, limit, dryRun = false }) => {
    try {
      const exporter = new VaultExporter(client);
      const result = await exporter.exportVault({ targetDirectory, limit, dryRun });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Vault export failed: ${err.message}` }]
      };
    }
  }
);

// Tool 29: foto_watch_directory
server.tool(
  "foto_watch_directory",
  "Scan a local studio watch directory (e.g. Lightroom or Capture One export folder), auto-inspect new photo exports, extract camera EXIF, suggest curated tags, generate color-corrected preview thumbnails, and format publication drafts.",
  {
    directoryPath: z.string().describe("Path to local directory to scan for photography exports"),
    includePreview: z.boolean().optional().describe("Whether to generate base64 multimodal preview thumbnails (default: true)"),
    maxPhotos: z.number().int().positive().optional().describe("Maximum number of photos to scan (default: 50)")
  },
  async ({ directoryPath, includePreview = true, maxPhotos = 50 }) => {
    try {
      const watcher = new WatchFolderService(client);
      const result = await watcher.scanWatchDirectory({ directoryPath, includePreview, maxPhotos });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Watch directory scan failed: ${err.message}` }]
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

// MCP Dynamic Resource: User Home Feed
server.registerResource(
  "foto-my-feed",
  "foto://my/feed",
  {
    title: "My Foto Home Feed",
    description: "Chronological stream of recent posts from followed creators on Foto",
    mimeType: "application/json"
  },
  async () => {
    const feed = await client.getHomeFeed(20);
    return {
      contents: [
        {
          uri: "foto://my/feed",
          mimeType: "application/json",
          text: JSON.stringify(feed, null, 2)
        }
      ]
    };
  }
);

// MCP Dynamic Resource: User Notifications
server.registerResource(
  "foto-my-notifications",
  "foto://my/notifications",
  {
    title: "My Foto Notifications",
    description: "Recent community interaction alerts on Foto",
    mimeType: "application/json"
  },
  async () => {
    const notifs = await client.getNotifications(20);
    return {
      contents: [
        {
          uri: "foto://my/notifications",
          mimeType: "application/json",
          text: JSON.stringify(notifs, null, 2)
        }
      ]
    };
  }
);

// MCP Dynamic Resource Template: Post Details
server.resource(
  "foto-post-detail",
  new ResourceTemplate("foto://posts/{postId}", { list: undefined }),
  {
    title: "Foto Post Detail",
    description: "Live post document and camera EXIF metadata on Foto",
    mimeType: "application/json"
  },
  async (uri, { postId }) => {
    const post = await client.getPost(String(postId));
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(post, null, 2)
        }
      ]
    };
  }
);

// MCP Dynamic Resource Template: Photographer Profile
server.resource(
  "foto-user-profile",
  new ResourceTemplate("foto://users/{userId}", { list: undefined }),
  {
    title: "Foto Photographer Profile",
    description: "Public creator profile, bio, and recent posts on Foto",
    mimeType: "application/json"
  },
  async (uri, { userId }) => {
    const profile = await client.getPhotographerProfile({ userId: String(userId) });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(profile, null, 2)
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

// MCP Prompt: Masterclass Photographic Critique
server.registerPrompt(
  "critique_photograph",
  {
    title: "Masterclass Photographic Critique",
    description: "Provide an insightful, constructive critique evaluating composition, lighting, exposure, and emotional storytelling."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please critique my photograph for presentation on Foto (https://fotoapp.co/).

Analyze the photo along these masterclass dimensions:
1. Composition & Framing: Rule of thirds, leading lines, framing, negative space, aspect ratio balance.
2. Light & Atmosphere: Direction of light, quality (hard vs soft), dynamic range, highlights/shadows.
3. Technical & Exposure: Depth of field, aperture choice, shutter speed motion control, ISO grain, sharpness.
4. Emotional & Narrative Resonance: Mood, storytelling, artistic intent, and connection to the subject.
5. Recommendation: Suggest 1 to 3 tags from Foto's 303 curated tags list and draft an evocative caption.`
          }
        }
      ]
    };
  }
);

// MCP Prompt: Multi-Image Series Curation
server.registerPrompt(
  "curate_photo_series",
  {
    title: "Curate Sequential Photo Series",
    description: "Sequence 2 to 5 images into an evocative, cohesive narrative story adhering to Foto platform guidelines."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please help me curate and publish a multi-image Series (2 to 5 photos) for Foto.

Guidelines:
1. Pacing & Flow: Order the frames to build visual rhythm (e.g. establishing wide frame -> medium interaction -> intimate detail -> closing tone).
2. Continuity: Ensure color grading, aspect ratio consistency, and thematic harmony across all frames.
3. Whitelist Tags: Select 1 to 3 curated tags matching the series genre and technique.
4. Preview & Validate: Verify all images with foto_publish_series (dryRun: true) before publishing.`
          }
        }
      ]
    };
  }
);

export { server, client };

async function main() {
  const args = process.argv.slice(2);
  const isSse = (args.includes("--transport") && args[args.indexOf("--transport") + 1] === "sse")
    || process.env.MCP_TRANSPORT === "sse";

  if (isSse) {
    const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
    const http = await import("node:http");
    const port = Number(process.env.PORT) || 3000;

    let sseTransport: any = null;

    const serverHttp = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname === "/sse") {
        sseTransport = new SSEServerTransport("/messages", res);
        await server.connect(sseTransport);
      } else if (url.pathname === "/messages" && req.method === "POST") {
        if (sseTransport) {
          await sseTransport.handlePostMessage(req, res);
        } else {
          res.writeHead(400).end("No active SSE transport connection");
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "foto_mcp", version: "2.0.0", status: "running" }));
      }
    });

    serverHttp.listen(port, () => {
      console.error(`Foto MCP Server running on SSE transport at http://localhost:${port}/sse`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Foto MCP Server running on stdio transport.");
  }
}

if (process.env.NODE_ENV !== "test" && !process.env.FOTO_MCP_TEST) {
  main().catch((err) => {
    console.error("Fatal error starting Foto MCP Server:", err);
    process.exit(1);
  });
}
