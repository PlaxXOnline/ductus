# Releasing

Step-by-step guide to publishing Ductus. The npm packages
(`@ductus/schema`, `@ductus/core`, `@ductus/adapter-dart`,
`@ductus/adapter-typescript`) are versioned via
[Changesets](https://github.com/changesets/changesets) and published through
GitHub Actions; the Dart package `ductus` (in `dart/ductus`) goes to pub.dev
via a tag-triggered workflow.

## 1. Create the npm organization `ductus`

The scope `@ductus` requires an npm organization named `ductus`:

1. Log in on [npmjs.com](https://www.npmjs.com/).
2. **Add Organization** → name `ductus` → Free/Public is sufficient.
3. If the name is already taken by a user or organization, npm shows that
   right there — in that case a different scope must be chosen and updated
   in all `package.json` files.

Note: the *unscoped* npm package `ductus` is a security holding package
owned by npm — that is irrelevant; publishing happens exclusively scoped.

## 2. Push `main` to GitHub

The repository already exists — locally (branches `main` and `develop`) and
on GitHub at `https://github.com/PlaxXOnline/ductus`; the repo URL is set in
all manifests (`package.json`, `pubspec.yaml`) and READMEs.

So far, however, only `develop` exists on `origin`. The release workflow
triggers on pushes to `main` (the Changesets `baseBranch` is configured
there as well), so push `main` before the first workflow release:

```bash
git push -u origin main
```

## 3. Configure publishing: trusted publishing and Actions permissions

### 3a. Set up npm trusted publishing (OIDC)

The workflow [.github/workflows/release.yml](.github/workflows/release.yml)
publishes via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers):
npm trusts the OIDC token from GitHub Actions directly — there is **no**
npm token, no `NPM_TOKEN` secret and no token rotation.

Trusted publishers are configured in the **package** settings on npmjs.com,
so the packages have to exist first. The initial publish therefore happens
**locally**:

1. `npm login` — the interactive 2FA/OTP prompt is perfectly fine here,
   no bypass is needed.
2. In the repo root: `npm run build && npx changeset publish` — publishes
   all npm packages in their initial version (without provenance for now;
   automatically with provenance from the next CI release on).

The same applies to every package **added later** (as happened with
`@ductus/adapter-typescript`): initial publish locally, then configure the
trusted publisher for the new package.

Then, **per package** (`@ductus/schema`, `@ductus/core`, `@ductus/adapter-dart`,
`@ductus/adapter-typescript`) on npmjs.com:
**Package Settings → Trusted Publisher → GitHub Actions** with:

- **Organization or user**: `PlaxXOnline`
- **Repository**: `ductus`
- **Workflow filename**: `release.yml` (just the file name, no path)
- **Environment name**: leave empty
- **Allowed actions**: *npm publish*

All fields are case-sensitive and must match exactly. Further notes:

- Exactly **one** trusted publisher is possible per package; if the workflow
  file is renamed, the configuration must be updated for each package.
- Self-hosted runners are not supported (GitHub-hosted only).
- Trusted publishing requires npm CLI ≥ 11.5.1. The npm bundled with Node 24
  satisfies this; a guard step in the workflow checks the version before
  publishing. Deliberately **no** `npm install -g npm@latest` in the
  workflow: npm 12.0.0 no longer declares `sigstore` as a dependency even
  though `libnpmpublish` loads it for provenance — a registry install
  removes the module and the publish fails with `MODULE_NOT_FOUND`
  ([npm/cli#9722](https://github.com/npm/cli/issues/9722)).
- Provenance is generated automatically with trusted publishing; a
  `publishConfig.provenance` in the packages is not needed (and would break
  the local initial publish, because provenance requires supported
  CI/OIDC).

### 3b. Allow GitHub Actions to create pull requests

In **Settings → Actions → General → Workflow permissions**, enable
**“Allow GitHub Actions to create and approve pull requests”**.
For repos under personal accounts (like `PlaxXOnline`) it is **disabled** by
default — without it the release workflow aborts when creating the
“Version Packages” PR with *“GitHub Actions is not permitted to create or
approve pull requests”* (`pull-requests: write` is already set on the
workflow side). The initial 0.1.0 publish happens locally (step 3a) and
does not need the option — every subsequent release through the workflow
does.

## 4. npm release flow (Changesets)

The npm packages are grouped as `fixed` in `.changeset/config.json` —
they always carry the same version.

Per change:

1. `npx changeset` — select the packages, choose the bump type
   (patch/minor/major) and enter a description; commit the generated
   `.changeset/*.md` along with the change.
2. Merge the PR → the release workflow automatically creates or updates the
   **“Version Packages”** PR (versions + CHANGELOGs).
3. Merge the “Version Packages” PR → the workflow publishes the packages to
   npm automatically (`npm run release`) and pushes the tags. GitHub
   releases are then created by `scripts/create-github-releases.mjs` — with
   the changelog entry as release notes and **only for packages with real
   changes**: the fixed grouping bumps all packages on every release, but
   packages whose changelog entry is empty or contains only dependency
   bumps do not get a release (they do get a tag).

### Changelog maintenance is enforced

The packages' `CHANGELOG.md` files are **never written by hand** — they are
generated entirely from the changesets when the version PR is created. To
make sure nothing gets lost, the CI job **`changeset-check`** verifies on
every push/PR (except on `main` and the bot version PRs) via
`npx changeset status --since=origin/main` that a changeset exists for all
packages changed since the last release — if one is missing, CI is red.

The resulting working rule: **every change under `packages/*` gets its
changeset in the same commit/PR** (including internal restructurings or
docs — then simply as a `patch` with a one-liner). Changes outside the
packages (repo docs, examples, CI) do not need one.

For the Dart package (no Changesets support) the analogue is the CI job
**`dart-changelog-check`**: changes under `dart/ductus/` must update
`dart/ductus/CHANGELOG.md` in the same diff — the entry is written there
manually (section 5); the gate only ensures that it is never missing.

**Initial publish (0.1.0):** happens **locally** (see step 3a), not through
the first workflow run — the trusted publisher configuration requires
existing packages. No changeset is needed: all packages are already at
0.1.0, and `npx changeset publish` publishes versions missing on npm
directly. From then on, the release workflow publishes every subsequent
release via OIDC.

## 5. pub.dev release flow (Dart package)

The **first** publish has to happen manually — automated publishing can
only be enabled in the package's Admin tab afterwards:

```bash
cd dart/ductus
dart pub publish        # first --dry-run, then for real
```

Then set up automated publishing on pub.dev:

1. On the package page of `ductus` → **Admin** →
   **Enable publishing from GitHub Actions**.
2. Repository: `PlaxXOnline/ductus`.
3. Tag pattern: `dart-v{{version}}` (the package lives in the subfolder
   `dart/ductus`, hence the prefix instead of the default pattern
   `v{{version}}`).

From then on, every further release runs through
[.github/workflows/publish-dart.yml](.github/workflows/publish-dart.yml):

1. Bump `version` in `dart/ductus/pubspec.yaml`, update the constant
   `adapterVersion` in `dart/ductus/lib/src/adapter/graph_model.dart` to
   match (they must be identical — a regression test in
   `test/cli_integration_test.dart` checks this) and add an entry to
   `dart/ductus/CHANGELOG.md`; merge.
2. Push the tag — the version in the tag must match the `pubspec.yaml`
   exactly:

   ```bash
   git tag dart-v0.2.0
   git push origin dart-v0.2.0
   ```

3. The workflow tests the package and publishes to pub.dev via OIDC
   (no secret needed).

## 6. Moving to a GitHub organization later

Moving the repo to a GitHub org later is straightforward — GitHub sets up
redirects from the old URL. Afterwards, update the repo URLs in the
manifests (`package.json` × 4, `pubspec.yaml`) and READMEs and ship them
with the next regular release.
