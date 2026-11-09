# Changelog

All notable changes to `foto_mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - `foto_browse_tag`: Browse recent public posts under any of Foto's 303 curated tags (including `Fine Art Nude`, `Boudoir`, `Street`, `Landscape`, `Analog`, etc.) with shard navigation and pagination.
  - `foto_find_photographers_by_tag`: Search and discover photographers who publish under a specific curated genre or aesthetic tag (e.g., `Fine Art Nude`, `Boudoir`, `Portrait`). Aggregates posts from tag shards, resolves author profiles, bios, follower/post stats, and provides direct profile links with sample works.
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
