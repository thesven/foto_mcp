# Changelog

All notable changes to `foto_mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2026-11-10

### Fixed
- **review:** address BMAD code review findings for EXIF orientation, XML parsing, regex escaping, and credential sync (#2) (`e08c84c`)

### Documentation & Maintenance
- **release:** add automated semver release pipeline and branch workflow (#1) (`74a0eee`)

## [3.0.0] - 2026-11-10

### Added
- **100% Platform Architecture Coverage & Social Graph Parity (49 Total MCP Tools)**:
  - `foto_check_username`: Real-time handle validation checking alphanumeric formatting and querying `usernames/{username}`.
  - `foto_get_user_followers` & `foto_get_user_following`: Complete social graph traversal resolving follower and following creator profiles (`user-profiles/{userId}`).
  - `foto_get_featured_photographers`: Community discovery querying `ambassador-usernames` with fallback to top curated tag creators.
  - `foto_upload_profile_photo`: Profile photo processing (400x400 square crop, embedded sRGB ICC, GPS stripped, JPEG 85%) and upload to `avatars/{userId}` with profile document update.
  - `foto_dismiss_notification`: Alert management dismissing notifications from `notifications/{notificationId}`.
  - `foto_get_explore_feed`: Discovery feed aggregating public posts across major curated genres (`Landscape`, `Street`, `Portrait`, `Analog`, `Fine Art`, `Architecture`, `Black and White`).
  - `foto_update_portfolio` & `foto_delete_portfolio`: Full CRUD lifecycle for curated Portfolio showcases (`type: "portfolio"`), supporting live updates to title, artist statement, curated tags, cover slide selection, and horizontal alignment, plus cascade deletion across all slide private metadata and tag shards.
  - `foto_delete_comment`: Delete your comments or threaded replies from `comments` or `replies` with automatic `commentCount` decrementing.
  - `foto_get_post_likes`: Inspect the photographers who liked a post (`/app/liked-by/:postId`), resolving user IDs, usernames, display names, avatars, and profile URLs.
  - `foto_update_user_profile`: Update authenticated photographer profile fields (`displayName`, `bio`, `website`, `profilePhotoUrl`) in `user-profiles/{userId}`.
  - `foto_report_content`: Submit community safety moderation reports to `reported-posts` or `reported-users`.
  - **Threaded Comment Replies**: Upgraded `foto_get_comments` (`includeReplies: true`) and `foto_post_comment` (`parentCommentId`) to read and write nested replies in Firestore's `replies` collection.
  - **Cascade Post & Series Cleanup**: Upgraded `deletePostFromFirestore` to delete all `privateMetadataId` records across multi-image `images[]` arrays and remove deleted `postId`s from active `tag_index` shards.
- **Studio Color Science & Adobe Lightroom / Capture One `.xmp` Sidecars**:
  - `foto_parse_xmp`: Dedicated `.xmp` sidecar parser (`src/media/xmp.ts`) extracting star ratings (`xmp:Rating`), color labels (`xmp:Label`), Dublin Core titles/descriptions (`dc:title`, `dc:description`), hierarchical keywords (`dc:subject`, `lr:hierarchicalSubject`), camera/lens info, and Fujifilm film simulation metadata.
  - Upgraded `foto_watch_directory` and `foto_inspect_image` to automatically discover companion `.xmp` sidecars and filter studio exports by `minRating` (1–5 stars) and `colorLabel` (`Red`, `Yellow`, `Green`, `Blue`, `Purple`).
  - Upgraded `prepareImageForUpload` with `.withIccProfile("srgb")` so normalized uploads embed a standard sRGB IEC61966-2.1 ICC profile while keeping GPS and thumbnail IFDs completely stripped.
- **VSCO Archive & Preset Importer**:
  - `foto_sync_vsco`: Migrates photography archives from VSCO JSON exports, mapping VSCO film emulation presets (`A4`, `A6`, `M5`, `B1`, `B5`, `C1`, `F2`, `G3`, `HB2`, `KP1`, `KX4`, `T1`, `P5`, etc.) directly to Foto's 303 curated tags (`Analog`, `Film`, `Black and White`, `Portrait`, `Color`, `Moody`, `Minimal`).
- **Multi-Account Profiles, AES-256-GCM Encryption & Offline Draft Queue**:
  - `foto_list_profiles` & `foto_switch_profile`: Named multi-account profile management (`default`, `street`, `studio`, etc.) with profile-scoped `foto_login` and `foto_logout`.
  - **Encrypted Credential Storage**: Added AES-256-GCM encryption at rest (`encryptCredentialsPayload` / `decryptCredentialsPayload` in `profiles.json`) using `FOTO_CREDENTIALS_SECRET` or host key derivation while preserving full backward compatibility with `credentials.json`.
  - `foto_queue_draft` & `foto_manage_draft_queue`: Persistent local offline draft queue (`~/.config/foto-mcp/draft-queue.json`) supporting staging single posts or multi-image series offline and batch-publishing (`action: "list" | "publish" | "remove"`).
  - **Exponential Backoff Retries**: Added `fetchWithRetry` for resilient handling of transient `429`, `502`, `503`, and `504` responses.
  - **Multi-Session SSE Transport**: Upgraded SSE HTTP server to track concurrent client sessions via `sessionId` and expose a JSON health/capabilities status endpoint.
- **Expanded MCP Resources (10 Total) & Prompts (7 Total)**:
  - Added `foto://my/profile`, `foto://my/followers`, `foto://my/following`, `foto://explore/featured`, and `foto://tags/{tag}/recent` dynamic resources and templates.
  - Added `portfolio_curator` (masterclass portfolio sequencing, alignment, artist statement) and `analog_lab_assistant` (film recipes, push/pull ISO, chemistry, analog tag mapping) prompts, joining `photo_walk_curator`, `daily_foto_briefing`, `curate_foto_post`, `critique_photograph`, and `curate_photo_series`.
  - Upgraded `foto_draft_post` to return multimodal `ImageContent` (`image/jpeg`) previews alongside validation diagnostics.

