// Erstellt nach `changeset publish` GitHub-Releases — aber nur für Pakete,
// deren Changelog-Eintrag echte Änderungen enthält. Durch die fixed-Gruppierung
// werden bei jedem Release alle Pakete gebumpt und getaggt; Pakete ohne eigene
// Changesets hätten sonst leere Releases (bzw. reine Dependency-Bump-Einträge).
//
// Aufruf im Release-Workflow mit:
//   PUBLISHED_PACKAGES  JSON-Array [{name, version}] aus dem
//                       changesets/action-Output `publishedPackages`
//   GH_TOKEN            Token für die gh-CLI

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const published = JSON.parse(process.env.PUBLISHED_PACKAGES ?? "[]");
if (published.length === 0) {
  console.log("Keine publizierten Pakete — nichts zu tun.");
  process.exit(0);
}

// Paketname → Verzeichnis unter packages/
const packageDirs = new Map();
for (const dir of readdirSync("packages")) {
  const manifest = join("packages", dir, "package.json");
  if (!existsSync(manifest)) continue;
  packageDirs.set(JSON.parse(readFileSync(manifest, "utf8")).name, join("packages", dir));
}

// Abschnitt "## <version>" aus dem CHANGELOG herausschneiden.
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

// Echte Änderung = mindestens eine Zeile, die weder Überschrift noch
// Dependency-Bump ist. Changesets rendert Dependency-Bumps als
// "- Updated dependencies [..]:" plus eingerückte "- @scope/pkg@x.y.z"-Zeilen;
// ohne Commit-Links auch als bloße "- @scope/pkg@x.y.z"-Zeile.
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
    console.warn(`WARN: kein Paketverzeichnis für ${name} gefunden — übersprungen.`);
    continue;
  }
  const entry = changelogEntry(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), version);
  if (entry === null) {
    console.warn(`WARN: kein CHANGELOG-Abschnitt ${version} in ${dir} — übersprungen.`);
    continue;
  }
  if (!hasRealChanges(entry)) {
    console.log(`Überspringe ${tag}: keine eigenen Änderungen (nur Version-/Dependency-Bump).`);
    continue;
  }
  if (releaseExists(tag)) {
    console.log(`Release ${tag} existiert bereits — übersprungen.`);
    continue;
  }
  execFileSync(
    "gh",
    ["release", "create", tag, "--verify-tag", "--title", tag, "--notes", entry],
    { stdio: "inherit" },
  );
  console.log(`Release ${tag} erstellt.`);
}
