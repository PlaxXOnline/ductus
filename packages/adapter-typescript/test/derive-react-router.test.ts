/**
 * Weg C — Ableitung aus react-router-Konfigurationen. Architektur-Spiegel
 * von dart/ductus/test/derive_go_router_test.dart.
 */

import { describe, expect, it } from 'vitest';
import { deriveReactRouter } from '../src/derive/react-router.js';
import { scanSource, WarnLog } from './test-util.js';

describe('deriveReactRouter — Screens aus Routen', () => {
  it('leitet Screens aus createBrowserRouter-Objektrouten ab (Pfad-Slug, humanize)', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/users/:id/edit', element: <UserEdit /> },
]);
`),
      ],
      warn.call,
    );

    expect(warn.messages).toEqual([]);
    expect(result.nodes.map((n) => n.id)).toEqual(['root', 'users-edit']);
    const usersEdit = result.nodes[1]!;
    expect(usersEdit.type).toBe('screen');
    expect(usersEdit.title).toBe('Users edit'); // Param-Segment entfällt, humanize
    expect(usersEdit.source).toBe('derived');
    expect(usersEdit.sourceRef.file).toBe('src/test.tsx');
    expect(result.pathToScreen.get('/')).toBe('root');
    expect(result.pathToScreen.get('/users/:id/edit')).toBe('users-edit');
    expect(result.componentToScreen.get('Home')).toBe('root');
    expect(result.componentToScreen.get('UserEdit')).toBe('users-edit');
  });

  it('gleiche relative Segmente unter verschiedenen Eltern kollabieren nicht', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  {
    path: '/user',
    element: <UserLayout />,
    children: [{ path: 'detail', element: <UserDetail /> }],
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [{ path: 'detail', element: <AdminDetail /> }],
  },
]);
`),
      ],
      new WarnLog().call,
    );

    // Id aus dem absolut gejointen Vollpfad — nicht aus dem relativen Segment.
    expect(result.nodes.map((n) => n.id)).toEqual(['user', 'user-detail', 'admin', 'admin-detail']);
    expect(result.pathToScreen.get('/user/detail')).toBe('user-detail');
    expect(result.pathToScreen.get('/admin/detail')).toBe('admin-detail');
  });

  it('route.id gewinnt über den Pfad-Slug', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/settings/profile', id: 'prefs', element: <Settings /> },
]);
`),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['prefs']);
    expect(result.nodes[0]!.title).toBe('Prefs');
    expect(result.pathToScreen.get('/settings/profile')).toBe('prefs');
  });

  it('Route ohne literalen path wird mit Warnung übersprungen', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: loginPath, element: <Login /> },
]);
`),
      ],
      warn.call,
    );

    expect(result.nodes).toEqual([]);
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('übersprungen');
  });
});

describe('deriveReactRouter — Flows (pfadlose Layout-Routen)', () => {
  it('pfadlose Layout-Route mit Kindern wird zum Flow shell-0 mit Start am ersten Kind-Screen', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/home', element: <HomeScreen /> },
      { path: '/profile', element: <ProfileScreen /> },
    ],
  },
]);
`),
      ],
      warn.call,
    );

    expect(warn.messages).toEqual([]);
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]).toMatchObject({ id: 'shell-0', title: 'Shell 0', start: 'home' });
    expect(result.nodes.map((n) => ({ id: n.id, flow: n.flow }))).toEqual([
      { id: 'home', flow: 'shell-0' },
      { id: 'profile', flow: 'shell-0' },
    ]);
  });

  it('Layout-Route ohne Kind-Screens: Warnung, Flow entfällt', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { element: <Shell />, children: [{ element: <Widget /> }] },
]);
`),
      ],
      warn.call,
    );

    expect(result.flows).toEqual([]);
    expect(warn.messages.some((m) => m.includes('Flow "shell-0" entfällt'))).toBe(true);
  });
});

describe('deriveReactRouter — loader/redirect', () => {
  it('loader mit redirect erzeugt Decision-Node und auto-Kanten', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/dashboard',
    element: <Dashboard />,
    loader: () => {
      if (!isLoggedIn) {
        return redirect('/login');
      }
      return null;
    },
  },
]);
`),
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

  it('loader ohne redirect-Aufruf erzeugt keine Decision', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/dashboard', element: <Dashboard />, loader: async () => fetchUser() },
]);
`),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['dashboard']);
    expect(result.edges).toEqual([]);
  });
});

describe('deriveReactRouter — <Route>-JSX', () => {
  it('verarbeitet <Route>-JSX in createRoutesFromElements inkl. index-Route', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const routes = createRoutesFromElements(
  <Route element={<Layout />}>
    <Route index element={<Home />} />
    <Route path="about" element={<About />} />
  </Route>,
);
`),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id)).toEqual(['root', 'about']);
    // Layout-Route ohne Pfad ⇒ Flow, index-Route ist der Start.
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]).toMatchObject({ id: 'shell-0', start: 'root' });
    expect(result.nodes.every((n) => n.flow === 'shell-0')).toBe(true);
    expect(result.pathToScreen.get('/')).toBe('root');
    expect(result.pathToScreen.get('/about')).toBe('about');
    expect(result.componentToScreen.get('Home')).toBe('root');
    expect(result.componentToScreen.get('About')).toBe('about');
  });

  it('element-Wrapper wie <Suspense> bevorzugen das Kind für die Zuordnung', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    ),
  },
]);
`),
      ],
      new WarnLog().call,
    );

    expect(result.componentToScreen.get('LoginPage')).toBe('login');
    expect(result.componentToScreen.has('Suspense')).toBe(false);
  });
});

