#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FotoClient } from "./foto-client.js";
import {
  signInWithEmailAndPassword,
  clearCredentials,
  getAuthStatus,
  listProfiles,
  switchProfile
} from "./api/auth.js";
import { searchTags, suggestTags, FOTO_ALLOWED_TAGS } from "./tags.js";
import { InstagramSyncTool } from "./sync/instagram.js";
import { FlickrSyncTool } from "./sync/flickr.js";
import { VscoSyncTool } from "./sync/vsco.js";
import { VaultExporter } from "./sync/vault.js";
import { WatchFolderService } from "./sync/watcher.js";
import { OfflineDraftQueue } from "./sync/queue.js";

const client = new FotoClient();
const draftQueue = new OfflineDraftQueue(client);

const server = new McpServer({
  name: "foto_mcp",
  version: "3.0.0"
});

// Tool 1: foto_auth_status
server.tool(
  "foto_auth_status",
  "Check the current authentication status with Foto app (logged-in user, active profile, token validity).",
  {
    profileName: z.string().optional().describe("Optional profile name to inspect (defaults to active profile)")
  },
  async ({ profileName }) => {
    try {
      const status = await getAuthStatus(profileName);
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
  "Authenticate with Foto app using your account email and password. Securely stores encrypted credentials locally under the specified profile.",
  {
    email: z.string().email().describe("Your Foto account email address"),
    password: z.string().min(1).describe("Your Foto account password"),
    profileName: z.string().optional().describe("Optional profile alias (e.g. 'default', 'street', 'studio')")
  },
  async ({ email, password, profileName }) => {
    try {
      const creds = await signInWithEmailAndPassword(email, password, profileName);
      return {
        content: [
          {
            type: "text",
            text: `Successfully authenticated with Foto!\nProfile: ${creds.profileName || "default"}\nUser ID: ${creds.userId}\nEmail: ${creds.email}\nSession token encrypted and cached securely.`
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
  {
    profileName: z.string().optional().describe("Optional profile name to log out of (if omitted, clears all stored sessions)")
  },
  async ({ profileName }) => {
    try {
      await clearCredentials(profileName);
      return {
        content: [
          {
            type: "text",
            text: profileName
              ? `Successfully logged out of Foto profile "${profileName}".`
              : "Successfully logged out of Foto and cleared cached credentials."
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
  "Inspect a local image file without uploading: extracts technical EXIF (camera, lens, ISO, shutter, aperture), Lightroom/Capture One .xmp sidecar metadata, dimensions, aspect ratio, color space, and checks for GPS presence. Includes base64 preview image thumbnail for visual multimodal inspection.",
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
  "Preview and validate a post draft without publishing. Validates tag constraints (1-3 from whitelist), formats EXIF summary, checks image parameters, and returns a multimodal sRGB visual preview.",
  {
    filePath: z.string().describe("Absolute file path to local image"),
    caption: z.string().describe("The post caption or narrative description"),
    tags: z.array(z.string()).describe("1 to 3 tags chosen from Foto's curated list"),
    includePreview: z.boolean().optional().describe("Whether to include base64 visual thumbnail image content (default: true)")
  },
  async ({ filePath, caption, tags, includePreview = true }) => {
    try {
      const draft = await client.draftPost({ filePath, caption, tags, includePreview });
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [
        {
          type: "text",
          text: JSON.stringify(draft, null, 2)
        }
      ];

      if (includePreview && draft.previewBase64) {
        content.push({
          type: "image",
          data: draft.previewBase64,
          mimeType: "image/jpeg"
        });
      }

      return { content };
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
  "Publish a single photo post to Foto. Automatically normalizes resolution (max 1820px, JPEG 80%, embedded sRGB ICC), scrubs GPS for privacy, uploads to Storage, passes moderation, and creates the post. Use dryRun=true to test locally without publishing.",
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
  "Browse recent public posts on Foto under a curated tag (e.g. 'Wildlife', 'Street', 'Landscape', 'Portrait', 'Analog').",
  {
    tag: z.string().describe("Curated tag name from Foto's 303 allowed tags list (e.g. 'Wildlife', 'Street', 'Landscape')"),
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
  "Find photographers on Foto who publish under a specific curated tag (such as 'Wildlife', 'Landscape', 'Portrait', 'Street', 'Analog'). Resolves user profiles, bios, stats, and profile URLs.",
  {
    tag: z.string().describe("Curated tag name from Foto's 303 allowed tags list (e.g. 'Wildlife', 'Landscape', 'Portrait')"),
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
  "Delete a published post on Foto by post ID. Automatically removes the post document, scrubs all slide private metadata, updates your user profile, and prunes tag shards.",
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
  "Retrieve comments and nested threaded replies on a Foto post by post ID.",
  {
    postId: z.string().describe("The post ID to get comments for"),
    limit: z.number().int().positive().max(50).optional().describe("Maximum comments to retrieve (default: 20)"),
    includeReplies: z.boolean().optional().describe("Whether to resolve threaded replies from the replies collection (default: true)")
  },
  async ({ postId, limit, includeReplies = true }) => {
    try {
      const comments = await client.getComments(postId, limit, includeReplies);
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
  "Post a thoughtful comment or threaded reply on a Foto post.",
  {
    postId: z.string().describe("The post ID to comment on"),
    text: z.string().min(1).describe("Comment text or photographic reflection"),
    parentCommentId: z.string().optional().describe("Optional parent comment ID if posting a threaded reply")
  },
  async ({ postId, text, parentCommentId }) => {
    try {
      const result = await client.postComment(postId, text, parentCommentId);
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

// Tool 26: foto_create_portfolio
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

// Tool 27: foto_list_portfolios
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

// Tool 28: foto_sync_flickr
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

// Tool 29: foto_export_vault
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

// Tool 30: foto_watch_directory
server.tool(
  "foto_watch_directory",
  "Scan a local studio watch directory (e.g. Lightroom or Capture One export folder), auto-inspect new photo exports, merge .xmp sidecar ratings/color labels, extract camera EXIF, suggest curated tags, generate color-corrected preview thumbnails, and format publication drafts.",
  {
    directoryPath: z.string().describe("Path to local directory to scan for photography exports"),
    includePreview: z.boolean().optional().describe("Whether to generate base64 multimodal preview thumbnails (default: true)"),
    maxPhotos: z.number().int().positive().optional().describe("Maximum number of photos to scan (default: 50)"),
    minRating: z.number().int().min(1).max(5).optional().describe("Optional minimum XMP star rating filter (1 to 5)"),
    colorLabel: z.string().optional().describe("Optional XMP color label filter (e.g. 'Select', 'Red', 'Green')")
  },
  async ({ directoryPath, includePreview = true, maxPhotos = 50, minRating, colorLabel }) => {
    try {
      const watcher = new WatchFolderService(client);
      const result = await watcher.scanWatchDirectory({
        directoryPath,
        includePreview,
        maxPhotos,
        minRating,
        colorLabel
      });
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

// Tool 31: foto_update_portfolio
server.tool(
  "foto_update_portfolio",
  "Update an existing Foto portfolio showcase (title, description, curated tags, cover image ID, or cover horizontal alignment).",
  {
    postId: z.string().describe("The portfolio post ID to update"),
    title: z.string().optional().describe("New portfolio title"),
    description: z.string().optional().describe("New artist statement or description"),
    tags: z.array(z.string()).optional().describe("New list of 1 to 3 curated tags"),
    coverImageId: z.string().optional().describe("New cover image ID from the portfolio slides"),
    coverAlignmentX: z.number().min(0).max(1).optional().describe("New horizontal cover alignment (0.0=left, 0.5=center, 1.0=right)")
  },
  async ({ postId, title, description, tags, coverImageId, coverAlignmentX }) => {
    try {
      const result = await client.updatePortfolio({
        postId,
        title,
        description,
        tags,
        coverImageId,
        coverAlignmentX
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to update portfolio "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 32: foto_delete_portfolio
server.tool(
  "foto_delete_portfolio",
  "Delete a published portfolio showcase on Foto by post ID. Cascades cleanup across all slide private metadata, user profile postIds, and tag shards.",
  {
    postId: z.string().describe("The portfolio post ID to delete")
  },
  async ({ postId }) => {
    try {
      const result = await client.deletePortfolio(postId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to delete portfolio "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 33: foto_delete_comment
server.tool(
  "foto_delete_comment",
  "Delete one of your comments or threaded replies on a Foto post and decrement the post comment counter.",
  {
    commentId: z.string().describe("The comment or reply ID to delete"),
    postId: z.string().describe("The post ID the comment belongs to"),
    isReply: z.boolean().optional().describe("Set to true if deleting a threaded reply from the replies collection")
  },
  async ({ commentId, postId, isReply = false }) => {
    try {
      const result = await client.deleteComment({ commentId, postId, isReply });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to delete comment "${commentId}": ${err.message}` }]
      };
    }
  }
);

// Tool 34: foto_get_post_likes
server.tool(
  "foto_get_post_likes",
  "View the photographers who liked a specific Foto post (/app/liked-by/:postId). Resolves user IDs, usernames, display names, and profile links.",
  {
    postId: z.string().describe("The post ID to inspect likes for"),
    limit: z.number().int().positive().max(50).optional().describe("Maximum user profiles to resolve (default: 25)")
  },
  async ({ postId, limit }) => {
    try {
      const result = await client.getPostLikes(postId, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch post likes for "${postId}": ${err.message}` }]
      };
    }
  }
);

// Tool 35: foto_update_user_profile
server.tool(
  "foto_update_user_profile",
  "Update your authenticated Foto photographer profile (displayName, bio, website, or profilePhotoUrl).",
  {
    displayName: z.string().optional().describe("New display name"),
    bio: z.string().optional().describe("New biography or artist statement"),
    website: z.string().optional().describe("Personal portfolio website URL"),
    profilePhotoUrl: z.string().optional().describe("Profile avatar image URL")
  },
  async ({ displayName, bio, website, profilePhotoUrl }) => {
    try {
      const result = await client.updateUserProfile({
        displayName,
        bio,
        website,
        profilePhotoUrl
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to update user profile: ${err.message}` }]
      };
    }
  }
);

// Tool 36: foto_report_content
server.tool(
  "foto_report_content",
  "Submit a community safety moderation report for a post or user on Foto.",
  {
    targetType: z.enum(["post", "user"]).describe("Whether reporting a 'post' or a 'user'"),
    targetId: z.string().describe("The postId or userId being reported"),
    reason: z.string().describe("Primary reason for the report (e.g. 'spam', 'ai_generated_undisclosed', 'harassment', 'copyright')"),
    details: z.string().optional().describe("Optional additional context")
  },
  async ({ targetType, targetId, reason, details }) => {
    try {
      const result = await client.reportContent({ targetType, targetId, reason, details });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to submit content report: ${err.message}` }]
      };
    }
  }
);

// Tool 37: foto_parse_xmp
server.tool(
  "foto_parse_xmp",
  "Parse an Adobe Lightroom, Capture One, or Darktable .xmp sidecar file (or find the sidecar for an image file). Extracts star ratings (xmp:Rating), color labels (xmp:Label), title, description, hierarchical keywords, copyright, lens, and Fuji film simulation recipes.",
  {
    filePath: z.string().describe("Absolute path to the .xmp sidecar file or its parent image file")
  },
  async ({ filePath }) => {
    try {
      const xmp = await client.parseXmp(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(xmp, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to parse XMP sidecar: ${err.message}` }]
      };
    }
  }
);

// Tool 38: foto_sync_vsco
server.tool(
  "foto_sync_vsco",
  "Migrate and sync photo archives from a VSCO export (JSON grid/journal export) to Foto. Maps VSCO film emulation presets (e.g. A6, M5, B1, C1, HB2, KP1) to Foto's 303 curated tags, cleans descriptions, scrubs GPS, and deduplicates. Supports dryRun=true (default).",
  {
    exportPath: z.string().describe("Path to VSCO export directory or JSON file"),
    mediaDir: z.string().optional().describe("Directory containing extracted VSCO images (defaults to exportPath directory)"),
    maxPhotos: z.number().int().positive().optional().describe("Maximum photos to process in this run (default: 20)"),
    dryRun: z.boolean().optional().describe("If true (default), simulates migration without uploading or creating live posts"),
    defaultTags: z.array(z.string()).optional().describe("Optional default tags to apply")
  },
  async ({ exportPath, mediaDir, maxPhotos = 20, dryRun = true, defaultTags }) => {
    try {
      const vscoTool = new VscoSyncTool(client);
      const report = await vscoTool.sync({
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
        content: [{ type: "text", text: `VSCO sync failed: ${err.message}` }]
      };
    }
  }
);

// Tool 39: foto_list_profiles
server.tool(
  "foto_list_profiles",
  "List all saved Foto account profiles (e.g. 'default', 'street', 'studio') and show which account is currently active.",
  {},
  async () => {
    try {
      const result = await listProfiles();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to list profiles: ${err.message}` }]
      };
    }
  }
);

// Tool 40: foto_switch_profile
server.tool(
  "foto_switch_profile",
  "Switch the active Foto account profile on the fly (e.g. between personal, street photography, and commercial studio accounts).",
  {
    profileName: z.string().min(1).describe("The name of the saved profile to activate")
  },
  async ({ profileName }) => {
    try {
      const result = await switchProfile(profileName);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to switch profile: ${err.message}` }]
      };
    }
  }
);

// Tool 41: foto_queue_draft
server.tool(
  "foto_queue_draft",
  "Stage a validated single photo post or multi-image series into the persistent local offline draft queue for later batch publishing.",
  {
    filePath: z.string().optional().describe("Single photo file path (for a single post)"),
    filePaths: z.array(z.string()).optional().describe("2 to 5 photo file paths (for a multi-image series)"),
    caption: z.string().describe("Intended post caption"),
    tags: z.array(z.string()).min(1).max(3).describe("1 to 3 curated tags from Foto's 303 whitelist"),
    profileName: z.string().optional().describe("Optional account profile name to associate with this draft")
  },
  async ({ filePath, filePaths, caption, tags, profileName }) => {
    try {
      const item = await draftQueue.enqueueDraft({
        filePath,
        filePaths,
        caption,
        tags,
        profileName
      });
      return {
        content: [{ type: "text", text: JSON.stringify(item, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to queue offline draft: ${err.message}` }]
      };
    }
  }
);

// Tool 42: foto_manage_draft_queue
server.tool(
  "foto_manage_draft_queue",
  "List, remove, or batch-publish drafts stored in the persistent local offline draft queue.",
  {
    action: z.enum(["list", "publish", "remove"]).describe("Queue operation: 'list' queued drafts, 'publish' pending drafts, or 'remove' drafts"),
    draftId: z.string().optional().describe("Optional specific draftId to publish or remove"),
    status: z.enum(["PENDING", "PUBLISHED", "FAILED"]).optional().describe("Optional status filter when listing drafts"),
    clearPublished: z.boolean().optional().describe("When action='remove', set true to clear all already-published drafts"),
    clearAll: z.boolean().optional().describe("When action='remove', set true to clear the entire draft queue"),
    maxDrafts: z.number().int().positive().optional().describe("Maximum drafts to publish in a batch (default: 20)"),
    dryRun: z.boolean().optional().describe("When action='publish', set true to validate queued drafts without uploading")
  },
  async ({ action, draftId, status, clearPublished, clearAll, maxDrafts, dryRun }) => {
    try {
      if (action === "list") {
        const res = await draftQueue.listDrafts({ status });
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
        };
      }
      if (action === "remove") {
        const res = await draftQueue.removeDraft({ draftId, clearPublished, clearAll });
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
        };
      }
      const res = await draftQueue.publishQueuedDrafts({ draftId, maxDrafts, dryRun });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Draft queue operation "${action}" failed: ${err.message}` }]
      };
    }
  }
);

// Tool 43: foto_check_username
server.tool(
  "foto_check_username",
  "Check whether an @username handle is available on Foto (verifying length, alphanumeric characters, and querying the usernames registry).",
  {
    username: z.string().describe("The username handle to check (with or without leading '@')")
  },
  async ({ username }) => {
    try {
      const result = await client.checkUsername(username);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to check username "${username}": ${err.message}` }]
      };
    }
  }
);

// Tool 44: foto_get_user_followers
server.tool(
  "foto_get_user_followers",
  "Retrieve and resolve the list of photographers who follow a specific user or yourself on Foto.",
  {
    userId: z.string().optional().describe("User ID whose followers to inspect (defaults to authenticated user)"),
    username: z.string().optional().describe("Username handle whose followers to inspect"),
    limit: z.number().int().positive().max(50).optional().describe("Maximum follower profiles to return (default: 20)")
  },
  async ({ userId, username, limit }) => {
    try {
      const result = await client.getUserFollowers({ userId, username, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch followers: ${err.message}` }]
      };
    }
  }
);

// Tool 45: foto_get_user_following
server.tool(
  "foto_get_user_following",
  "Retrieve and resolve the list of photographers that a specific user or yourself is following on Foto.",
  {
    userId: z.string().optional().describe("User ID whose following list to inspect (defaults to authenticated user)"),
    username: z.string().optional().describe("Username handle whose following list to inspect"),
    limit: z.number().int().positive().max(50).optional().describe("Maximum following profiles to return (default: 20)")
  },
  async ({ userId, username, limit }) => {
    try {
      const result = await client.getUserFollowing({ userId, username, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch following: ${err.message}` }]
      };
    }
  }
);

// Tool 46: foto_get_featured_photographers
server.tool(
  "foto_get_featured_photographers",
  "Discover community ambassador and featured creators on Foto with bio summaries, follower stats, and showcase links.",
  {
    limit: z.number().int().positive().max(25).optional().describe("Maximum featured photographers to return (default: 10)")
  },
  async ({ limit }) => {
    try {
      const result = await client.getFeaturedPhotographers(limit);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch featured photographers: ${err.message}` }]
      };
    }
  }
);

// Tool 47: foto_upload_profile_photo
server.tool(
  "foto_upload_profile_photo",
  "Upload and set your photographer profile avatar photo from a local image file. Resizes to 400x400 square, normalizes sRGB color, strips GPS, uploads to Storage, and updates user-profiles.",
  {
    filePath: z.string().describe("Absolute local path to the image file to use as avatar")
  },
  async ({ filePath }) => {
    try {
      const result = await client.uploadProfilePhoto(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to upload profile photo: ${err.message}` }]
      };
    }
  }
);

// Tool 48: foto_dismiss_notification
server.tool(
  "foto_dismiss_notification",
  "Dismiss or delete an alert from your notifications collection on Foto.",
  {
    notificationId: z.string().describe("The notification ID to dismiss")
  },
  async ({ notificationId }) => {
    try {
      const result = await client.dismissNotification(notificationId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to dismiss notification "${notificationId}": ${err.message}` }]
      };
    }
  }
);

// Tool 49: foto_get_explore_feed
server.tool(
  "foto_get_explore_feed",
  "Retrieve a rich curated explore feed of recent public works across major photographic genres (Street, Landscape, Portrait, Analog, Fine Art, Architecture).",
  {
    limit: z.number().int().positive().max(50).optional().describe("Maximum explore posts to return (default: 20)"),
    tags: z.array(z.string()).optional().describe("Optional subset of curated tags to explore")
  },
  async ({ limit, tags }) => {
    try {
      const result = await client.getExploreFeed({ limit, tags });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch explore feed: ${err.message}` }]
      };
    }
  }
);

// MCP Resource 1: Official 303 Curated Allowed Tags Whitelist
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

// MCP Resource 2: Authenticated User Profile
server.registerResource(
  "foto-my-profile",
  "foto://my/profile",
  {
    title: "My Foto Photographer Profile",
    description: "Active user's profile, bio, social counts, and published post IDs on Foto",
    mimeType: "application/json"
  },
  async () => {
    const profile = await client.getUserProfile();
    return {
      contents: [
        {
          uri: "foto://my/profile",
          mimeType: "application/json",
          text: JSON.stringify(profile, null, 2)
        }
      ]
    };
  }
);

// MCP Resource 3: User Home Feed
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

// MCP Resource 4: User Notifications
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

// MCP Resource 5: My Followers
server.registerResource(
  "foto-my-followers",
  "foto://my/followers",
  {
    title: "My Foto Followers",
    description: "List of photographers who follow the active authenticated account on Foto",
    mimeType: "application/json"
  },
  async () => {
    const followers = await client.getUserFollowers();
    return {
      contents: [
        {
          uri: "foto://my/followers",
          mimeType: "application/json",
          text: JSON.stringify(followers, null, 2)
        }
      ]
    };
  }
);

// MCP Resource 6: My Following
server.registerResource(
  "foto-my-following",
  "foto://my/following",
  {
    title: "My Foto Following",
    description: "List of photographers the active authenticated account follows on Foto",
    mimeType: "application/json"
  },
  async () => {
    const following = await client.getUserFollowing();
    return {
      contents: [
        {
          uri: "foto://my/following",
          mimeType: "application/json",
          text: JSON.stringify(following, null, 2)
        }
      ]
    };
  }
);

// MCP Resource 7: Featured & Ambassador Photographers
server.registerResource(
  "foto-explore-featured",
  "foto://explore/featured",
  {
    title: "Foto Featured & Ambassador Photographers",
    description: "Community ambassador creators and featured photographers on Foto",
    mimeType: "application/json"
  },
  async () => {
    const ambassadors = await client.getFeaturedPhotographers(15);
    return {
      contents: [
        {
          uri: "foto://explore/featured",
          mimeType: "application/json",
          text: JSON.stringify(ambassadors, null, 2)
        }
      ]
    };
  }
);

// MCP Dynamic Resource Template 8: Post Details
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

// MCP Dynamic Resource Template 9: Photographer Profile
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

// MCP Dynamic Resource Template 10: Recent Posts by Curated Tag
server.resource(
  "foto-tag-recent",
  new ResourceTemplate("foto://tags/{tag}/recent", { list: undefined }),
  {
    title: "Foto Recent Posts by Tag",
    description: "Live stream of recent public posts under any of Foto's 303 curated tags",
    mimeType: "application/json"
  },
  async (uri, { tag }) => {
    const decodedTag = decodeURIComponent(String(tag));
    const result = await client.browseTag({ tag: decodedTag, limit: 20 });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

// MCP Prompt 1: Formulate & Curate a Foto Post
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

// MCP Prompt 2: Masterclass Photographic Critique
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

// MCP Prompt 3: Multi-Image Series Curation
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

// MCP Prompt 4: Photo Walk Curator
server.registerPrompt(
  "photo_walk_curator",
  {
    title: "Photo Walk & Shoot Planner",
    description: "Pre-shoot planning assistant matching camera gear, focal lengths, film stocks, and Foto curated tags to locations and lighting conditions."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please help me plan an upcoming photo walk and shoot for Foto (https://fotoapp.co/).

Include the following in our plan:
1. Gear & Focal Length Pairing: Recommend prime or zoom focal lengths suited for the environment and subject matter.
2. Film Stock / Simulation Recipe: Suggest matching analog film stocks (e.g. Portra 400, Tri-X, HP5, CineStill 800T) or Fujifilm film simulations.
3. Light & Timing Strategy: Identify optimal shooting windows (Golden Hour, Blue Hour, harsh midday shadows, or overcast mist).
4. Target Foto Curated Tags: Map the planned shoot themes to 3 canonical tags from Foto's 303 allowed tags (use foto_search_tags).
5. Post-Shoot Ingest Workflow: Outline how we will scan exports with foto_watch_directory (filtering by XMP star ratings) and queue selects with foto_queue_draft.`
          }
        }
      ]
    };
  }
);

// MCP Prompt 5: Daily Foto Briefing
server.registerPrompt(
  "daily_foto_briefing",
  {
    title: "Daily Foto Community Briefing",
    description: "Generate a morning digest of new posts from followed photographers, recent notifications, and community highlights."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please prepare my Daily Foto Community Briefing:

1. Check Session & Profile: Run foto_auth_status and foto_get_user_profile.
2. Home Timeline Highlights: Run foto_get_home_feed to summarize the latest works published by photographers I follow, noting standout compositions, subjects, and tags.
3. Community Interactions: Run foto_get_notifications to summarize recent likes, comments, replies, and new followers.
4. Thoughtful Engagement: Recommend 1 or 2 posts from my feed where I can leave a meaningful, craft-focused comment using foto_post_comment.`
          }
        }
      ]
    };
  }
);

// MCP Prompt 6: Portfolio Showcase Curator
server.registerPrompt(
  "portfolio_curator",
  {
    title: "Portfolio Showcase Curator",
    description: "Selects, sequences, and formulates a cohesive Portfolio collection from a photographer's candidate body of work with artist statement and cover alignment."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please help me curate a high-impact Portfolio showcase for Foto (https://fotoapp.co/).

Guidelines:
1. Editorial Selection: Select the strongest cohesive images (between 2 and 20 slides) from my body of work.
2. Narrative Arc & Sequence: Arrange the images with dynamic rhythm (establishing hook, tonal variety, thematic climax, and resolute conclusion).
3. Cover Image & Alignment: Designate which slide acts as the cover and recommend horizontal alignment (coverAlignmentX: 0.0=left, 0.5=center, 1.0=right).
4. Artist Statement: Formulate an insightful title and descriptive artist statement explaining the inspiration and creative context.
5. Curated Tags: Select 1 to 3 official Foto tags (e.g. Fine Art, Landscape, Architecture) that capture the essence of the work.
6. Publish: Test with foto_create_portfolio (dryRun: true) and execute live.`
          }
        }
      ]
    };
  }
);

// MCP Prompt 7: Analog Lab Assistant
server.registerPrompt(
  "analog_lab_assistant",
  {
    title: "Analog Lab & Film Recipe Assistant",
    description: "Formulates film recipes, push/pull exposure compensations, development chemistry notes, and matching Foto analog curated tags."
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please assist me in cataloging and publishing my analog film photography to Foto (https://fotoapp.co/).

Steps:
1. Film Stock & Processing: Document the emulsion (e.g. Kodak Portra 400, Tri-X 400, Ilford HP5 Plus, CineStill 800T, Fuji Pro 400H), exposure rating (box speed or pushed/pulled stops), and lab development chemistry (C-41, D-76, Rodinal, HC-110, ECN-2).
2. Camera & Glass: Record the camera body format (35mm, 6x4.5, 6x6, 6x7, 6x9, 4x5 large format) and lens aperture.
3. Curated Tags: Map the capture to Foto's official analog tags (e.g. Analog, 35mm, Medium Format, Large Format, Black and White, Film).
4. Caption: Formulate a technical and artistic caption detailing the analog process without any hashtags.
5. Ingest: Parse Lightroom/Capture One scan sidecars with foto_parse_xmp or stage via foto_publish_post.`
          }
        }
      ]
    };
  }
);

export { server, client, draftQueue };

async function main() {
  const args = process.argv.slice(2);
  const isSse = (args.includes("--transport") && args[args.indexOf("--transport") + 1] === "sse")
    || process.env.MCP_TRANSPORT === "sse";

  if (isSse) {
    const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
    const http = await import("node:http");
    const portArgIdx = args.indexOf("--port");
    const port = (portArgIdx !== -1 && args[portArgIdx + 1])
      ? Number(args[portArgIdx + 1])
      : Number(process.env.MCP_PORT || process.env.PORT) || 3000;

    const activeTransports = new Map<string, any>();

    const serverHttp = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname === "/sse") {
        const sseTransport = new SSEServerTransport("/messages", res);
        const sessionId = (sseTransport as any).sessionId || "default";
        activeTransports.set(sessionId, sseTransport);
        res.on("close", () => {
          activeTransports.delete(sessionId);
        });
        await server.connect(sseTransport);
      } else if (url.pathname === "/messages" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = (sessionId && activeTransports.get(sessionId))
          || Array.from(activeTransports.values())[0];
        if (transport) {
          await transport.handlePostMessage(req, res);
        } else {
          res.writeHead(400).end("No active SSE transport connection");
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "foto_mcp",
            version: "3.0.0",
            status: "running",
            toolsCount: 49,
            resourcesCount: 10,
            promptsCount: 7,
            activeSseSessions: activeTransports.size
          })
        );
      }
    });

    serverHttp.listen(port, () => {
      console.error(`Foto MCP Server v3.0.0 running on SSE transport at http://localhost:${port}/sse`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Foto MCP Server v3.0.0 running on stdio transport.");
  }
}

if (process.env.NODE_ENV !== "test" && !process.env.FOTO_MCP_TEST) {
  main().catch((err) => {
    console.error("Fatal error starting Foto MCP Server:", err);
    process.exit(1);
  });
}