## [2.0.0] - 2026-11-09

### Added
- **Universal Migration & Archival Ecosystem (29 Total MCP Tools)**:
  - `foto_sync_flickr`: Migrates photography archives from official Flickr JSON account exports. Automatically maps Flickr tags to Foto's 303 curated taxonomy, cleans narrative descriptions, associates local image files, scrubs GPS, deduplicates against published posts, and supports `dryRun=true`.
  - `foto_export_vault`: Full archival vault backup downloader. Downloads published high-resolution photos, generates per-post camera EXIF sidecars (`<postId>.json`), and builds a master `manifest.json` archive index with tag breakdowns and engagement metrics.
  - `foto_watch_directory`: Pro studio export monitor. Scans Lightroom, Capture One, and darktable output directories, extracts camera and lens EXIF metadata, generates sRGB base64 multimodal preview thumbnails, auto-suggests curated tags, and stages publication drafts.
- **SSE / HTTP Remote MCP Transport**:
  - Added Server-Sent Events (SSE) remote transport mode alongside default Stdio JSON-RPC.
  - Configurable via `--transport sse --port <port>` CLI flags or `MCP_TRANSPORT=sse` and `MCP_PORT=<port>` environment variables.
  - Enables hosting `foto_mcp` as a remote microservice or containerized agent endpoint.
- **Node.js LTS Alignment**:
  - Updated Node engine requirement to `">=20.9.0"` in alignment with Sharp 0.35+ and modern LTS runtimes (Node 20.x, 22.x, 24.x).
  - Maintained 100% CI pass rate across all matrix environments.

## [1.5.0] - 2026-11-09

### Added
- **Curated Portfolios Engine (27 Total MCP Tools)**:
  - `foto_create_portfolio`: Create and publish multi-image portfolio showcase collections with custom titles, cover image selection, alignment controls, and curated tag metadata. Supports `dryRun=true`.
  - `foto_list_portfolios`: Query and browse portfolio collections for any photographer or the authenticated user.
  - Firestore schema support for `type: "portfolio"`, `coverImageId`, `coverAlignmentX`, and `images` slide arrays with individual EXIF and captions.
- **Multimodal Visual Inspection (`ImageContent`)**:
  - `foto_inspect_image` now generates and returns a color-corrected sRGB base64 thumbnail (`type: "image"`, `mimeType: "image/jpeg"`) alongside technical JSON metadata, allowing LLMs and MCP clients to visually preview photos before publishing.
  - Exported `generateImagePreview` helper in media processor.
