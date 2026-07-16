/**
 * Path C — derivation from Next.js projects (file-based routing).
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

describe('deriveNext — App Router screens', () => {
  it('app/page.tsx becomes the screen root with path /', () => {
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

  it('nested segments become a hyphenated slug', () => {
    const result = deriveNext(
      [scanSource(PAGE, 'app/dashboard/settings/page.tsx')],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['dashboard-settings']);
    expect(result.nodes[0]!.title).toBe('Dashboard settings');
    expect(result.pathToScreen.get('/dashboard/settings')).toBe('dashboard-settings');
  });

  it('param segments are dropped from the id but kept in the path key', () => {
    const result = deriveNext([scanSource(PAGE, 'app/users/[id]/page.tsx')], new WarnLog().call);

    expect(result.nodes.map((n) => n.id)).toEqual(['users']);
    expect(result.pathToScreen.get('/users/[id]')).toBe('users');
  });

  it('route group (name) becomes a flow with the first screen as start', () => {
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

  it('@slot, (.) intercepting, and _private segments are skipped', () => {
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

  it('the src/app prefix works as well', () => {
    const result = deriveNext([scanSource(PAGE, 'src/app/settings/page.tsx')], new WarnLog().call);

    expect(result.nodes.map((n) => n.id)).toEqual(['settings']);
    expect(result.pathToScreen.get('/settings')).toBe('settings');
  });
});

describe('deriveNext — Pages Router screens', () => {
  it('pages files become screens; api/ and _app are dropped (with Next evidence via import)', () => {
    // Next evidence: at least one file imports from next/… .
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

  it('without Next evidence, NO Pages Router screens are created (src/pages/ in react-router projects)', () => {
    // No next import, no package.json/next.config.* — the common src/pages/
    // convention must not create phantom screens.
    const result = deriveNext(
      [scanSource(PAGE, 'src/pages/Home.tsx'), scanSource(PAGE, 'pages/about.tsx')],
      new WarnLog().call,
    );

    expect(result.nodes).toEqual([]);
    expect(result.hasRoutes).toBe(false);
    expect(result.componentToScreen.size).toBe(0);
  });

  it('a package.json with a next dependency in projectDir counts as Next evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-next-evidence-'));
    tmpRoots.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^15.0.0' } }), 'utf8');

    const result = deriveNext([scanSource(PAGE, 'pages/about.tsx')], new WarnLog().call, {
      projectDir: dir,
    });

    expect(result.nodes.map((n) => n.id)).toEqual(['about']);
  });

  it('App Router screens need no evidence (the convention is unambiguous)', () => {
    const result = deriveNext([scanSource(PAGE, 'app/dashboard/page.tsx')], new WarnLog().call);
    expect(result.nodes.map((n) => n.id)).toEqual(['dashboard']);
  });
});

describe('deriveNext — default-export mapping', () => {
  it('recognizes export default function, export default X, and export default memo(X)', () => {
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

describe('deriveNext — navigation', () => {
  it('<Link href> creates a tap edge with a label', () => {
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

  it("router.push('/path') is only captured when the file mentions useRouter", () => {
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

  it('from falls back to the page file when the enclosing component is unknown', () => {
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

describe('deriveNext — redirect decisions', () => {
  it('redirect in a page file with a next/navigation import creates a decision', () => {
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
    expect(decision?.title).toBe('Redirect: Dashboard');
    expect(
      result.edges.map((e) => ({ from: e.from, to: e.to, trigger: e.trigger, condition: e.condition })),
    ).toEqual([
      { from: 'dashboard_redirect', to: 'dashboard', trigger: 'auto', condition: undefined },
      { from: 'dashboard_redirect', to: 'login', trigger: 'auto', condition: 'redirect' },
    ]);
  });

  it('redirect without a next/navigation import creates no decision', () => {
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
