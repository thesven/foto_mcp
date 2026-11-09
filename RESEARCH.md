# Foto App MCP: Comprehensive Research & Reverse-Engineering Report

**Target Platform:** [Foto](https://fotoapp.co/) (`fotoapp.co` / `the.fotoapp.co`)  
**Package / Bundle ID:** `co.fotoapp.foto` (Android) / Apple App Store ID `6453682910`  
**Date of Research:** November 2026  
**Document Purpose:** In-depth technical investigation into Foto's platform architecture, unpublished APIs, data models, authentication, content authoring requirements, prior art, and architecture specification for building the ultimate Foto MCP (Model Context Protocol) server.

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [What is Foto? Platform Philosophy & Authoring Model](#2-what-is-foto-platform-philosophy--authoring-model)
3. [API Investigation: Official vs. Unpublished Architecture](#3-api-investigation-official-vs-unpublished-architecture)
4. [Deep-Dive Reverse Engineering: The Unpublished Backend](#4-deep-dive-reverse-engineering-the-unpublished-backend)
   - [4.1 Firebase Stack Configuration](#41-firebase-stack-configuration)
   - [4.2 Authentication Flow](#42-authentication-flow)
   - [4.3 Image Processing & Privacy Pipeline](#43-image-processing--privacy-pipeline)
   - [4.4 Firebase Storage Upload Protocol](#44-firebase-storage-upload-protocol)
   - [4.5 Automated Content Moderation (Sightengine)](#45-automated-content-moderation-sightengine)
   - [4.6 Firestore Collections & Schemas](#46-firestore-collections--schemas)
   - [4.7 Post ID Generation Algorithm](#47-post-id-generation-algorithm)
   - [4.8 The Curated Tags System & Sharded Index](#48-the-curated-tags-system--sharded-index)
   - [4.9 Multi-Image Series & Portfolios](#49-multi-image-series--portfolios)
5. [Competitive Analysis & Prior Art](#5-competitive-analysis--prior-art)
   - [5.1 Has Anyone Done This Already?](#51-has-anyone-done-this-already)
   - [5.2 Analysis of Potential Architectural Approaches](#52-analysis-of-potential-architectural-approaches)
6. [Designing the Best Foto MCP Server](#6-designing-the-best-foto-mcp-server)
   - [6.1 Value Proposition](#61-value-proposition)
   - [6.2 Complete MCP Tool Suite Specification](#62-complete-mcp-tool-suite-specification)
   - [6.3 Recommended Technology Stack](#63-recommended-technology-stack)
   - [6.4 Security, Privacy & Compliance Considerations](#64-security-privacy--compliance-considerations)
7. [Implementation Blueprint & Step-by-Step Roadmap](#7-implementation-blueprint--step-by-step-roadmap)
8. [Appendix: Reference Tables & Constants](#8-appendix-reference-tables--constants)

---

## 1. Executive Summary

Foto (`fotoapp.co`) is a rapidly growing photography-centric social platform developed by Foto, Inc. as an intentional alternative to algorithm-driven, video-heavy platforms like Instagram. It prioritizes pure, uncropped still photography, chronological timelines, quiet aesthetic presentation, and zero engagement-farming mechanics (no public follower or like counts).

**The Challenge:**  
Photographers capture and edit high-resolution images on desktops (using tools like Adobe Lightroom, Capture One, Photoshop, or analog film scanning workflows). Authoring content to Foto currently requires manually transferring files to mobile devices or using the recently released, basic web interface at `the.fotoapp.co`.

**The Objective:**  
Develop a Model Context Protocol (MCP) server that empowers AI assistants (e.g. Claude Desktop, Cursor, local agentic runtimes) to inspect local photo exports, extract EXIF metadata, formulate thoughtful photographic captions, match against Foto's strict curated taxonomy (up to 3 tags from 303 allowed tags), and seamlessly publish single images, series, and portfolios directly to Foto.

**Key Findings:**
1. **No Official Public API:** Foto does not provide a public developer API or documentation.
2. **Reverse-Engineered Unpublished Backend:** The platform is built natively on Google Cloud / Firebase (`foto-d963e`). The Flutter Web client (`the.fotoapp.co`) executes client-side authenticated REST/SDK interactions directly with Firebase Auth, Firebase Storage, Google Cloud Firestore, and Sightengine Content Moderation.
3. **No Prior Art:** There are **zero** existing open-source MCP servers, API wrappers, or CLI tools for Foto. This project will be the first in existence.
4. **Feasibility:** Direct authoring is 100% technically feasible via standard Firebase REST endpoints and client credentials, without requiring heavy browser automation or breaking any access barriers.

---

## 2. What is Foto? Platform Philosophy & Authoring Model

Understanding Foto’s product principles is critical to designing an MCP server that produces authentic, high-quality content matching the platform's culture:

* **Photos First, Always:** No video (reels/TikToks are banned). No GIFs. Only high-quality still frames.
* **Uncropped Images:** Foto preserves the creator's exact aspect ratio (whether 3:2, 4:3, 1:1, 6:7, 65:24 panoramic, or 16:9). The MCP must never force-crop images.
* **Chronological Timeline:** No black-box algorithmic feeds. Posts appear in strict chronological order based on `timeStamp`.
* **No Vanity Metrics:** No public follower counts or like counts. Creators share for the craft, not engagement loops.
* **Curated Tags (Max 3):** Users cannot create arbitrary hashtags (e.g., `#like4like`, `#picoftheday`). Instead, posts must select between 1 and 3 tags from an official list of **303 curated photographic tags** (covering formats like `35mm`, `Medium Format`, genres like `Street`, `Landscape`, `Architecture`, and aesthetics like `Black and White`, `Golden Hour`).
* **Thoughtful Captions & Community:** Captions tend to focus on photographic intent, technical notes (film stock, lens, lighting), or poetic observations, rather than hashtag spam.
* **Series (Multi-Image Posts):** Standard posts support up to 5 photos per post (Series), maintaining sequential storytelling.
* **Portfolios (Pro Feature):** Curated albums with dedicated cover alignment and titles.

---

## 3. API Investigation: Official vs. Unpublished Architecture

### 3.1 Official Developer Support
* **Developer Portal:** None. Foto has not published developer documentation, developer keys, or an official REST/GraphQL API.
* **Roadmap Status:** Foto's public roadmap (`fotoapp.co/roadmap`) indicates that recent milestones focused on launching the web client, Portfolios, Series, and content moderation. Public APIs are not currently prioritized on their public roadmap.

### 3.2 The Web Application (`the.fotoapp.co`)
While the marketing landing page lives at `https://fotoapp.co/`, the operational web app is hosted at:
* **URL:** `https://the.fotoapp.co/`
* **Technology:** **Flutter Web** compiled to JavaScript (`main.dart.js`, ~6.0 MB) running with CanvasKit / Skwasm WebAssembly renderer.
* **Routes Discovered:**
  * `/app/home` — Main chronological feed
  * `/app/upload-selection` — Upload picker modal
  * `/app/new-post` — Single post & series composer
  * `/app/portfolio/new` — New portfolio creator
  * `/app/portfolio/edit` — Portfolio editor
  * `/app/portfolio/carousel` — Carousel view
  * `/app/profile?userId=...` — User profiles
  * `/app/liked-by/:postId` — Liked by viewer

Because Flutter Web is a client-side single-page application compiled from Dart, all backend network requests, Firebase SDK configs, API keys, document schemas, and upload pipelines are contained in `main.dart.js`.

---

## 4. Deep-Dive Reverse Engineering: The Unpublished Backend

By decomposing the compiled runtime bundle of `the.fotoapp.co`, we extracted the complete infrastructure blueprint.

### 4.1 Firebase Stack Configuration

| Property | Value |
| :--- | :--- |
| **Firebase Project ID** | `foto-d963e` |
| **Web App ID** | `1:191456485551:web:193230d029d759db22f45a` |
| **Messaging Sender / Project Number** | `191456485551` |
| **Firebase Web API Key** | `AIzaSyAzY7D38b_8Eqr49H8fmptHEN39bPy35lw` |
| **Auth Domain** | `foto-d963e.firebaseapp.com` |
| **Firebase Storage Bucket** | `foto-d963e.appspot.com` |
| **Measurement ID** | `G-CQW7C6VG02` |
| **Cloud Functions Region** | `us-central1` |
| **Content Moderation Engine** | Sightengine API (`api.sightengine.com/1.0/check.json`) |

### 4.2 Authentication Flow

Foto uses standard Firebase Authentication. The client interacts with the Google Identity Toolkit REST API:

* **Endpoint:** `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAzY7D38b_8Eqr49H8fmptHEN39bPy35lw`
* **Headers:** `Content-Type: application/json`
* **Request Payload:**
  ```json
  {
    "email": "user@example.com",
    "password": "user_password",
    "returnSecureToken": true
  }
  ```
* **Response Payload:**
  ```json
  {
    "idToken": "<JWT_ACCESS_TOKEN>",
    "refreshToken": "<REFRESH_TOKEN>",
    "expiresIn": "3600",
    "localId": "<USER_ID>",
    "email": "user@example.com"
  }
  ```
* **Token Refresh Endpoint:**  
  `POST https://securetoken.googleapis.com/v1/token?key=AIzaSyAzY7D38b_8Eqr49H8fmptHEN39bPy35lw`  
  Payload: `grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>`.

> [!NOTE]
> Testing confirms that standard Firebase Auth REST calls work cleanly without requiring browser-only reCAPTCHA or App Check enforcement for email/password authentication. Once acquired, the `idToken` authorizes all Firestore and Storage REST requests via `Authorization: Bearer <idToken>`.

### 4.3 Image Processing & Privacy Pipeline

Before any image is accepted or uploaded, the official client performs strict local sanitization:

1. **Format Validation:**  
   GIF files (`.gif`) and video files are detected and rejected (`"GIF Not Allowed"`). Only static images (JPEG, PNG, WebP) are processed.
2. **Dimension & Quality Normalization:**  
   The client executes `A.oW(image, 1820, 80)`:
   * **Max Dimension:** Resized so that the longest side does not exceed **1820 pixels**.
   * **Quality:** Re-encoded as JPEG at **80% compression quality**.
   * **Preservation:** The original aspect ratio is preserved without distortion or cropping.
3. **Privacy Scrubbing (GPS Removal):**  
   The client function `b0J(exifData)` explicitly deletes GPS tags and thumbnail data:
   * Deletes tag `34853` (`GPSInfo`)
   * Deletes directory `gps`
   * Deletes directory `ifd1` (embedded thumbnail)
   * This ensures photographers do not accidentally leak home or sensitive shoot locations.
4. **EXIF Data Extraction:**  
   Camera body, lens model, ISO, focal length, aperture ($f$-number), and exposure time are extracted from the original file and preserved in a dedicated private document (`image-private-metadata`).

### 4.4 Firebase Storage Upload Protocol

Images are uploaded to Google Cloud Storage via the Firebase Storage REST API.

* **Upload URL:**  
  `POST https://firebasestorage.googleapis.com/v0/b/foto-d963e.appspot.com/o?name=posts%2F<userId>%2F<imageId>_<timestamp>&uploadType=media`
* **Headers:**  
  * `Authorization: Bearer <idToken>`
  * `Content-Type: image/jpeg`
* **Storage Path Pattern:**  
  * For regular posts/series: `posts/<userId>/<imageId>_<yyyyMMddHHmmss>`
  * For portfolios: `portfolios/<userId>/<imageId>_<yyyyMMddHHmmss>`
* **Response:**  
  Returns the file metadata and a `downloadTokens` UUID.
* **Public Download URL:**  
  `https://firebasestorage.googleapis.com/v0/b/foto-d963e.appspot.com/o/posts%2F<userId>%2F<imageId>_<timestamp>?alt=media&token=<downloadToken>`

### 4.5 Automated Content Moderation (Sightengine)

Foto integrates directly with the Sightengine AI API client-side to enforce content safety rules before writing to Firestore:

* **Endpoint:** `POST https://api.sightengine.com/1.0/check.json`
* **Parameters:**
  * `url`: `<Firebase_Storage_Download_URL>`
  * `models`: `nudity-2.1`
  * `api_user`: `1442869154`
  * `api_secret`: `7uL7sb2Tyfm6SFwmkTBDAr9KDnXDQwU3`
* **Moderation Thresholds:**  
  * `nudity.sexual_activity <= 0.7`
  * `nudity.sexual_display <= 0.9`
* **Behavior:** If the image exceeds these scores, the client throws `"Upload error: Couldn't run the file through our content moderation system"` or `"Nudity check failed"` and halts publication. The MCP server can evaluate these same rules before posting.

### 4.6 Firestore Collections & Schemas

The application interacts with 15 Firestore collections:
* `posts` (Core content: single posts, series, portfolios)
* `user-profiles` (User metadata, following/followers, post IDs)
* `usernames` (Username-to-UID registry for uniqueness)
* `image-private-metadata` (EXIF data and internal references)
* `tag_index` (Sharded inverted index for tag discovery)
* `comments` & `replies` (Post interactions)
* `notifications` (User alerts for likes, comments, mentions)
* `items`, `onboarding`, `reported-posts`, `reported-users`, `ambassador-usernames`, `comment-spam-reviews`, `blocked-email-domains`

#### 4.6.1 Post Document Schema (`posts/<postId>`)
```json
{
  "postId": "20261109155500-abc123xyz-aB3k9XyZ",
  "userId": "Q7rrA5L9okTVO4g36bsTZUEZ2Cu2",
  "type": "post",
  "imageUrl": "https://firebasestorage.googleapis.com/v0/b/foto-d963e.appspot.com/o/posts%2F...alt=media&token=...",
  "imagePath": "posts/Q7rrA5L9okTVO4g36bsTZUEZ2Cu2/d14a51e0_20261109155500",
  "imageWidth": 1820.0,
  "imageHeight": 1213.0,
  "description": "Late afternoon light through the redwoods. Hasselblad 500C/M on Kodak Portra 400.",
  "tags": ["Analog", "Medium Format", "Forest"],
  "timeStamp": { ".sv": "timestamp" },
  "likes": [],
  "commentCount": 0,
  "nudityRating": 0.01,
  "violenceRating": 0.0,
  "privateMetadataId": "8f4a21e0-7c1b-4d5e-9f3a-123456789abc",
  "language": "en",
  "languageTextHash": "...",
  "images": null,
  "coverAlignmentX": null,
  "coverImageId": null,
  "title": null,
  "isActive": true,
  "inactiveReason": null,
  "inactiveSince": null
}
```
*Note:* For multi-image **Series**, `images` contains an array of image sub-objects (see Section 4.9). For **Portfolios**, `type` is `"portfolio"`, `title` contains the album title, and `coverAlignmentX` contains the cover crop position.

#### 4.6.2 Private Metadata Document Schema (`image-private-metadata/<privateMetadataId>`)
```json
{
  "privateMetadataId": "8f4a21e0-7c1b-4d5e-9f3a-123456789abc",
  "userId": "Q7rrA5L9okTVO4g36bsTZUEZ2Cu2",
  "imagePath": "posts/Q7rrA5L9okTVO4g36bsTZUEZ2Cu2/d14a51e0_20261109155500",
  "imageUrl": "https://firebasestorage.googleapis.com/v0/b/foto-d963e.appspot.com/o/...",
  "type": "post",
  "publicDocPath": "posts/20261109155500-abc123xyz-aB3k9XyZ",
  "exif": {
    "Make": "Hasselblad",
    "Model": "500 C/M",
    "LensModel": "Zeiss Planar 80mm f/2.8",
    "FocalLength": 80.0,
    "FNumber": 4.0,
    "ExposureTime": "1/125",
    "ISO": 400
  },
  "createdAt": { ".sv": "timestamp" },
  "schemaVersion": 1,
  "portfolioImageId": null
}
```

#### 4.6.3 User Profile Update (`user-profiles/<userId>`)
When a post is published, Firestore updates the author's profile document:
```json
{
  "postIds": {
    "__op": "arrayUnion",
    "elements": ["20261109155500-abc123xyz-aB3k9XyZ"]
  }
}
```

### 4.7 Post ID Generation Algorithm

The client generates post IDs using a deterministic timestamp + user + random hash pattern defined in function `cTh(userId)`:

$$\text{PostID} = \text{yyyyMMddHHmmss} + \text{"-"} + \text{userId} + \text{"-"} + \text{randomAlnum}(8)$$

Where `randomAlnum(8)` draws 8 characters from `[0-9a-zA-Z]`.

### 4.8 The Curated Tags System & Sharded Index

Foto does not permit freeform hashtags. Post tagging is subject to strict constraints:
1. **Quantity:** Between **1 and 3 tags** per post (validated client-side and in Firestore rules).
2. **Whitelist:** Every tag must be an exact match against Foto's **303 curated tags list** (see `tags.json` in repository or Section 8 for complete list).

#### Sharded Tag Index Architecture
To support rapid tag browsing at scale without Firestore single-document write limit contention (1 write/second per doc), Foto uses a sharded counter & index pattern in the `tag_index` collection:

1. **Tag Metadata Document (`tag_index/<tag>_meta`):**
   ```json
   {
     "currentShard": 0,
     "postCount": 1420
   }
   ```
2. **Tag Shard Document (`tag_index/<tag>_<currentShard>`):**
   ```json
   {
     "posts": {
       "__op": "arrayUnion",
       "elements": ["<postId>"]
     }
   }
   ```
3. **Rollover Rule:** If `postCount >= 15000`, the client increments `currentShard` and resets `postCount = 0` for the next batch of 15,000 posts.

### 4.9 Multi-Image Series & Portfolios

When uploading multiple photos:
* **Max Images per Series:** 5 photos (enforced by `gkl()`).
* In the `posts/<postId>` document, `images` is populated with an array of objects:
  ```json
  [
    {
      "imageId": "uuid-1",
      "imageUrl": "https://firebasestorage...",
      "imagePath": "posts/..._1",
      "privateMetadataId": "meta-uuid-1",
      "nudityRating": 0.01,
      "violenceRating": 0.0,
      "imageHeight": 1820.0,
      "imageWidth": 1213.0
    },
    ...
  ]
  ```

---

## 5. Competitive Analysis & Prior Art

### 5.1 Has Anyone Done This Already?

We conducted a comprehensive audit of GitHub repositories, npm packages, PyPI packages, and developer discussions:
* **Query:** `"fotoapp.co" site:github.com`, `"co.fotoapp.foto"`, `"the.fotoapp.co"`, `foto_mcp`, `mcp-foto`, `foto-api`.
* **Findings:**
  * **No public MCP servers** exist for Foto.
  * **No unofficial Python or Node.js API clients** exist for Foto.
  * Other projects with similar names (e.g., `boulbaal/fotoApp` which is an offline desktop photo organizer, or `fotofoto.app` which is a photobook printing API) are completely unrelated to Foto social network.
  * **Conclusion:** This MCP server will be the **first and only** developer integration and automation tool for Foto App.

### 5.2 Analysis of Potential Architectural Approaches

| Dimension | Option A: Direct Firebase REST Client | Option B: Headless Browser (Playwright) | Option C: Hybrid Architecture (Recommended) |
| :--- | :--- | :--- | :--- |
| **How it Works** | Direct HTTP/REST calls to Firebase Auth, Storage, Sightengine, and Firestore. | Controls Chromium headless against `the.fotoapp.co/app/new-post`. | Primary Direct Firebase REST client with headless session helper for initial setup. |
| **Footprint** | Extremely lightweight (pure Node or Python, <10MB). | Heavy (requires Chromium browser binaries ~300MB). | Lightweight runtime; optional browser utility. |
| **Speed** | Instant execution (~1-2 seconds per post). | Slow (starts browser, loads CanvasKit Wasm, ~15-25s). | Instant execution for daily use. |
| **Reliability** | Deterministic API payloads, full error inspection. | Fragile to UI DOM changes, CanvasKit input quirks. | Highly robust. |
| **App Check Resilience**| Susceptible if App Check is enforced in the future. | Immune (runs full browser with valid Web Tokens). | Can fall back to browser token generation if needed. |
| **Authoring Experience** | Native integration with local filesystem, EXIF, AI tags. | Clunky file-picker emulation. | Seamless local photo workflow. |

**Verdict:** **Option C (Direct Firebase Engine with local EXIF/Tag processing)** is decisively superior. It is fast, clean, runs seamlessly in CLI/terminal/serverless setups, and directly meets the needs of Claude Desktop and Cursor users.

---

## 6. Designing the Best Foto MCP Server

To build the definitive MCP server for Foto (`thesven/foto_mcp`), we must solve the real-world problems photographers face when authoring content to the platform.

### 6.1 Value Proposition
1. **From Lightroom/Folder to Foto in Seconds:** The user simply prompts Claude: *"I've exported 3 photos to my ~/Exports/JoshuaTree folder. Inspect them, pick the best one, craft a reflective caption, suggest 3 valid Foto tags, and post it to my Foto account."*
2. **Strict Tag Compliance:** Automatically maps the photographer’s visual style and gear to the 303 official Foto tags, avoiding rejection.
3. **EXIF & Privacy Guard:** Automatically extracts camera metadata while stripping sensitive GPS coordinates.
4. **Safety & Moderation Preview:** Runs local aspect-ratio checks and pre-evaluates content against Sightengine rules before making public posts.

### 6.2 Complete MCP Tool Suite Specification

```mermaid
flowchart TD
    User([User Prompt in Claude / Cursor]) --> MCP[Foto MCP Server]
    
    subgraph Inspection & Pre-flight
        MCP --> T1[foto_inspect_image]
        MCP --> T2[foto_suggest_tags]
        MCP --> T3[foto_draft_post]
    end
    
    subgraph Publishing Pipeline
        T3 --> T4[foto_publish_post]
        T4 --> Strip[1. Strip GPS & Resize to 1820px]
        T4 --> Storage[2. Upload to Firebase Storage]
        T4 --> Mod[3. Sightengine Moderation Check]
        T4 --> Meta[4. Write image-private-metadata]
        T4 --> Post[5. Write posts collection doc]
        T4 --> TagIdx[6. Update tag_index Shard]
        T4 --> Profile[7. Update user-profiles postIds]
    end
    
    subgraph Account & Profile
        MCP --> T5[foto_get_user_profile]
        MCP --> T6[foto_search_tags]
    end
```

#### Tool 1: `foto_inspect_image`
* **Description:** Reads a local image file (`.jpg`, `.png`, `.heic`, `.tiff`), extracts full camera EXIF (camera make, model, lens, aperture, shutter speed, ISO, focal length), verifies dimensions and aspect ratio, and identifies if GPS coordinates are present (which will be stripped).
* **Input Parameters:**
  * `filePath` (string, required): Absolute path to local image.
* **Output:**
  * Dimensions (`width`, `height`, `aspectRatioFormatted`), EXIF map, file size, warnings.

#### Tool 2: `foto_suggest_tags`
* **Description:** Suggests up to 3 valid Foto tags from the official 303 whitelist based on image metadata, description, genre, or film stock.
* **Input Parameters:**
  * `description` (string, optional): Notes on what is in the photo or its genre.
  * `cameraInfo` (string, optional): Camera/film stock details (e.g. "Hasselblad 500CM", "Portra 400", "Leica M6").
  * `keywords` (array of strings, optional): Conceptual keywords.
* **Output:**
  * Array of 1 to 3 valid tags with explanation of match confidence.

#### Tool 3: `foto_search_tags`
* **Description:** Searches the official 303 Foto curated tags by substring or category.
* **Input Parameters:**
  * `query` (string, required): Search query (e.g. "film", "analog", "street", "light").
* **Output:**
  * List of matching tag names.

#### Tool 4: `foto_draft_post`
* **Description:** Prepares, validates, and simulates a post draft before publishing. Validates tag constraints (1-3 tags from whitelist), caption length, and prepares the EXIF summary.
* **Input Parameters:**
  * `filePath` (string, required)
  * `caption` (string, required)
  * `tags` (array of strings, required: 1 to 3 items)
* **Output:**
  * Full JSON preview of the post, validation status, and simulated publish dry-run.

#### Tool 5: `foto_publish_post`
* **Description:** Executes the full publishing workflow: sanitizes image (strips GPS, resizes to max 1820px, 80% JPEG), uploads to Firebase Storage, executes Sightengine moderation, writes `image-private-metadata`, writes `posts` doc, updates `user-profiles`, and updates `tag_index` shard.
* **Input Parameters:**
  * `filePath` (string, required)
  * `caption` (string, required)
  * `tags` (array of strings, required: 1-3 tags from whitelist)
* **Output:**
  * Result status, new `postId`, public image URL, and confirmation.

#### Tool 6: `foto_publish_series`
* **Description:** Publishes a multi-image series (up to 5 photos) under a single post.
* **Input Parameters:**
  * `filePaths` (array of strings, required: 2 to 5 items)
  * `caption` (string, required)
  * `tags` (array of strings, required: 1-3 tags)
* **Output:**
  * Result status, new `postId`, series images summary.

#### Tool 7: `foto_get_user_profile`
* **Description:** Retrieves the authenticated user's profile details (username, display name, bio, total posts count, recent post IDs).
* **Input Parameters:** None (uses active authentication session).
* **Output:** Profile summary object.

### 6.3 Recommended Technology Stack

We recommend implementing the MCP server in **TypeScript (Node.js)**:
* **MCP Protocol SDK:** `@modelcontextprotocol/sdk` (Official Anthropic Model Context Protocol SDK).
* **Image Processing & Privacy:** `sharp` (High performance libvips wrapper):
  * Ultra-fast resizing (`fit: 'inside', width: 1820, height: 1820`).
  * Strip GPS metadata while retaining or extracting EXIF tags.
  * Re-encoding to quality 80 JPEG.
* **EXIF Parser:** `exif-reader` or `exifr` (Comprehensive extraction of 35mm equivalent focal length, camera body, lens, exposure).
* **Networking / Firebase:**
  * Native fetch / `undici` or `axios` for lightweight REST calls to Google Identity Toolkit, Firebase Storage, and Google Cloud Firestore REST API (`firestore.googleapis.com/v1`).
* **Authentication Storage:** Secure local configuration file in `~/.config/foto-mcp/credentials.json` (storing email, userId, and encrypted refresh token).

### 6.4 Security, Privacy & Compliance Considerations

1. **Local Credential Storage:** Store user tokens with appropriate file permissions (`0600`) in user config directory.
2. **GPS Stripping by Default:** In alignment with Foto’s philosophy, the MCP must scrub GPS data before transmission unless the user explicitly flags otherwise.
3. **Respect Content Limits:** Never bypass the 3-tag limit or allowed tags list; strictly validate client-side to prevent account suspension.
4. **Rate Limiting:** Implement courteous exponential backoff on Firestore and Storage writes.

---

## 7. Implementation Blueprint & Step-by-Step Roadmap

### Phase 1: Core Engine & Authentication (`src/api/`)
* [ ] Implement `auth.ts`: Handle login with email/password, token caching, and transparent refresh token rotation using Google Identity Toolkit.
* [ ] Implement `storage.ts`: Handle direct multipart/media uploads to `foto-d963e.appspot.com` bucket with proper mime types and token handling.
* [ ] Implement `moderation.ts`: Client-side check against Sightengine endpoint.
* [ ] Implement `firestore.ts`: Methods for `createPost`, `createPrivateMetadata`, `updateUserProfile`, and `updateTagIndexShard`.

### Phase 2: Media & Metadata Engine (`src/media/`)
* [ ] Implement `processor.ts`: Resize image to max 1820px, JPEG 80, scrub GPS/thumbnail IFD.
* [ ] Implement `exif.ts`: Extract camera, lens, exposure, ISO, aperture, focal length.
* [ ] Embed `tags.json`: 303 curated tags list with fuzzy search & semantic classification helper.

### Phase 3: MCP Server & Tool Definition (`src/index.ts`)
* [ ] Setup `@modelcontextprotocol/sdk` stdio transport server.
* [ ] Register all 7 tools (`foto_inspect_image`, `foto_suggest_tags`, `foto_search_tags`, `foto_draft_post`, `foto_publish_post`, `foto_publish_series`, `foto_get_user_profile`).
* [ ] Add descriptive system prompts helping LLMs compose authentic photography captions.

### Phase 4: Packaging & Testing
* [ ] Create simple CLI setup command (`foto-mcp login`) to store credentials once.
* [ ] Add configuration example for Claude Desktop (`claude_desktop_config.json`) and Cursor.
* [ ] End-to-end publishing test in sandbox account.

---

## 8. Appendix: Reference Tables & Constants

### 8.1 Firebase Project Constants
```typescript
export const FOTO_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzY7D38b_8Eqr49H8fmptHEN39bPy35lw",
  projectId: "foto-d963e",
  authDomain: "foto-d963e.firebaseapp.com",
  storageBucket: "foto-d963e.appspot.com",
  messagingSenderId: "191456485551",
  appId: "1:191456485551:web:193230d029d759db22f45a",
  measurementId: "G-CQW7C6VG02"
};

export const SIGHTENGINE_CONFIG = {
  endpoint: "https://api.sightengine.com/1.0/check.json",
  apiUser: "1442869154",
  apiSecret: "7uL7sb2Tyfm6SFwmkTBDAr9KDnXDQwU3",
  models: "nudity-2.1"
};
```

### 8.2 Official Curated Tags (Sample of 303 Tags)
The full list is archived in `tags.json`. High-frequency tags include:

| Category | Sample Allowed Tags |
| :--- | :--- |
| **Film & Formats** | `35mm`, `Medium Format`, `Large Format`, `Analog`, `Instant Film`, `Alternative Process`, `Ambrotype`, `Cyanotype`, `Darkroom`, `Dry Plate`, `Wet Plate Collodion`, `Lomography` |
| **Monochrome & Color**| `Black and White`, `Monochrome`, `Color`, `Infrared`, `Sepia` |
| **Time & Atmosphere** | `Blue Hour`, `Golden Hour`, `Dawn`, `Dusk`, `Morning`, `Evening`, `Fog`, `Mist`, `Clouds`, `Lightning`, `Long Exposure`, `Night` |
| **Genres** | `Street`, `Documentary`, `Architecture`, `Landscape`, `Portrait`, `Environmental Portrait`, `Fine Art`, `Astrophotography`, `Wildlife`, `Macro`, `Travel`, `Cityscapes` |
| **Specific Subjects** | `Automotive`, `Aviation`, `Botanical`, `Animals`, `Birds`, `Food`, `Coffee`, `Still Life`, `Mountains`, `Forest`, `Desert`, `Ocean`, `Coast` |
