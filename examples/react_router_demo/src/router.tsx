import { createBrowserRouter, Outlet, redirect } from 'react-router-dom';

import { isLoggedIn } from './auth';
import { DashboardScreen } from './screens/dashboard-screen';
import { LoginScreen } from './screens/login-screen';
import { RegisterScreen } from './screens/register-screen';
import { SettingsScreen } from './screens/settings-screen';

/**
 * Access guard for the signed-in area: Ductus derives a decision node from
 * this redirect(...); the string literal '/login' yields a conditional edge
 * towards login (best effort).
 */
function requireAuth(): Response | null {
  if (!isLoggedIn) {
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
    // Pathless layout route with children (the react-router counterpart to
    // the ShellRoute): Ductus groups dashboard and settings into a flow.
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

/** Shared navigation shell for the signed-in area. */
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