describe('deriveReactRouter — Navigation', () => {
  it('<Link to> erzeugt eine tap-Kante mit Label von der umschließenden Komponente', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/dashboard', element: <DashboardPage /> },
]);

function LoginPage() {
  return <Link to="/dashboard">Weiter zum Dashboard</Link>;
}
`),
      ],
      warn.call,
    );

    expect(warn.messages).toEqual([]);
    expect(result.edges).toHaveLength(1);
    const link = result.edges[0]!;
    expect(link.from).toBe('login');
    expect(link.to).toBe('dashboard');
    expect(link.trigger).toBe('tap');
    expect(link.label).toBe('Weiter zum Dashboard');
    expect(link.source).toBe('derived');
    expect(link.sourceRef.symbol).toBe('LoginPage');
  });

  it('<Navigate to> erzeugt eine auto-Kante ohne Label', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/login', element: <LoginGate /> },
  { path: '/home', element: <HomePage /> },
]);

function LoginGate() {
  return <Navigate to="/home" />;
}
`),
      ],
      new WarnLog().call,
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: 'login', to: 'home', trigger: 'auto' });
    expect(result.edges[0]!.label).toBeUndefined();
  });

  it("navigate('/pfad') wird nur erfasst, wenn die Datei useNavigate erwähnt", () => {
    const source = (hook: string): string => `
const router = createBrowserRouter([
  { path: '/profile', element: <ProfilePage /> },
  { path: '/home', element: <HomePage /> },
]);

function ProfilePage() {
  const navigate = ${hook}();
  return <button onClick={() => navigate('/home')}>Home</button>;
}
`;

    const withHook = deriveReactRouter([scanSource(source('useNavigate'))], new WarnLog().call);
    expect(withHook.edges).toHaveLength(1);
    expect(withHook.edges[0]).toMatchObject({ from: 'profile', to: 'home', trigger: 'tap' });

    // Ohne useNavigate-Erwähnung: freie Funktion gleichen Namens wird ignoriert.
    const withoutHook = deriveReactRouter([scanSource(source('getNavigator'))], new WarnLog().call);
    expect(withoutHook.edges).toEqual([]);
  });

  it('manualScreenSymbols (Weg A) liefert das from für Nav-Kanten', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/login' },
  { path: '/dashboard' },
]);

function LoginScreen() {
  return <Link to="/dashboard">Anmelden</Link>;
}
`),
      ],
      new WarnLog().call,
      { manualScreenSymbols: new Map([['LoginScreen', 'login']]) },
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: 'login', to: 'dashboard', label: 'Anmelden' });
  });

  it('unbekanntes Nav-Ziel: Warnung, Kante verworfen', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
]);

function LoginPage() {
  return <Link to="/unbekannt">Kaputt</Link>;
}
`),
      ],
      warn.call,
    );

    expect(result.edges).toEqual([]);
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('/unbekannt');
    expect(warn.messages[0]).toContain('Kante verworfen');
  });

  it('unbekannte umschließende Komponente: Warnung, Kante verworfen', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/home', element: <HomePage /> },
]);

function Sidebar() {
  return <Link to="/home">Home</Link>;
}
`),
      ],
      warn.call,
    );

    expect(result.edges).toEqual([]);
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('umschließende Komponente unbekannt');
  });

  it('ohne gefundene Routen entfällt die Nav-Analyse komplett', () => {
    const warn = new WarnLog();
    const result = deriveReactRouter(
      [
        scanSource(`
function LoginPage() {
  return <Link to="/dashboard">Weiter</Link>;
}
`),
      ],
      warn.call,
    );

    expect(result.hasRoutes).toBe(false);
    expect(result.edges).toEqual([]);
    expect(warn.messages).toEqual([]);
  });
});

describe('deriveReactRouter — Regressionen aus dem Review', () => {
  it('löst eine Routen-Konstante derselben Datei auf: createBrowserRouter(routes)', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const routes = [
  { path: '/', element: <Home /> },
  { path: '/about', element: <About /> },
] satisfies RouteObject[];
const router = createBrowserRouter(routes);
`),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['about', 'root']);
    expect(result.componentToScreen.get('About')).toBe('about');
  });

  it('<Route index={false} path> bleibt ein eigener Screen (kein Index-Kollaps)', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const el = (
  <Routes>
    <Route path="/shop" element={<Layout />}>
      <Route index={false} path="pricing" element={<Pricing />} />
    </Route>
  </Routes>
);
`),
      ],
      new WarnLog().call,
    );

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['shop', 'shop-pricing']);
  });

  it('<Route index> und <Route index={true}> zählen weiterhin als Index-Routen', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const el = (
  <Route path="/docs" element={<Layout />}>
    <Route index element={<DocsHome />} />
  </Route>
);
`),
      ],
      new WarnLog().call,
    );

    // Index-Route übernimmt den Eltern-Pfad ⇒ gleiche Id, ein Screen.
    expect(result.nodes.map((n) => n.id)).toEqual(['docs', 'docs']);
    expect(result.componentToScreen.get('DocsHome')).toBe('docs');
  });

  it('die eigene element-Zuordnung gewinnt vor der extra-Tabelle (Next-Heuristik)', () => {
    const result = deriveReactRouter(
      [
        scanSource(`
const router = createBrowserRouter([{ path: '/', element: <Home /> }]);
`),
        scanSource(
          `
export function Home() {
  return <Link to="/">Start</Link>;
}
`,
          'src/home.tsx',
        ),
      ],
      new WarnLog().call,
      { extraComponentToScreen: new Map([['Home', 'phantom']]) },
    );

    const edge = result.edges.find((e) => e.to === 'root');
    expect(edge?.from).toBe('root');
  });
});