- **sRGB Color Normalization & ICC Handling**:
  - Enhanced Sharp pipeline in `prepareImageForUpload` with `.toColorspace("srgb")` to eliminate washed-out color shifts on wide-gamut (Adobe RGB / ProPhoto RGB / Display P3) photos across web and mobile screens.
  - Added `colorSpace` and `hasIccProfile` detection to image inspections.
- **Film Simulation & Analog Film Stock Detection**:
  - Expanded `suggestTags` to recognize Fujifilm film simulations (`Classic Chrome`, `Classic Neg`, `Velvia`, `Acros`, `Provia`, `Astia`, `Eterna`, `Nostalgic Neg`) and analog film stocks (`Portra`, `Tri-X`, `HP5`, `CineStill`, `Ektar`, `Delta`, `T-Max`, `Gold 200`).
  - Automatically maps detected simulations and stocks to official Foto tags (`Analog`, `Black and White`, `35mm`, `Medium Format`, `Color`, `Film`).
- **CI & Node Compatibility**:
  - Resolved Node 18 CommonJS ESM loader issue with `c8` by updating dev dependency to CommonJS-compatible `c8@10.1.3`.
  - Expanded GitHub Actions CI matrix to test Node 18, 20, 22, and 24 with `fail-fast: false`.

## [1.4.0] - 2026-11-09

### Added
- **Social Graph & Community Suite (25 Total MCP Tools)**:
  - `foto_like_post`: Like/bookmark posts on Foto using atomic Cloud Firestore `:commit` transforms (`appendMissingElements`).
  - `foto_unlike_post`: Remove likes from posts using atomic `removeAllFromArray` transforms.
  - `foto_get_comments`: Retrieve comments and community discussions for any post.
  - `foto_post_comment`: Publish thoughtful comments and photographic critiques to posts with atomic `commentCount` increments.
  - `foto_get_notifications`: Read recent community interaction alerts (likes, comments, mentions, follows) from the `notifications` collection.
  - `foto_get_home_feed`: Retrieve a chronological home timeline of posts published by creators you follow.
- **Dynamic MCP Resources**:
  - `foto://my/feed`: Dynamic resource providing live JSON feed of followed creators' latest posts.
  - `foto://my/notifications`: Dynamic resource stream of recent alerts and community interactions.
- **Masterclass MCP Prompts**:
  - `critique_photograph`: Structured masterclass critique evaluating Composition (framing, leading lines), Lighting (quality, dynamic range), Technical & Exposure (depth of field, shutter speed), and Emotional Storytelling.
  - `curate_photo_series`: Structured sequencing workflow for curating 2 to 5 photos into an emotional, cohesive narrative story.
- **Test Suite**:
  - Full modular unit tests for all 6 new social tools, dynamic feed resources, and masterclass prompts, maintaining >97% test coverage.

## [1.3.0] - 2026-11-09

### Added
- **Content Lifecycle & Profile Discovery Suite (19 Total MCP Tools)**:
  - `foto_unfollow_user`: Unfollow photographers by single `userId` or bulk `userIds` via atomic `removeAllFromArray` Firestore transforms.
  - `foto_delete_post`: Delete published posts by `postId`, automatically cleaning up post documents, removing IDs from user profile `postIds`, and removing private metadata.
  - `foto_update_post`: Update captions and curated tags on existing posts with automatic 303-tag whitelist validation and tag index updating.
  - `foto_get_post`: Retrieve full details of any post including high-res image URL, technical EXIF metadata, and engagement stats.
  - `foto_get_photographer_profile`: Look up any photographer's public profile and recent posts by `userId` or `@username` handle.
- **Dynamic MCP Resource Templates**:
  - `foto://posts/{postId}`: Live JSON post document with EXIF camera gear metadata.
  - `foto://users/{userId}`: Creator profile, bio, follower count, and recent works.
- **Client & Firestore Engine Additions**:
  - Added `deletePostFromFirestore`, `updatePostInFirestore`, `fetchPostWithMetadata`, and `resolveUserByUsername`.
  - Added `deletePost`, `updatePost`, `getPost`, `getPhotographerProfile`, and `unfollowUsers` to `FotoClient`.
- **Test Coverage**:
  - Comprehensive unit test suites for all 5 new tools and 2 resource templates, maintaining >97% test coverage.

## [1.2.0] - 2026-11-09

