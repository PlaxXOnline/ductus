/**
 * Weg C — Ableitung aus Next.js-Projekten (dateibasiertes Routing).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveNext } from '../src/derive/next.js';
import { scanSource, WarnLog } from './test-util.js';

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

const PAGE = 'export default function Page() {\n  return null;\n}\n';

describe('deriveNext — App-Router-Screens', () => {
  it('app/page.tsx wird zum Screen root mit Pfad /', () => {
    const result = deriveNext([scanSource(PAGE, 'app/page.tsx')], new WarnLog().call);

    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.id).toBe('root');
    expect(node.type).toBe('screen');
    expect(node.title).toBe('Root');
    expect(node.source).toBe('derived');
    expect(node.sourceRef.file).toBe('app/page.tsx');
    expect(result.pathToScreen.get('/')).toBe('root');
  });

  it('verschachtelte Segmente werden zum Bindestrich-Slug', () => {
    const result = deriveNext(
      [scanSource(PAGE, 'app/dashboard/settings/page.tsx')],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['dashboard-settings']);
    expect(result.nodes[0]!.title).toBe('Dashboard settings');
    expect(result.pathToScreen.get('/dashboard/settings')).toBe('dashboard-settings');
  });

  it('Param-Segmente entfallen in der Id, bleiben aber im Pfad-Schlüssel', () => {
    const result = deriveNext([scanSource(PAGE, 'app/users/[id]/page.tsx')], new WarnLog().call);

    expect(result.nodes.map((n) => n.id)).toEqual(['users']);
    expect(result.pathToScreen.get('/users/[id]')).toBe('users');
  });

  it('Routen-Gruppe (name) wird zum Flow mit dem ersten Screen als Start', () => {
    const result = deriveNext(
      [
        scanSource(PAGE, 'app/(onboarding)/welcome/page.tsx'),
        scanSource(PAGE, 'app/(onboarding)/zusammenfassung/page.tsx'),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => ({ id: n.id, flow: n.flow }))).toEqual([
      { id: 'welcome', flow: 'onboarding' },
      { id: 'zusammenfassung', flow: 'onboarding' },
    ]);
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]).toMatchObject({ id: 'onboarding', title: 'Onboarding', start: 'welcome' });
  });

  it('@slot-, (.)-Intercepting- und _private-Segmente werden übersprungen', () => {
    const result = deriveNext(
      [
        scanSource(PAGE, 'app/@modal/photo/page.tsx'),
        scanSource(PAGE, 'app/feed/(.)photo/page.tsx'),
        scanSource(PAGE, 'app/_private/tools/page.tsx'),
      ],
      new WarnLog().call,
    );

    expect(result.hasRoutes).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.flows).toEqual([]);
  });

  it('src/app-Präfix funktioniert ebenfalls', () => {
    const result = deriveNext([scanSource(PAGE, 'src/app/settings/page.tsx')], new WarnLog().call);

    expect(result.nodes.map((n) => n.id)).toEqual(['settings']);
    expect(result.pathToScreen.get('/settings')).toBe('settings');
  });
});

describe('deriveNext — Pages-Router-Screens', () => {
  it('pages-Dateien werden zu Screens; api/ und _app entfallen (mit Next-Evidenz via Import)', () => {
    // Next-Evidenz: mindestens eine Datei importiert aus next/… .
    const NEXT_PAGE = "import Link from 'next/link';\n" + PAGE;
    const result = deriveNext(
      [
        scanSource(NEXT_PAGE, 'pages/_app.tsx'),
        scanSource(NEXT_PAGE, 'pages/about.tsx'),
        scanSource(NEXT_PAGE, 'pages/api/users.ts'),
        scanSource(NEXT_PAGE, 'pages/blog/index.tsx'),
        scanSource(NEXT_PAGE, 'pages/index.tsx'),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['about', 'blog', 'root']);
    expect(result.pathToScreen.get('/about')).toBe('about');
    expect(result.pathToScreen.get('/blog')).toBe('blog');
    expect(result.pathToScreen.get('/')).toBe('root');
  });

  it('ohne Next-Evidenz entstehen KEINE Pages-Router-Screens (src/pages/ in react-router-Projekten)', () => {
    // Kein next-Import, keine package.json/next.config.* — die verbreitete
    // src/pages/-Konvention darf keine Phantom-Screens erzeugen.
    const result = deriveNext(
      [scanSource(PAGE, 'src/pages/Home.tsx'), scanSource(PAGE, 'pages/about.tsx')],
      new WarnLog().call,
    );

    expect(result.nodes).toEqual([]);
    expect(result.hasRoutes).toBe(false);
    expect(result.componentToScreen.size).toBe(0);
  });

  it('package.json mit next-Dependency im projectDir zählt als Next-Evidenz', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-next-evidence-'));
    tmpRoots.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^15.0.0' } }), 'utf8');

    const result = deriveNext([scanSource(PAGE, 'pages/about.tsx')], new WarnLog().call, {
      projectDir: dir,
    });

    expect(result.nodes.map((n) => n.id)).toEqual(['about']);
  });

  it('App-Router-Screens brauchen keine Evidenz (Konvention ist eindeutig)', () => {
    const result = deriveNext([scanSource(PAGE, 'app/dashboard/page.tsx')], new WarnLog().call);
    expect(result.nodes.map((n) => n.id)).toEqual(['dashboard']);
  });
});

describe('deriveNext — Default-Export-Zuordnung', () => {
  it('erkennt export default function, export default X und export default memo(X)', () => {
    const result = deriveNext(
      [
        scanSource('export default function APage() {\n  return null;\n}\n', 'app/a/page.tsx'),
        scanSource('function BPage() {\n  return null;\n}\nexport default BPage;\n', 'app/b/page.tsx'),
        scanSource('const CPage = () => null;\nexport default memo(CPage);\n', 'app/c/page.tsx'),
      ],
      new WarnLog().call,
    );

    expect(result.componentToScreen.get('APage')).toBe('a');
    expect(result.componentToScreen.get('BPage')).toBe('b');
    expect(result.componentToScreen.get('CPage')).toBe('c');
  });
});

describe('deriveNext — Navigation', () => {
  it('<Link href> erzeugt eine tap-Kante mit Label', () => {
    const warn = new WarnLog();
    const result = deriveNext(
      [
        scanSource(
          'export default function AboutPage() {\n  return <Link href="/">Zur Startseite</Link>;\n}\n',
          'app/about/page.tsx',
        ),
        scanSource(PAGE, 'app/page.tsx'),
      ],
      warn.call,
    );

    expect(warn.messages).toEqual([]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      from: 'about',
      to: 'root',
      trigger: 'tap',
      label: 'Zur Startseite',
      source: 'derived',
    });
  });

  it("router.push('/pfad') wird nur erfasst, wenn die Datei useRouter erwähnt", () => {
    const withHook = deriveNext(
      [
        scanSource(
          [
            'export default function SettingsPage() {',
            '  const router = useRouter();',
            "  return <button onClick={() => router.push('/')}>Home</button>;",
            '}',
            '',
          ].join('\n'),
          'app/settings/page.tsx',
        ),
        scanSource(PAGE, 'app/page.tsx'),
      ],
      new WarnLog().call,
    );
    expect(withHook.edges).toHaveLength(1);
    expect(withHook.edges[0]).toMatchObject({ from: 'settings', to: 'root', trigger: 'tap' });

    const withoutHook = deriveNext(
      [
        scanSource(
          [
            'export default function SettingsPage({ router }) {',
            "  return <button onClick={() => router.push('/')}>Home</button>;",
            '}',
            '',
          ].join('\n'),
          'app/settings/page.tsx',
        ),
        scanSource(PAGE, 'app/page.tsx'),
      ],
      new WarnLog().call,
    );
    expect(withoutHook.edges).toEqual([]);
  });

  it('from fällt auf die page-Datei zurück, wenn die umschließende Komponente unbekannt ist', () => {
    const result = deriveNext(
      [
        scanSource(
          [
            'function Nav() {',
            '  return <Link href="/">Start</Link>;',
            '}',
            '',
            'export default function ContactPage() {',
            '  return <Nav />;',
            '}',
            '',
          ].join('\n'),
          'app/contact/page.tsx',
        ),
        scanSource(PAGE, 'app/page.tsx'),
      ],
      new WarnLog().call,
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: 'contact', to: 'root', label: 'Start' });
  });
});

describe('deriveNext — redirect-Decisions', () => {
  it('redirect in einer page-Datei mit next/navigation-Import erzeugt eine Decision', () => {
    const result = deriveNext(
      [
        scanSource(
          [
            "import { redirect } from 'next/navigation';",
            '',
            'export default function DashboardPage() {',
            '  if (!isAuthenticated()) {',
            "    redirect('/login');",
            '  }',
            '  return null;',
            '}',
            '',
          ].join('\n'),
          'app/dashboard/page.tsx',
        ),
        scanSource(PAGE, 'app/login/page.tsx'),
      ],
      new WarnLog().call,
    );

    const decision = result.nodes.find((n) => n.id === 'dashboard_redirect');
    expect(decision).toBeDefined();
    expect(decision?.type).toBe('decision');
    expect(decision?.title).toBe('Weiterleitung: Dashboard');
    expect(
      result.edges.map((e) => ({ from: e.from, to: e.to, trigger: e.trigger, condition: e.condition })),
    ).toEqual([
      { from: 'dashboard_redirect', to: 'dashboard', trigger: 'auto', condition: undefined },
      { from: 'dashboard_redirect', to: 'login', trigger: 'auto', condition: 'redirect' },
    ]);
  });

  it('redirect ohne next/navigation-Import erzeugt keine Decision', () => {
    const result = deriveNext(
      [
        scanSource(
          [
            'export default function DashboardPage() {',
            "  if (!isAuthenticated()) redirect('/login');",
            '  return null;',
            '}',
            '',
          ].join('\n'),
          'app/dashboard/page.tsx',
        ),
        scanSource(PAGE, 'app/login/page.tsx'),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['dashboard', 'login']);
    expect(result.edges).toEqual([]);
  });
});
