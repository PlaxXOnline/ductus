// Fixture: manual annotations (paths A + B) on top of the derived routes.

// @journey:flow id="auth" title="Anmeldung & Registrierung" start="login"

@JourneyScreen(
  id: 'login',
  title: 'Anmeldung',
  flow: 'auth',
  description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
  tags: ['entry', 'auth'],
)
class LoginScreen {
  @JourneyAction(
    label: 'Anmelden',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'Zugangsdaten gültig',
  )
  void onSubmit() {}
}

class ProfileScreen {
  void openHome(dynamic context) {
    context.go('/home');
  }

  void broken(dynamic context) {
    context.go('/unbekannt');
  }
}

// @journey:screen id="dashboard" title="Übersicht"
//   description="Zentrale Übersicht nach der Anmeldung."
class DashboardScreen {
  // @journey:action label="Abmelden" to="login" trigger="tap"
  void logout() {}
}
