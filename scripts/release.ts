#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeRelease,
  prependChangelogEntry,
  updateReadmeVersionBadge,
  type CommitEntry,
  type SemverBumpType
} from "../src/release/semver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();
}

function getLatestSemverTag(): string | null {
  try {
    const tagsRaw = runGit(["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"]);
    if (!tagsRaw) return null;
    const tags = tagsRaw.split("\n").map((t) => t.trim()).filter(Boolean);
    return tags[0] || null;
  } catch {
    return null;
  }
}

function getCommitsSinceTag(tag: string | null): CommitEntry[] {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  try {
    const format = "%H%x1f%s%x1f%b%x1e";
    const raw = runGit(["log", range, `--format=${format}`]);
    if (!raw) return [];
    return raw
      .split("\x1e")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [sha, subject, body] = chunk.split("\x1f");
        return {
          sha: (sha || "").trim(),
          subject: (subject || "").trim(),
          body: (body || "").trim()
        };
      })
      .filter((c) => Boolean(c.sha && c.subject));
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const applyChanges = args.includes("--apply");
  const writeGithubOutput = args.includes("--github-output");
  const forceBumpIdx = args.indexOf("--bump");
  const forceBumpArg = forceBumpIdx !== -1 ? (args[forceBumpIdx + 1] as SemverBumpType) : undefined;

  const pkgPath = path.join(repoRoot, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const latestTag = getLatestSemverTag();
  const baseVersion = latestTag ? latestTag.replace(/^v/i, "") : (pkgJson.version || "3.0.0");

  const commits = getCommitsSinceTag(latestTag);
  const envLabels = (process.env.PR_LABELS || "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  const validBumps: SemverBumpType[] = ["major", "minor", "patch", "none"];
  const forceBump = forceBumpArg && validBumps.includes(forceBumpArg) ? forceBumpArg : undefined;

  const analysis = analyzeRelease({
    currentVersion: baseVersion,
    commits,
    labels: envLabels,
    forceBump
  });

  if (applyChanges && analysis.shouldRelease) {
    // 1. Update package.json
    pkgJson.version = analysis.nextVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");

    // 2. Update package-lock.json if present
    const pkgLockPath = path.join(repoRoot, "package-lock.json");
    if (fs.existsSync(pkgLockPath)) {
      try {
        const pkgLock = JSON.parse(fs.readFileSync(pkgLockPath, "utf-8"));
        pkgLock.version = analysis.nextVersion;
        if (pkgLock.packages && pkgLock.packages[""]) {
          pkgLock.packages[""].version = analysis.nextVersion;
        }
        fs.writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + "\n", "utf-8");
      } catch {
        // Ignore lockfile parse errors
      }
    }

    // 3. Prepend CHANGELOG.md entry
    const changelogPath = path.join(repoRoot, "CHANGELOG.md");
    if (fs.existsSync(changelogPath)) {
      const existingChangelog = fs.readFileSync(changelogPath, "utf-8");
      const updatedChangelog = prependChangelogEntry(
        existingChangelog,
        analysis.changelogEntry,
        analysis.nextVersion
      );
      fs.writeFileSync(changelogPath, updatedChangelog, "utf-8");
    }

    // 4. Update README.md version badge
    const readmePath = path.join(repoRoot, "README.md");
    if (fs.existsSync(readmePath)) {
      const existingReadme = fs.readFileSync(readmePath, "utf-8");
      const updatedReadme = updateReadmeVersionBadge(existingReadme, analysis.nextVersion);
      fs.writeFileSync(readmePath, updatedReadme, "utf-8");
    }
  }

  if (writeGithubOutput && process.env.GITHUB_OUTPUT) {
    const outPath = process.env.GITHUB_OUTPUT;
    const notesFile = path.join(repoRoot, ".release-notes.md");
    fs.writeFileSync(notesFile, analysis.releaseNotes, "utf-8");

    const lines = [
      `should_release=${analysis.shouldRelease}`,
      `bump_type=${analysis.bumpType}`,
      `current_version=${analysis.currentVersion}`,
      `current_tag=${analysis.currentTag}`,
      `next_version=${analysis.nextVersion}`,
      `next_tag=${analysis.nextTag}`,
      `commits_count=${analysis.commits.length}`,
      `notes_file=${notesFile}`
    ];
    fs.appendFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  }

  console.log(JSON.stringify(analysis, null, 2));
}

main();
