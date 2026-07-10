import { createBrowserRouter, Outlet, redirect } from 'react-router-dom';

import { angemeldet } from './auth';
import { DashboardScreen } from './screens/dashboard-screen';
import { LoginScreen } from './screens/login-screen';
import { RegisterScreen } from './screens/register-screen';
import { SettingsScreen } from './screens/settings-screen';

/**
 * Zugangsschutz für den eingeloggten Bereich: Ductus leitet aus diesem
 * redirect(...) einen Decision-Node ab; das String-Literal '/login' ergibt
 * eine bedingte Kante Richtung login (best effort).
 */
function requireAuth(): Response | null {
  if (!angemeldet) {
    return redirect('/login');
  }
  return null;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginScreen />,
  },
  {
    path: '/register',
    element: <RegisterScreen />,
  },
  {
    // Pfadlose Layout-Route mit Kindern (das react-router-Gegenstück zur
    // ShellRoute): Ductus gruppiert dashboard und settings zu einem Flow.
    element: <AppShell />,
    children: [
      {
        path: '/dashboard',
        element: <DashboardScreen />,
        loader: requireAuth,
      },
      {
        path: '/settings',
        element: <SettingsScreen />,
      },
    ],
  },
]);

/** Gemeinsame Navigationshülle für den eingeloggten Bereich. */
function AppShell() {
  return (
    <div className="app-shell">
      <header>
        <strong>react_router_demo</strong>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