### Added
- **Social Graph & Follow Tools (14 Total MCP Tools)**:
  - `foto_follow_user`: Follow photographers individually by `userId` or in bulk by `userIds`.
  - Implemented atomic Cloud Firestore `:commit` transforms using `appendMissingElements` to concurrently update both the current user's `following` array and target users' `followers` arrays without race conditions or duplicate entries.
  - Implemented `unfollowUser` and `unfollowUserInFirestore` utilizing `removeAllFromArray` transforms.
- **Client Follow Suite**:
  - Added `client.followUser(userId)`, `client.followUsers(userIds)`, and `client.unfollowUser(userId)` to `FotoClient`.
- **Test Suite & Isolation Improvements**:
  - Added unit test coverage for single, batch, and error conditions for `foto_follow_user` and Firestore atomic transforms.
  - Isolated test credential storage using dynamic `process.env.FOTO_CONFIG_DIR`, ensuring local user login sessions remain intact across test runs.
  - Test suite coverage maintained at >97%.

## [1.1.0] - 2026-11-09

### Added
- **Tag Browsing & Photographer Discovery Tools (13 Total MCP Tools)**:
  - `foto_browse_tag`: Browse recent public posts under any of Foto's 303 curated tags (including `Wildlife`, `Street`, `Landscape`, `Portrait`, `Analog`, etc.) with shard navigation and pagination.
  - `foto_find_photographers_by_tag`: Search and discover photographers who publish under a specific curated genre or aesthetic tag (e.g., `Wildlife`, `Landscape`, `Portrait`, `Street`). Aggregates posts from tag shards, resolves author profiles, bios, follower/post stats, and provides direct profile links with sample works.
- **Firestore Tag Discovery Engine**:
  - Implemented `fetchTagIndexMeta`, `fetchTagShardPosts`, `fetchPostDocument`, and `fetchPostsDocuments` for reading inverted sharded tag indexes and post documents in Cloud Firestore.
- **Test Suite Expansion**:
  - Added comprehensive unit tests for discovery pipelines, tag shard navigation, and photographer aggregation, maintaining 97%+ test coverage.

## [1.0.0] - 2026-11-09

### Added
- **Core MCP Tool Suite (11 Tools)**:
  - `foto_auth_status`: Real-time session inspection and expiration monitoring.
  - `foto_login`: In-chat authentication with email and password via Firebase Auth REST API.
  - `foto_logout`: Session teardown and local credential revocation.
  - `foto_inspect_image`: Local photo inspection, aspect ratio formatting, GPS detection, and camera/lens/exposure EXIF extraction without uploading.
  - `foto_suggest_tags`: Smart semantic tag recommender mapping captions, gear, and film stocks to Foto's official 303 allowed tags.
  - `foto_search_tags`: Search and prefix autocomplete across the 303 curated tags.
  - `foto_draft_post`: Pre-publish validation for aspect ratios, tag constraints, and EXIF summaries.
  - `foto_publish_post`: Zero-crop normalization (max 1820px, JPEG 80%), GPS scrubbing, Sightengine content moderation, and Firestore post creation. Supports dry-run validation.
  - `foto_publish_series`: Multi-image sequential storytelling posts (2 to 5 photos). Supports dry-run validation.
  - `foto_get_user_profile`: Authenticated user profile and published post retrieval.
  - `foto_sync_instagram`: Migration tool for Instagram HTML/JSON data exports with hashtag scrubbing, curated tag mapping, GPS stripping, and deduplication against already-published Foto posts.
- **MCP Resources**:
  - `foto://curated-tags`: Exposes the complete 303 curated tags taxonomy as JSON for client-side autocomplete and prompt grounding.
- **MCP Prompts**:
  - `curate_foto_post`: Prompt template instructing AI assistants to formulate posts adhering to Foto's photography-first, zero-hashtag community ethos.
- **CI/CD**:
  - GitHub Actions workflow testing builds and type safety across Node 18, 20, and 22.
- **Documentation**:
  - Comprehensive `README.md` with client setups for Claude Desktop, Cursor, Zed, and Windsurf, plus `npx` quickstart.
  - 531-line exhaustive reverse-engineering specification in `RESEARCH.md`.

### Changed
- Switched to dual bin aliases (`foto-mcp` and `foto_mcp`) for seamless `npx` execution.
- Added strict publish packaging controls (`files` field in `package.json`).
- Strengthened HTML export entity decoding to handle newlines (`&#10;`, `&#13;`) and non-breaking spaces.
