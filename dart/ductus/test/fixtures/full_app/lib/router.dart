// Fixture: go_router-Konfiguration. Wird nur geparst (parse-only),
// unaufgelöste Bezeichner sind beabsichtigt.

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/login',
      name: 'login',
      builder: (context, state) => LoginScreen(),
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => DashboardScreen(),
      redirect: (context, state) {
        if (!isLoggedIn) {
          return '/login';
        }
        return null;
      },
      routes: [
        GoRoute(
          path: 'settings/:tab',
          builder: (context, state) => SettingsScreen(),
        ),
      ],
    ),
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(
          path: '/home',
          name: 'home',
          pageBuilder: (context, state) => MaterialPage(child: HomeScreen()),
        ),
        GoRoute(
          path: '/profile',
          builder: (context, state) => ProfileScreen(),
        ),
      ],
    ),
  ],
);
