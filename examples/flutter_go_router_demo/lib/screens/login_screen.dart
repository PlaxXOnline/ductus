import 'package:ductus/ductus.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../main.dart' show isLoggedIn;

/// Der Screen ist bereits aus der go_router-Tabelle abgeleitet (Weg C);
/// die Annotationen reichern ihn um Titel, Flow und Beschreibung an (Weg B).
@JourneyFlow(id: 'auth', title: 'Anmeldung & Registrierung', start: 'login')
@JourneyScreen(
  id: 'login',
  title: 'Anmeldung',
  flow: 'auth',
  description:
      'Bildschirm, auf dem sich der Nutzer mit E-Mail und Passwort anmeldet.',
)
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @JourneyAction(
    label: 'Anmelden',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'Zugangsdaten gültig',
  )
  void _onSubmit(BuildContext context) {
    isLoggedIn = true;
    context.goNamed('dashboard');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Anmeldung')),
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
              onPressed: () => _onSubmit(context),
              child: const Text('Anmelden'),
            ),
            TextButton(
              onPressed: () => context.goNamed('register'),
              child: const Text('Noch kein Konto? Registrieren'),
            ),
          ],
        ),
      ),
    );
  }
}
