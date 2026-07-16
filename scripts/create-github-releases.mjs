// Creates GitHub releases after `changeset publish` — but only for packages
// whose changelog entry contains real changes. Because of the fixed grouping,
// every release bumps and tags all packages; packages without their own
// changesets would otherwise get empty releases (or pure dependency-bump entries).
//
// Invoked in the release workflow with:
//   PUBLISHED_PACKAGES  JSON array [{name, version}] from the
//                       changesets/action output `publishedPackages`
//   GH_TOKEN            token for the gh CLI

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const published = JSON.parse(process.env.PUBLISHED_PACKAGES ?? "[]");
if (published.length === 0) {
  console.log("No published packages — nothing to do.");
  process.exit(0);
}

// Package name → directory under packages/
const packageDirs = new Map();
for (const dir of readdirSync("packages")) {
  const manifest = join("packages", dir, "package.json");
  if (!existsSync(manifest)) continue;
  packageDirs.set(JSON.parse(readFileSync(manifest, "utf8")).name, join("packages", dir));
}

// Cut the "## <version>" section out of the CHANGELOG.
function changelogEntry(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

// A real change = at least one line that is neither a heading nor a
// dependency bump. Changesets renders dependency bumps as
// "- Updated dependencies [..]:" plus indented "- @scope/pkg@x.y.z" lines;
// without commit links also as a bare "- @scope/pkg@x.y.z" line.
function hasRealChanges(entry) {
  return entry.split("\n").some((line) => {
    const l = line.trim();
    if (l === "" || l.startsWith("#")) return false;
    if (/^-?\s*Updated dependencies/i.test(l)) return false;
    if (/^-?\s*@[\w.-]+\/[\w.-]+@\d+\.\d+\.\d+(-[\w.-]+)?$/.test(l)) return false;
    return true;
  });
}

function releaseExists(tag) {
  try {
    execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

for (const { name, version } of published) {
  const tag = `${name}@${version}`;
  const dir = packageDirs.get(name);
  if (!dir) {
    console.warn(`WARN: no package directory found for ${name} — skipped.`);
    continue;
  }
  const entry = changelogEntry(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), version);
  if (entry === null) {
    console.warn(`WARN: no CHANGELOG section ${version} in ${dir} — skipped.`);
    continue;
  }
  if (!hasRealChanges(entry)) {
    console.log(`Skipping ${tag}: no own changes (version/dependency bump only).`);
    continue;
  }
  if (releaseExists(tag)) {
    console.log(`Release ${tag} already exists — skipped.`);
    continue;
  }
  execFileSync(
    "gh",
    ["release", "create", tag, "--verify-tag", "--title", tag, "--notes", entry],
    { stdio: "inherit" },
  );
  console.log(`Release ${tag} created.`);
}
