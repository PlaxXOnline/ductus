import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'screens/register_screen.dart';
import 'screens/settings_screen.dart';

/// Simulated sign-in state (real apps would use e.g. an AuthService here).
bool isLoggedIn = false;

final GoRouter router = GoRouter(
  initialLocation: '/login',
  // Ductus derives a decision node from this redirect; the string literal
  // '/login' is picked up as a conditional edge (best effort).
  redirect: (BuildContext context, GoRouterState state) {
    final bool goingToAuth =
        state.matchedLocation == '/login' ||
        state.matchedLocation == '/register';
    if (!isLoggedIn && !goingToAuth) {
      return '/login';
    }
    return null;
  },
  routes: [
    GoRoute(
      path: '/login',
      name: 'login',
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: '/register',
      name: 'register',
      builder: (context, state) => const RegisterScreen(),
    ),
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(
          path: '/dashboard',
          name: 'dashboard',
          builder: (context, state) => const DashboardScreen(),
        ),
        GoRoute(
          path: '/settings',
          name: 'settings',
          builder: (context, state) => const SettingsScreen(),
        ),
      ],
    ),
  ],
);

void main() => runApp(const GoRouterDemoApp());

class GoRouterDemoApp extends StatelessWidget {
  const GoRouterDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Ductus go_router demo',
      routerConfig: router,
    );
  }
}

/// Shared navigation shell for the signed-in area.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: GoRouterState.of(context).matchedLocation == '/settings'
            ? 1
            : 0,
        onTap: (index) =>
            context.goNamed(index == 0 ? 'dashboard' : 'settings'),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Dashboard'),
          BottomNavigationBarItem(
            icon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
