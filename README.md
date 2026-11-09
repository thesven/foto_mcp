# Foto MCP Server (`foto_mcp`)

A Model Context Protocol (MCP) server for [Foto](https://fotoapp.co/) (`fotoapp.co` / `the.fotoapp.co`), the photography-first social platform.

This MCP server enables AI assistants (Claude Desktop, Cursor, local agent runtimes) to seamlessly author, inspect, tag, and publish photos and series directly to your Foto account from your desktop editing environment.

---

## Features

* **Zero-Crop & Resolution Optimization:** Automatically normalizes high-res camera exports to Foto's 1820px standard (quality 80 JPEG) while preserving the exact original composition and aspect ratio.
* **Privacy by Design (GPS Scrubbing):** Automatically strips embedded GPS coordinates and thumbnail IFDs before upload, matching Foto's privacy ethos.
* **Technical EXIF Preservation:** Automatically parses camera body, lens model, ISO, aperture ($f$-number), shutter speed, and focal length into Foto's `image-private-metadata` system.
* **Curated Tag Enforcement:** Enforces Foto's strict rule of **1 to 3 tags** and matches against the platform's official **303 curated tags list** (no hashtag spam).
* **AI Tag Suggester:** Analyzes photo context, gear notes, or film stocks (e.g. `Hasselblad 500C/M`, `Portra 400`, `Street`) and recommends the best matching tags.
* **Multi-Image Series:** Supports authoring and publishing sequential photo stories (2 to 5 images per post).
* **Content Safety Compliance:** Validates uploads against platform standards and Sightengine moderation.
* **Dry-Run Validation:** Test the entire preparation, EXIF extraction, and formatting pipeline locally without modifying your account or making network requests.

---

## Installation & Setup

### Prerequisites
* Node.js v18 or later
* npm or pnpm

### Build from Source
```bash
git clone https://github.com/thesven/foto_mcp.git
cd foto_mcp
npm install
npm run build
```

---

## Authentication

You can authenticate in two ways:

### Option 1: In-Chat via `foto_login` Tool (Recommended)
Once the MCP server is configured in your client, simply prompt your AI assistant:
> *"Log in to my Foto account with email `you@example.com` and password `your_password`."*

The `foto_login` tool connects securely to Firebase Auth, caches your session token in `~/.config/foto-mcp/credentials.json` (chmod `0600`), and automatically refreshes tokens in the background.

### Option 2: Environment Variables
Alternatively, you can provide your credentials via environment variables:
```bash
export FOTO_EMAIL="you@example.com"
export FOTO_PASSWORD="your_password"
```

---

## Configuration

### Quick Start via `npx` (No local build required)
You can run `foto-mcp` directly without cloning or building locally:

```json
{
  "mcpServers": {
    "foto": {
      "command": "npx",
      "args": ["-y", "foto_mcp"]
    }
  }
}
```

### Claude Desktop
Add this to your Claude Desktop configuration file:
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "foto": {
      "command": "npx",
      "args": ["-y", "foto_mcp"],
      "env": {
        "FOTO_EMAIL": "your_email@example.com",
        "FOTO_PASSWORD": "your_password"
      }
    }
  }
}
```

### Cursor
Add to `.cursor/mcp.json` or your Global Cursor MCP settings:
```json
{
  "mcpServers": {
    "foto": {
      "command": "npx",
      "args": ["-y", "foto_mcp"]
    }
  }
}
```

### Zed Editor
Add to `~/.config/zed/settings.json`:
```json
{
  "experimental.model_context_protocol": {
    "servers": {
      "foto": {
        "command": "npx",
        "args": ["-y", "foto_mcp"]
      }
    }
  }
}
```

### Windsurf
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "foto": {
      "command": "npx",
      "args": ["-y", "foto_mcp"]
    }
  }
}
```

---

## Available MCP Tools

| Tool | Description | Key Arguments |
| :--- | :--- | :--- |
| `foto_auth_status` | Checks current login status and token validity. | None |
| `foto_login` | Authenticate with Foto email and password. | `email`, `password` |
| `foto_logout` | Log out and delete cached credentials from disk. | None |
| `foto_inspect_image` | Inspects local photo: parses camera, lens, ISO, shutter, aperture, aspect ratio, and checks for GPS. | `filePath` |
| `foto_suggest_tags` | Suggests 1 to 3 valid tags from the 303 allowed curated tags. | `caption`, `cameraInfo`, `keywords` |
| `foto_search_tags` | Searches the 303 curated tags by keyword or prefix. | `query`, `limit` |
| `foto_draft_post` | Validates and previews a post draft before publishing. | `filePath`, `caption`, `tags` |
| `foto_publish_post` | Normalizes, scrubs GPS, uploads, and publishes a single photo. Supports `dryRun: true`. | `filePath`, `caption`, `tags`, `dryRun` |
| `foto_publish_series` | Publishes a multi-image Series (2 to 5 photos) under one post. Supports `dryRun: true`. | `filePaths`, `caption`, `tags`, `dryRun` |
| `foto_get_user_profile` | Retrieves current user's profile info and stats. | None |
| `foto_sync_instagram` | Migrates posts from an Instagram HTML export: cleans hashtags, suggests curated tags, strips GPS, deduplicates against published posts. | `htmlFilePath`, `mediaDir`, `maxPosts`, `dryRun` |

