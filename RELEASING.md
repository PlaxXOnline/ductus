# Releasing

Schritt-für-Schritt-Anleitung, um Ductus zu veröffentlichen. Die npm-Pakete
(`@ductus/schema`, `@ductus/core`, `@ductus/adapter-dart`) werden über
[Changesets](https://github.com/changesets/changesets) versioniert und via
GitHub Actions publiziert; das Dart-Paket `ductus` (in `dart/ductus`) geht
über einen Tag-getriggerten Workflow nach pub.dev.

## 1. npm-Organisation `ductus` anlegen

Der Scope `@ductus` setzt eine npm-Organisation namens `ductus` voraus:

1. Auf [npmjs.com](https://www.npmjs.com/) einloggen.
2. **Add Organization** → Name `ductus` → Free/Public reicht.
3. Falls der Name bereits als User oder Organisation belegt ist, zeigt npm
   das an dieser Stelle an — dann muss ein anderer Scope gewählt und in allen
   `package.json`-Dateien nachgezogen werden.

Hinweis: Das *unscoped* npm-Paket `ductus` ist ein Security-Holding-Package
von npm — das ist irrelevant, publiziert wird ausschließlich scoped.

## 2. `main` nach GitHub pushen

Das Repository existiert bereits — lokal (Branches `main` und `develop`) und
auf GitHub unter `https://github.com/PlaxXOnline/ductus`; die Repo-URL ist in
allen Manifests (`package.json`, `pubspec.yaml`) und READMEs eingetragen.

Auf `origin` liegt bisher allerdings nur `develop`. Der Release-Workflow
triggert auf Pushes nach `main` (dort ist auch der Changesets-`baseBranch`
konfiguriert), also vor dem ersten Workflow-Release `main` pushen:

```bash
git push -u origin main
```

## 3. Publishing konfigurieren: Trusted Publishing und Actions-Rechte

### 3a. npm Trusted Publishing (OIDC) einrichten

Der Workflow [.github/workflows/release.yml](.github/workflows/release.yml)
publiziert über [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers):
npm vertraut dem OIDC-Token von GitHub Actions direkt — es gibt **kein**
npm-Token, kein `NPM_TOKEN`-Secret und keine Token-Rotation.

Trusted Publisher werden in den **Paket**-Settings auf npmjs.com konfiguriert,
die Pakete müssen also zuerst existieren. Die Erstveröffentlichung läuft
deshalb **lokal**:

1. `npm login` — die interaktive 2FA/OTP-Abfrage ist hier völlig in Ordnung,
   ein Bypass ist nicht nötig.
2. Im Repo-Root: `npm run build && npx changeset publish` — publiziert alle
   drei Pakete in 0.1.0 (noch ohne Provenance; ab dem nächsten CI-Release
   automatisch mit).

Danach **je Paket** (`@ductus/schema`, `@ductus/core`, `@ductus/adapter-dart`)
auf npmjs.com: **Package Settings → Trusted Publisher → GitHub Actions** mit:

- **Organization or user**: `PlaxXOnline`
- **Repository**: `ductus`
- **Workflow filename**: `release.yml` (nur der Dateiname, kein Pfad)
- **Environment name**: leer lassen
- **Allowed actions**: *npm publish*

Alle Felder sind case-sensitiv und müssen exakt passen. Weitere Hinweise:

- Je Paket ist genau **ein** Trusted Publisher möglich; wird die
  Workflow-Datei umbenannt, muss die Konfiguration je Paket nachgezogen
  werden.
- Self-hosted Runner werden nicht unterstützt (nur GitHub-hosted).
- Trusted Publishing braucht npm CLI ≥ 11.5.1. Das von Node 24 gebündelte
  npm erfüllt das; ein Guard-Schritt im Workflow prüft die Version vor dem
  Publish. Bewusst **kein** `npm install -g npm@latest` im Workflow:
  npm 12.0.0 deklariert `sigstore` nicht mehr als Dependency, obwohl
  `libnpmpublish` es für Provenance lädt — ein Registry-Install entfernt das
  Modul und der Publish scheitert mit `MODULE_NOT_FOUND`
  ([npm/cli#9722](https://github.com/npm/cli/issues/9722)).
- Provenance wird beim Trusted Publishing automatisch erzeugt; ein
  `publishConfig.provenance` in den Paketen ist nicht nötig (und würde den
  lokalen Erstpublish brechen, weil Provenance unterstütztes CI/OIDC
  voraussetzt).

### 3b. GitHub Actions das Erstellen von Pull Requests erlauben

In **Settings → Actions → General → Workflow permissions** die Option
**„Allow GitHub Actions to create and approve pull requests“** aktivieren.
Bei Repos unter persönlichen Accounts (wie `PlaxXOnline`) ist sie per Default
**deaktiviert** — ohne sie bricht der Release-Workflow beim Anlegen des
„Version Packages“-PR mit *„GitHub Actions is not permitted to create or
approve pull requests“* ab (workflow-seitig ist `pull-requests: write`
bereits gesetzt). Die Erstveröffentlichung 0.1.0 läuft lokal (Schritt 3a)
und braucht die Option nicht — jedes Folge-Release über den Workflow schon.

## 4. Release-Ablauf npm (Changesets)

Die drei npm-Pakete sind in `.changeset/config.json` als `fixed` gruppiert —
sie tragen immer dieselbe Version.

Pro Änderung:

1. `npx changeset` — Pakete wählen, Bump-Typ (patch/minor/major) und
   Beschreibung angeben; die erzeugte `.changeset/*.md` mit committen.
2. PR mergen → der Release-Workflow legt automatisch den PR
   **„Version Packages"** an bzw. aktualisiert ihn (Versionen + CHANGELOGs).
3. Den „Version Packages"-PR mergen → der Workflow publiziert die Pakete
   automatisch nach npm (`npm run release`) und erzeugt GitHub-Releases/Tags.

**Erstveröffentlichung (0.1.0):** Läuft **lokal** (siehe Schritt 3a), nicht
über den ersten Workflow-Lauf — die Trusted-Publisher-Konfiguration setzt
existierende Pakete voraus. Ein Changeset ist nicht nötig: Alle Pakete stehen
bereits auf 0.1.0, `npx changeset publish` publiziert auf npm fehlende
Versionen direkt. Ab dann publiziert der Release-Workflow jedes Folge-Release
über OIDC.

## 5. Release-Ablauf pub.dev (Dart-Paket)

Die **erste** Veröffentlichung muss manuell erfolgen — automated publishing
lässt sich erst danach im Admin-Tab des Pakets aktivieren:

```bash
cd dart/ductus
dart pub publish        # erst --dry-run, dann echt
```

Danach auf pub.dev automated publishing einrichten:

1. Auf der Paketseite von `ductus` → **Admin** →
   **Enable publishing from GitHub Actions**.
2. Repository: `PlaxXOnline/ductus`.
3. Tag-Pattern: `dart-v{{version}}` (das Paket liegt im Unterordner
   `dart/ductus`, daher das Präfix statt des Standard-Musters `v{{version}}`).

Ab dann läuft jedes weitere Release über
[.github/workflows/publish-dart.yml](.github/workflows/publish-dart.yml):

1. `version` in `dart/ductus/pubspec.yaml` bumpen, die Konstante
   `adapterVersion` in `dart/ductus/lib/src/adapter/graph_model.dart`
   nachziehen (muss identisch sein — ein Regressionstest in
   `test/cli_integration_test.dart` prüft das) und
   `dart/ductus/CHANGELOG.md` ergänzen; mergen.
2. Tag pushen — die Version im Tag muss exakt der `pubspec.yaml` entsprechen:

   ```bash
   git tag dart-v0.2.0
   git push origin dart-v0.2.0
   ```

3. Der Workflow testet das Paket und publiziert per OIDC nach pub.dev
   (kein Secret nötig).

## 6. Späterer Umzug in eine GitHub-Organisation

Ein Umzug des Repos zu einer GitHub-Org ist später problemlos möglich —
GitHub richtet Redirects von der alten URL ein. Danach die Repo-URLs in den
Manifests (`package.json` × 3, `pubspec.yaml`) und READMEs nachziehen und mit
dem nächsten regulären Release veröffentlichen.
