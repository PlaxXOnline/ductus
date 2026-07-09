import 'package:ductus/ductus.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

@JourneyScreen(
  id: 'register',
  title: 'Registrierung',
  flow: 'auth',
  description: 'Bildschirm, auf dem der Nutzer ein neues Konto anlegt.',
)
class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @JourneyAction(
    label: 'Konto erstellen',
    to: 'login',
    trigger: JourneyTrigger.submit,
    condition: 'Registrierung erfolgreich',
  )
  void _onRegister(BuildContext context) {
    context.goNamed('login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Registrierung')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const TextField(decoration: InputDecoration(labelText: 'E-Mail')),
            const TextField(
              decoration: InputDecoration(labelText: 'Passwort'),
              obscureText: true,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => _onRegister(context),
              child: const Text('Konto erstellen'),
            ),
          ],
        ),
      ),
    );
  }
}
