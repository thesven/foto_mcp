import assert from "node:assert";
import {
  parseSemver,
  incrementSemver,
  maxBump,
  classifyCommit,
  resolveLabelBump,
  formatReleaseMarkdown,
  analyzeRelease,
  prependChangelogEntry,
  updateReadmeVersionBadge
} from "../../src/release/semver.js";

export async function runSemverTests() {
  console.log("--- Testing Semantic Release Engine module ---");

  // 1. parseSemver & incrementSemver
  const parsed = parseSemver("v3.0.0");
  assert.deepStrictEqual(parsed, { major: 3, minor: 0, patch: 0 });
  assert.throws(() => parseSemver("invalid-ver"), /Invalid semantic version/);

  assert.strictEqual(incrementSemver("3.0.0", "major"), "4.0.0");
  assert.strictEqual(incrementSemver("3.0.0", "minor"), "3.1.0");
  assert.strictEqual(incrementSemver("3.0.0", "patch"), "3.0.1");
  assert.strictEqual(incrementSemver("3.0.0", "none"), "3.0.0");

  // 2. maxBump priority
  assert.strictEqual(maxBump("none", "patch"), "patch");
  assert.strictEqual(maxBump("patch", "minor"), "minor");
  assert.strictEqual(maxBump("minor", "major"), "major");
  assert.strictEqual(maxBump("major", "patch"), "major");

  // 3. classifyCommit rules
  const featCommit = classifyCommit({ sha: "abc1234567", subject: "feat(sync): add Capture One catalog importer" });
  assert.strictEqual(featCommit.bump, "minor");
  assert.strictEqual(featCommit.type, "feat");
  assert.strictEqual(featCommit.scope, "sync");
  assert.strictEqual(featCommit.breaking, false);

  const fixCommit = classifyCommit({ sha: "def1234567", subject: "fix(auth): handle token refresh timeout" });
  assert.strictEqual(fixCommit.bump, "patch");
  assert.strictEqual(fixCommit.type, "fix");

  const breakingBang = classifyCommit({ sha: "1112223334", subject: "feat(api)!: drop legacy v1 endpoints" });
  assert.strictEqual(breakingBang.bump, "major");
  assert.strictEqual(breakingBang.breaking, true);

  const breakingBody = classifyCommit({
    sha: "2223334445",
    subject: "refactor: overhaul storage parameters",
    body: "BREAKING CHANGE: folder parameter is now required"
  });
  assert.strictEqual(breakingBody.bump, "major");
  assert.strictEqual(breakingBody.breaking, true);

  const docsCommit = classifyCommit({ sha: "3334445556", subject: "docs(readme): update examples" });
  assert.strictEqual(docsCommit.bump, "none");

  const choreRelease = classifyCommit({ sha: "4445556667", subject: "chore(release): v3.1.0 [skip ci]" });
  assert.strictEqual(choreRelease.bump, "none");
  assert.strictEqual(choreRelease.type, "release");

  const skipMarker = classifyCommit({ sha: "5556667778", subject: "feat: experimental [skip release]" });
  assert.strictEqual(skipMarker.bump, "none");
  assert.strictEqual(skipMarker.type, "release");

  const customConventional = classifyCommit({ sha: "6667778889", subject: "custom: some custom type" });
  assert.strictEqual(customConventional.bump, "patch");

  // Non-conventional fallbacks
  const nonConvMajor = classifyCommit({ sha: "7778889990", subject: "Major overhaul [semver:major]" });
  assert.strictEqual(nonConvMajor.bump, "major");

  const nonConvMinor = classifyCommit({ sha: "8889990001", subject: "Add new tool [semver:minor]" });
  assert.strictEqual(nonConvMinor.bump, "minor");

  const nonConvSkip = classifyCommit({ sha: "9990001112", subject: "Update typo [semver:skip]" });
  assert.strictEqual(nonConvSkip.bump, "none");

  const nonConvDefault = classifyCommit({ sha: "0001112223", subject: "Quick tweak to timeout" });
  assert.strictEqual(nonConvDefault.bump, "patch");

  // 4. resolveLabelBump
  assert.deepStrictEqual(resolveLabelBump(["semver:major"]), { bump: "major", forcedSkip: false });
  assert.deepStrictEqual(resolveLabelBump(["semver:minor"]), { bump: "minor", forcedSkip: false });
  assert.deepStrictEqual(resolveLabelBump(["semver:patch"]), { bump: "patch", forcedSkip: false });
  assert.deepStrictEqual(resolveLabelBump(["semver:skip"]), { bump: "none", forcedSkip: true });
  assert.deepStrictEqual(resolveLabelBump(["documentation"]), { bump: "none", forcedSkip: false });

  // 5. analyzeRelease & formatReleaseMarkdown
  const analysisMinor = analyzeRelease({
    currentVersion: "3.0.0",
    dateStr: "2026-11-10",
    commits: [
      { sha: "a1b2c3d4e5", subject: "feat(xmp): support Capture One ratings" },
      { sha: "f6e5d4c3b2", subject: "fix(firestore): retry on 503" },
      { sha: "1234567890", subject: "perf(processor): optimize sharp pipeline" },
      { sha: "0987654321", subject: "docs: update README" }
    ]
  });
  assert.strictEqual(analysisMinor.shouldRelease, true);
  assert.strictEqual(analysisMinor.bumpType, "minor");
  assert.strictEqual(analysisMinor.nextVersion, "3.1.0");
  assert.strictEqual(analysisMinor.nextTag, "v3.1.0");
  assert(analysisMinor.releaseNotes.includes("### Added"));
  assert(analysisMinor.releaseNotes.includes("### Fixed"));
  assert(analysisMinor.releaseNotes.includes("### Changed & Improved"));
  assert(analysisMinor.releaseNotes.includes("### Documentation & Maintenance"));
  assert(analysisMinor.changelogEntry.includes("## [3.1.0] - 2026-11-10"));

  // Label override to major
  const analysisLabelMajor = analyzeRelease({
    currentVersion: "3.0.0",
    commits: [{ sha: "111", subject: "fix: small change" }],
    labels: ["semver:major"]
  });
  assert.strictEqual(analysisLabelMajor.bumpType, "major");
  assert.strictEqual(analysisLabelMajor.nextVersion, "4.0.0");

  // Label override to skip
  const analysisLabelSkip = analyzeRelease({
    currentVersion: "3.0.0",
    commits: [{ sha: "111", subject: "feat: big change" }],
    labels: ["semver:skip"]
  });
  assert.strictEqual(analysisLabelSkip.shouldRelease, false);
  assert.strictEqual(analysisLabelSkip.bumpType, "none");

  // Force bump override
  const analysisForced = analyzeRelease({
    currentVersion: "3.0.0",
    commits: [],
    forceBump: "patch"
  });
  assert.strictEqual(analysisForced.shouldRelease, true);
  assert.strictEqual(analysisForced.nextVersion, "3.0.1");

  // Breaking change section formatting
  const analysisBreaking = analyzeRelease({
    currentVersion: "3.0.0",
    commits: [{ sha: "999888777", subject: "feat!: v4 protocol" }]
  });
  assert(analysisBreaking.releaseNotes.includes("### Breaking Changes"));

  // 6. prependChangelogEntry & updateReadmeVersionBadge
  const sampleChangelog = `# Changelog\n\nAll notable changes...\n\n## [3.0.0] - 2026-11-10\n\n- Initial 3.0.0\n`;
  const updatedChangelog = prependChangelogEntry(sampleChangelog, analysisMinor.changelogEntry, "3.1.0");
  assert(updatedChangelog.indexOf("## [3.1.0]") < updatedChangelog.indexOf("## [3.0.0]"));

  // Idempotent if version already exists
  const duplicateChangelog = prependChangelogEntry(updatedChangelog, analysisMinor.changelogEntry, "3.1.0");
  assert.strictEqual(duplicateChangelog, updatedChangelog);

  // Changelog without existing version headers
  const bareChangelog = `# Changelog\n`;
  const appendedBare = prependChangelogEntry(bareChangelog, analysisMinor.changelogEntry, "3.1.0");
  assert(appendedBare.includes("## [3.1.0]"));

  const sampleReadme = `# Foto MCP\n[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](package.json)\n`;
  const updatedReadme = updateReadmeVersionBadge(sampleReadme, "3.1.0");
  assert(updatedReadme.includes("version-3.1.0-blue.svg"));

  console.log("  ✓ Semantic Release Engine unit tests passed");
}
