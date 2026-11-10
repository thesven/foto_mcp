/**
 * Semantic Versioning & Release Engine for foto_mcp
 *
 * Analyzes commits and PR labels since the latest semver Git tag (vX.Y.Z)
 * to determine:
 * 1. Whether a new release & publish is required (`major`, `minor`, `patch`, or `none`)
 * 2. The next semantic version (`nextVersion`, `nextTag`)
 * 3. Categorized release notes and `CHANGELOG.md` entry
 */

export type SemverBumpType = "major" | "minor" | "patch" | "none";

export interface CommitEntry {
  sha: string;
  subject: string;
  body?: string;
}

export interface ParsedCommit extends CommitEntry {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
  bump: SemverBumpType;
}

export interface ReleaseAnalysis {
  currentVersion: string;
  currentTag: string;
  bumpType: SemverBumpType;
  shouldRelease: boolean;
  nextVersion: string;
  nextTag: string;
  commits: ParsedCommit[];
  releaseNotes: string;
  changelogEntry: string;
}

/**
 * Validates and parses a semantic version string (e.g. "3.0.0" or "v3.0.0")
 */
export function parseSemver(versionStr: string): { major: number; minor: number; patch: number } {
  const clean = versionStr.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(clean);
  if (!match) {
    throw new Error(`Invalid semantic version: "${versionStr}"`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

/**
 * Increments a semantic version according to bumpType
 */
export function incrementSemver(currentVersion: string, bumpType: SemverBumpType): string {
  const { major, minor, patch } = parseSemver(currentVersion);
  switch (bumpType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "none":
      return `${major}.${minor}.${patch}`;
  }
}

const BUMP_PRIORITY: Record<SemverBumpType, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3
};

/**
 * Returns the higher-priority semver bump of two candidates
 */
export function maxBump(a: SemverBumpType, b: SemverBumpType): SemverBumpType {
  return BUMP_PRIORITY[a] >= BUMP_PRIORITY[b] ? a : b;
}

/**
 * Parses a single commit subject and body using Conventional Commits & Semver rules
 */
export function classifyCommit(commit: CommitEntry): ParsedCommit {
  const subject = commit.subject.trim();
  const body = (commit.body || "").trim();
  const fullText = `${subject}\n${body}`;

  // Skip automated release commits or explicit skip markers
  if (
    /^chore\(release\):/i.test(subject) ||
    /\[skip release\]/i.test(fullText) ||
    /\[release skip\]/i.test(fullText)
  ) {
    return {
      ...commit,
      type: "release",
      breaking: false,
      description: subject,
      bump: "none"
    };
  }

  // Conventional commit pattern: type(scope)!: description
  const conventionalMatch = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);

  const hasBreakingIndicator =
    Boolean(conventionalMatch?.[3]) ||
    /BREAKING[\s-]CHANGE:/i.test(fullText) ||
    /\[semver:\s*major\]/i.test(fullText) ||
    /\[major\]/i.test(fullText);

  if (conventionalMatch) {
    const rawType = conventionalMatch[1].toLowerCase();
    const scope = conventionalMatch[2];
    const description = conventionalMatch[4].trim();

    let bump: SemverBumpType = "none";
    if (hasBreakingIndicator) {
      bump = "major";
    } else if (/\[semver:\s*minor\]/i.test(fullText) || rawType === "feat" || rawType === "feature") {
      bump = "minor";
    } else if (
      /\[semver:\s*patch\]/i.test(fullText) ||
      ["fix", "bugfix", "perf", "refactor", "security", "revert", "deps", "build"].includes(rawType)
    ) {
      bump = "patch";
    } else if (["docs", "chore", "ci", "test", "style"].includes(rawType)) {
      bump = "none";
    } else {
      bump = "patch";
    }

    return {
      ...commit,
      type: rawType,
      scope,
      breaking: hasBreakingIndicator,
      description,
      bump
    };
  }

  // Fallback for non-conventional commit subjects
  if (hasBreakingIndicator) {
    return {
      ...commit,
      type: "breaking",
      breaking: true,
      description: subject,
      bump: "major"
    };
  }

  if (/\[semver:\s*minor\]/i.test(fullText)) {
    return {
      ...commit,
      type: "feat",
      breaking: false,
      description: subject,
      bump: "minor"
    };
  }

  if (/\[semver:\s*(skip|none)\]/i.test(fullText)) {
    return {
      ...commit,
      type: "chore",
      breaking: false,
      description: subject,
      bump: "none"
    };
  }

  return {
    ...commit,
    type: "patch",
    breaking: false,
    description: subject,
    bump: "patch"
  };
}

/**
 * Resolves bump override from PR labels (e.g. "semver:major", "semver:minor", "semver:patch", "semver:skip")
 */
export function resolveLabelBump(labels: string[]): { bump: SemverBumpType; forcedSkip: boolean } {
  const normalized = labels.map((l) => l.trim().toLowerCase());
  if (normalized.includes("semver:skip") || normalized.includes("release:skip") || normalized.includes("no-release")) {
    return { bump: "none", forcedSkip: true };
  }
  if (normalized.includes("semver:major") || normalized.includes("breaking")) {
    return { bump: "major", forcedSkip: false };
  }
  if (normalized.includes("semver:minor") || normalized.includes("enhancement") || normalized.includes("feature")) {
    return { bump: "minor", forcedSkip: false };
  }
  if (normalized.includes("semver:patch") || normalized.includes("bug") || normalized.includes("fix")) {
    return { bump: "patch", forcedSkip: false };
  }
  return { bump: "none", forcedSkip: false };
}

/**
 * Generates structured Markdown release notes and CHANGELOG section
 */
export function formatReleaseMarkdown(params: {
  version: string;
  previousTag: string;
  dateStr: string;
  commits: ParsedCommit[];
  repoUrl?: string;
}): { releaseNotes: string; changelogEntry: string } {
  const { version, previousTag, dateStr, commits, repoUrl = "https://github.com/thesven/foto_mcp" } = params;

  const breaking = commits.filter((c) => c.breaking);
  const features = commits.filter((c) => !c.breaking && (c.type === "feat" || c.type === "feature"));
  const fixes = commits.filter((c) => !c.breaking && ["fix", "bugfix", "security", "revert"].includes(c.type));
  const perfAndRefactor = commits.filter(
    (c) => !c.breaking && ["perf", "refactor", "deps", "build", "patch"].includes(c.type)
  );
  const docsAndChore = commits.filter(
    (c) => !c.breaking && ["docs", "chore", "ci", "test", "style"].includes(c.type)
  );

  const formatItem = (c: ParsedCommit) => {
    const scopePrefix = c.scope ? `**${c.scope}:** ` : "";
    const shortSha = c.sha ? ` (\`${c.sha.slice(0, 7)}\`)` : "";
    return `- ${scopePrefix}${c.description}${shortSha}`;
  };

  const sections: string[] = [];

  if (breaking.length > 0) {
    sections.push(`### Breaking Changes\n${breaking.map(formatItem).join("\n")}`);
  }
  if (features.length > 0) {
    sections.push(`### Added\n${features.map(formatItem).join("\n")}`);
  }
  if (fixes.length > 0) {
    sections.push(`### Fixed\n${fixes.map(formatItem).join("\n")}`);
  }
  if (perfAndRefactor.length > 0) {
    sections.push(`### Changed & Improved\n${perfAndRefactor.map(formatItem).join("\n")}`);
  }
  if (docsAndChore.length > 0) {
    sections.push(`### Documentation & Maintenance\n${docsAndChore.map(formatItem).join("\n")}`);
  }

  const bodyContent = sections.length > 0 ? sections.join("\n\n") : "- Maintenance and stability updates.";
  const compareLink = previousTag
    ? `\n\n**Full Changelog**: ${repoUrl}/compare/${previousTag}...v${version}`
    : "";

  const releaseNotes = `## Foto MCP Server (\`foto_mcp\`) v${version}\n\n${bodyContent}${compareLink}\n`;
  const changelogEntry = `## [${version}] - ${dateStr}\n\n${bodyContent}\n`;

  return { releaseNotes, changelogEntry };
}

/**
 * Analyzes a set of commits, current version/tag, and optional PR labels to compute full release decision
 */
export function analyzeRelease(params: {
  currentVersion: string;
  commits: CommitEntry[];
  labels?: string[];
  forceBump?: SemverBumpType;
  dateStr?: string;
  repoUrl?: string;
}): ReleaseAnalysis {
  const cleanCurrent = params.currentVersion.trim().replace(/^v/i, "");
  parseSemver(cleanCurrent); // Validate format
  const currentTag = `v${cleanCurrent}`;
  const dateStr = params.dateStr || new Date().toISOString().slice(0, 10);

  const parsedCommits = params.commits.map(classifyCommit).filter((c) => c.type !== "release");

  let computedBump: SemverBumpType = "none";
  for (const c of parsedCommits) {
    computedBump = maxBump(computedBump, c.bump);
  }

  if (params.labels && params.labels.length > 0) {
    const labelDecision = resolveLabelBump(params.labels);
    if (labelDecision.forcedSkip) {
      computedBump = "none";
    } else {
      computedBump = maxBump(computedBump, labelDecision.bump);
    }
  }

  if (params.forceBump) {
    computedBump = params.forceBump;
  }

  const shouldRelease = computedBump !== "none";
  const nextVersion = incrementSemver(cleanCurrent, computedBump);
  const nextTag = `v${nextVersion}`;

  const { releaseNotes, changelogEntry } = formatReleaseMarkdown({
    version: nextVersion,
    previousTag: currentTag,
    dateStr,
    commits: parsedCommits,
    repoUrl: params.repoUrl
  });

  return {
    currentVersion: cleanCurrent,
    currentTag,
    bumpType: computedBump,
    shouldRelease,
    nextVersion,
    nextTag,
    commits: parsedCommits,
    releaseNotes,
    changelogEntry
  };
}

/**
 * Inserts a new version section cleanly at the top of CHANGELOG.md content
 */
export function prependChangelogEntry(existingChangelog: string, newEntry: string, version: string): string {
  if (existingChangelog.includes(`## [${version}]`)) {
    return existingChangelog;
  }

  const firstReleaseIdx = existingChangelog.search(/^## \[/m);
  if (firstReleaseIdx === -1) {
    return `${existingChangelog.trimEnd()}\n\n${newEntry.trim()}\n`;
  }

  const header = existingChangelog.slice(0, firstReleaseIdx);
  const rest = existingChangelog.slice(firstReleaseIdx);
  return `${header}${newEntry.trim()}\n\n${rest}`;
}

/**
 * Updates the version badge in README.md to match the new semantic version
 */
export function updateReadmeVersionBadge(readmeContent: string, newVersion: string): string {
  return readmeContent.replace(
    /(\[!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-)[0-9]+\.[0-9]+\.[0-9]+(-blue\.svg\)\]\(package\.json\))/,
    `$1${newVersion}$2`
  );
}
