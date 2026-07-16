import 'package:ductus/ductus.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

@JourneyScreen(
  id: 'register',
  title: 'Registration',
  flow: 'auth',
  description: 'Screen where the user creates a new account.',
)
class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @JourneyAction(
    label: 'Create account',
    to: 'login',
    trigger: JourneyTrigger.submit,
    condition: 'Registration successful',
  )
  void _onRegister(BuildContext context) {
    context.goNamed('login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Registration')),
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
              onPressed: () => _onRegister(context),
              child: const Text('Create account'),
            ),
          ],
        ),
      ),
    );
  }
}
