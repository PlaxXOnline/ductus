import 'package:ductus/ductus.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../main.dart' show isLoggedIn;

/// The screen is already derived from the go_router table (path C);
/// the annotations enrich it with a title, flow and description (path B).
@JourneyFlow(id: 'auth', title: 'Sign-in & registration', start: 'login')
@JourneyScreen(
  id: 'login',
  title: 'Sign in',
  flow: 'auth',
  description: 'Screen where the user signs in with email and password.',
)
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @JourneyAction(
    label: 'Sign in',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'Credentials valid',
  )
  void _onSubmit(BuildContext context) {
    isLoggedIn = true;
    context.goNamed('dashboard');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const TextField(decoration: InputDecoration(labelText: 'Email')),
            const TextField(
              decoration: InputDecoration(labelText: 'Password'),
              obscureText: true,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => _onSubmit(context),
              child: const Text('Sign in'),
            ),
            TextButton(
              onPressed: () => context.goNamed('register'),
              child: const Text('No account yet? Register'),
            ),
          ],
        ),
      ),
    );
  }
}
