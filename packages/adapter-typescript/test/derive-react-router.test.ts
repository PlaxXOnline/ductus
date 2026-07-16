/**
 * Path C — derivation from react-router configurations. Architectural
 * mirror of dart/ductus/test/derive_go_router_test.dart.
 */

import { describe, expect, it } from 'vitest';
import { deriveReactRouter } from '../src/derive/react-router.js';
import { scanSource, WarnLog } from './test-util.js';

describe('deriveReactRouter — screens from routes', () => {
  it('derives screens from createBrowserRouter object routes (path slug, humanize)', () => {
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
    expect(usersEdit.title).toBe('Users edit'); // param segment dropped, humanized
    expect(usersEdit.source).toBe('derived');
    expect(usersEdit.sourceRef.file).toBe('src/test.tsx');
    expect(result.pathToScreen.get('/')).toBe('root');
    expect(result.pathToScreen.get('/users/:id/edit')).toBe('users-edit');
    expect(result.componentToScreen.get('Home')).toBe('root');
    expect(result.componentToScreen.get('UserEdit')).toBe('users-edit');
  });

  it('identical relative segments under different parents do not collapse', () => {
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

    // Id from the absolute joined full path — not from the relative segment.
    expect(result.nodes.map((n) => n.id)).toEqual(['user', 'user-detail', 'admin', 'admin-detail']);
    expect(result.pathToScreen.get('/user/detail')).toBe('user-detail');
    expect(result.pathToScreen.get('/admin/detail')).toBe('admin-detail');
  });

  it('route.id wins over the path slug', () => {
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

  it('a route without a literal path is skipped with a warning', () => {
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
    expect(warn.messages[0]).toContain('skipped');
  });
});

describe('deriveReactRouter — flows (pathless layout routes)', () => {
  it('a pathless layout route with children becomes flow shell-0 starting at the first child screen', () => {
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

  it('layout route without child screens: warning, flow dropped', () => {
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
    expect(warn.messages.some((m) => m.includes('flow "shell-0" dropped'))).toBe(true);
  });
});

describe('deriveReactRouter — loader/redirect', () => {
  it('a loader with redirect creates a decision node and auto edges', () => {
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
    expect(decision?.title).toBe('Redirect: Dashboard');
    expect(
      result.edges.map((e) => ({ from: e.from, to: e.to, trigger: e.trigger, condition: e.condition })),
    ).toEqual([
      { from: 'dashboard_redirect', to: 'dashboard', trigger: 'auto', condition: undefined },
      { from: 'dashboard_redirect', to: 'login', trigger: 'auto', condition: 'redirect' },
    ]);
  });

  it('a loader without a redirect call creates no decision', () => {
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

describe('deriveReactRouter — <Route> JSX', () => {
  it('processes <Route> JSX in createRoutesFromElements including the index route', () => {
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
    // Layout route without a path ⇒ flow, the index route is the start.
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]).toMatchObject({ id: 'shell-0', start: 'root' });
    expect(result.nodes.every((n) => n.flow === 'shell-0')).toBe(true);
    expect(result.pathToScreen.get('/')).toBe('root');
    expect(result.pathToScreen.get('/about')).toBe('about');
    expect(result.componentToScreen.get('Home')).toBe('root');
    expect(result.componentToScreen.get('About')).toBe('about');
  });

  it('element wrappers like <Suspense> prefer the child for the mapping', () => {
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

describe('deriveReactRouter — navigation', () => {
  it('<Link to> creates a tap edge with a label from the enclosing component', () => {
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

  it('<Navigate to> creates an auto edge without a label', () => {
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

  it("navigate('/path') is only captured when the file mentions useNavigate", () => {
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

    // Without a useNavigate mention: a free function of the same name is ignored.
    const withoutHook = deriveReactRouter([scanSource(source('getNavigator'))], new WarnLog().call);
    expect(withoutHook.edges).toEqual([]);
  });

  it('manualScreenSymbols (path A) provides the from for nav edges', () => {
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

  it('unknown nav target: warning, edge discarded', () => {
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
    expect(warn.messages[0]).toContain('edge discarded');
  });

  it('unknown enclosing component: warning, edge discarded', () => {
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
    expect(warn.messages[0]).toContain('enclosing component unknown');
  });

  it('without any found routes the nav analysis is skipped entirely', () => {
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

describe('deriveReactRouter — regressions from the review', () => {
  it('resolves a routes constant from the same file: createBrowserRouter(routes)', () => {
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

  it('<Route index={false} path> remains its own screen (no index collapse)', () => {
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

  it('<Route index> and <Route index={true}> still count as index routes', () => {
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

    // The index route takes over the parent path ⇒ same id, one screen.
    expect(result.nodes.map((n) => n.id)).toEqual(['docs', 'docs']);
    expect(result.componentToScreen.get('DocsHome')).toBe('docs');
  });

  it('the router’s own element mapping wins over the extra table (Next heuristic)', () => {
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
