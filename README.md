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

### Claude Desktop
Add this to your Claude Desktop configuration file:
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "foto": {
      "command": "node",
      "args": ["/path/to/foto_mcp/dist/index.js"],
      "env": {
        "FOTO_EMAIL": "your_email@example.com",
        "FOTO_PASSWORD": "your_password"
      }
    }
  }
}
```

### Cursor
Add to your project's `.cursor/mcp.json` or Global Cursor settings:
```json
{
  "mcpServers": {
    "foto": {
      "command": "node",
      "args": ["/path/to/foto_mcp/dist/index.js"]
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

---

## Testing & Quality Assurance

Run the built-in test suite:
```bash
npm test
```
The test suite validates:
* Exact 303 tag whitelist integrity & case-insensitive canonical normalization.
* Tag quantity limits (rejects 0 tags or >3 tags).
* Tag semantic suggestion matching.
* Deterministic Foto post ID generation pattern (`yyyyMMddHHmmss-<userId>-<8alnum>`).
* Image geometry, aspect-ratio formatting, and sharp 1820px downsampling.
* Dry-run single post and multi-image series authoring.
* Unauthenticated session handling.

---

## License

[MIT License](LICENSE)
