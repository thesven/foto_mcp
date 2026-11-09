# Changelog

All notable changes to `foto_mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