---

## MCP Resources & Prompts

### Resources
* **`foto://curated-tags`**: Exposes the complete JSON array of all 303 official curated tags permitted on Foto for client-side caching and autocomplete.

### Prompts
* **`curate_foto_post`**: A structured prompt guiding the AI assistant to inspect image EXIF, suggest canonical tags, craft a thoughtful caption, and preview drafts according to Foto community guidelines.

---

## Example Usage with an AI Agent

### 1. Inspecting a Photo
> *"Can you inspect the photo at `~/Photos/Redwoods.jpg` and tell me about its technical settings?"*

Claude uses `foto_inspect_image`:
```json
{
  "originalWidth": 4000,
  "originalHeight": 2667,
  "aspectRatioFormatted": "3:2 (Landscape)",
  "hasGps": true,
  "exif": {
    "Make": "Hasselblad",
    "Model": "500 C/M",
    "LensModel": "Zeiss Planar 80mm f/2.8",
    "ISO": 400,
    "FNumber": 4,
    "ExposureTime": "1/125s",
    "FocalLength": 80
  }
}
```

### 2. Auto-Suggesting Foto Tags
> *"What Foto tags would fit this redwood shot?"*

Claude uses `foto_suggest_tags`:
```json
{
  "suggestedTags": ["Medium Format", "Analog", "Forest"],
  "explanation": "Detected Medium Format context; Detected analog film gear; Detected forest environment"
}
```

### 3. Publishing with Dry Run Test
> *"Let's test publishing it with a dry run first."*

Claude runs `foto_publish_post` with `dryRun: true`:
```json
{
  "success": true,
  "dryRun": true,
  "postId": "20261109161630-SIMULATED_USER-abc12345",
  "dimensions": { "width": 1820, "height": 1213, "aspectRatio": 1.5 },
  "hasStrippedGps": true,
  "tags": ["Medium Format", "Analog", "Forest"],
  "message": "[DRY RUN] Post successfully validated! Image prepared to 1820x1213px. GPS scrubbed: true. 0 API calls made."
}
```

### 4. Publishing Live to Foto
> *"Looks great! Go ahead and publish it live."*

Claude runs `foto_publish_post` without `dryRun`, and your photo is live on your chronological Foto feed.

### 5. Synchronizing from Instagram Data Export
> *"Can you analyze my Instagram export at `/path/to/posts_1.html` and preview what can be migrated to Foto?"*

Claude runs `foto_sync_instagram`:
```json
{
  "dryRun": true,
  "totalParsed": 12,
  "readyToPublish": 10,
  "alreadyPublishedCount": 2,
  "candidates": [
    {
      "post": { "title": "Red Fox in Snow", "hashtags": ["fox", "wildlife", "winter"] },
      "suggestedTags": ["Wildlife", "Animals", "Winter"],
      "gpsScrubbed": true,
      "status": "READY"
    }
  ]
}
```

---

## Environment Variables

| Variable | Description | Required? |
| :--- | :--- | :--- |
| `FOTO_EMAIL` | Account email for Foto. If set, enables headless login without manual in-chat auth. | Optional |
| `FOTO_PASSWORD` | Account password for Foto. | Optional |

> **Note:** Credentials can also be authenticated on-the-fly via the `foto_login` MCP tool. Session tokens are securely cached locally at `~/.config/foto-mcp/credentials.json` with strict user-only read/write permissions (`0600`).

---

## Testing & Quality Assurance

Run the automated test suite and type check:
```bash
npm test
npm run typecheck
```
The test suite validates:
* Exact 303 tag whitelist integrity & case-insensitive canonical normalization.
* Tag quantity limits (rejects 0 tags or >3 tags).
* Tag semantic suggestion matching.
* Deterministic Foto post ID generation pattern (`yyyyMMddHHmmss-<userId>-<8alnum>`).
* Image geometry, aspect-ratio formatting, and sharp 1820px downsampling.
* Dry-run single post and multi-image series authoring.
* Unauthenticated session handling.
* Draft post preview and validation.
* Multi-image series boundaries (enforces 2 to 5 images).
* Instagram export HTML parsing, newline decoding, and GPS stripping.

---

## Troubleshooting

### Token Expired or Authentication Error
* Run `foto_auth_status` to inspect current credentials.
* If your token expired or password changed, call `foto_login` with your credentials or update `FOTO_EMAIL` and `FOTO_PASSWORD` in your environment.
* To reset all local credentials, call `foto_logout` or delete `~/.config/foto-mcp/credentials.json`.

### Image Rejected by Moderation
* Foto automatically checks images using Sightengine (`nudity-2.1`). If an image exceeds platform thresholds (sexual activity > 0.7 or sexual display > 0.9), it will be rejected to protect your account standing.

### Format Not Supported
* Foto strictly supports still photography (JPEG, PNG, WebP, TIFF, HEIC). Animated GIFs and video are not permitted.

---

## License

[MIT License](LICENSE)
