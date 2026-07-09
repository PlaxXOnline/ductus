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

## 2. GitHub-Repository anlegen und pushen

Das Arbeitsverzeichnis ist noch **kein** Git-Repository — `gh repo create
--source . --push` setzt ein initialisiertes Repo mit mindestens einem Commit
voraus. Also zuerst initialisieren (Branch `main`, weil Release-Workflow und
Changesets-`baseBranch` darauf konfiguriert sind):

```bash
git init -b main
git add -A
git commit -m "Initial commit"
gh repo create PlaxXOnline/ductus --public --source . --push
```

Die Repo-URL `https://github.com/PlaxXOnline/ductus` ist bereits in allen
Manifests (`package.json`, `pubspec.yaml`) und READMEs eingetragen.

## 3. GitHub-Repo konfigurieren: `NPM_TOKEN` und Actions-Rechte

### 3a. `NPM_TOKEN` als Actions-Secret hinterlegen

1. Auf npmjs.com ein **Granular Access Token** erzeugen (Access Tokens →
   Generate New Token; die klassischen „Automation“-Tokens wurden im November
   2025 entfernt, es gibt nur noch Granular Access Tokens). Einstellungen:
   - **Packages and scopes**: *Read and write*, beschränkt auf den Scope
     `@ductus`.
   - **Bypass 2FA** aktivieren — sonst scheitert der unbeaufsichtigte Publish
     aus GitHub Actions an der 2FA-Abfrage (die Option hat Vorrang vor
     Account- und Paket-2FA-Einstellungen).
   - Granular Tokens haben ein **Pflicht-Ablaufdatum**: Das Secret muss
     periodisch rotiert werden — Ablaufdatum notieren und rechtzeitig ein
     neues Token hinterlegen. Alternative ohne Rotation: npm
     **Trusted Publishing** (OIDC direkt aus GitHub Actions, je Paket auf
     npmjs.com konfigurierbar) — dann entfällt `NPM_TOKEN` komplett.
2. Im GitHub-Repo unter **Settings → Secrets and variables → Actions** als
   Secret `NPM_TOKEN` anlegen.

Der Workflow [.github/workflows/release.yml](.github/workflows/release.yml)
nutzt das Token als `NODE_AUTH_TOKEN`; die Provenance-Attestierung ist über
`publishConfig.provenance` in den Paketen aktiviert (braucht keinen weiteren
Schlüssel, nur die `id-token: write`-Permission des Workflows).

### 3b. GitHub Actions das Erstellen von Pull Requests erlauben

In **Settings → Actions → General → Workflow permissions** die Option
**„Allow GitHub Actions to create and approve pull requests“** aktivieren.
Bei Repos unter persönlichen Accounts (wie `PlaxXOnline`) ist sie per Default
**deaktiviert** — ohne sie bricht der Release-Workflow beim Anlegen des
„Version Packages“-PR mit *„GitHub Actions is not permitted to create or
approve pull requests“* ab (workflow-seitig ist `pull-requests: write`
bereits gesetzt). Die Erstveröffentlichung 0.1.0 (direkter Publish ohne
Version-PR) funktioniert auch ohne die Option, jedes Folge-Release nicht.

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

**Erstveröffentlichung (0.1.0):** Es ist *kein* Changeset nötig. Alle Pakete
stehen bereits auf 0.1.0 und sind unveröffentlicht — `changeset publish`
publiziert auf npm fehlende Versionen direkt. Es reicht also, nach Schritt 1–3
auf `main` zu pushen; der Release-Workflow publiziert 0.1.0 beim ersten Lauf
ohne Version-PR.

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
