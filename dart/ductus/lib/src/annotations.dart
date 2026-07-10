/// Ductus-Annotationen: markieren Screens, Actions, Decisions und Flows,
/// aus denen der Adapter den User-Journey-Graphen extrahiert.
///
/// Diese Klassen sind reine Marker für die statische Analyse durch das
/// Adapter-CLI (`dart run ductus:adapter`) — sie haben keinerlei
/// Laufzeitverhalten und keine Abhängigkeiten.
library;

/// Auslöser einer Transition (Edge im Journey-Graphen).
enum JourneyTrigger { tap, submit, auto, back, deeplink, system }

/// Markiert einen für den Nutzer sichtbaren Bildschirm (Screen-Node).
///
/// ```dart
/// @JourneyScreen(
///   id: 'login',
///   title: 'Anmeldung',
///   flow: 'auth',
///   description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
/// )
/// class LoginScreen extends StatelessWidget { … }
/// ```
class JourneyScreen {
  final String id;
  final String title;
  final String? flow;
  final String? description;
  final List<String> tags;

  const JourneyScreen({
    required this.id,
    required this.title,
    this.flow,
    this.description,
    this.tags = const [],
  });
}

/// Markiert eine vom Nutzer auslösbare Handlung; wird als Transition (Edge)
/// von [from] nach [to] in den Graphen übersetzt.
///
/// Fehlt [from], gilt der umschließende, mit [JourneyScreen] annotierte
/// Kontext (die Klasse, in der die Methode/das Feld deklariert ist).
class JourneyAction {
  final String label;
  final String to;
  final String? from;

  /// Optionale Edge-Id; ohne Angabe wird deterministisch `e_<from>_<to>` generiert.
  final String? id;
  final JourneyTrigger trigger;
  final String? condition;

  const JourneyAction({
    required this.label,
    required this.to,
    this.from,
    this.id,
    this.trigger = JourneyTrigger.tap,
    this.condition,
  });
}

/// Markiert einen Verzweigungspunkt mit Bedingungen (Decision-Node).
class JourneyDecision {
  final String id;
  final String title;
  final String? flow;
  final String? description;
  final List<String> tags;

  const JourneyDecision({
    required this.id,
    required this.title,
    this.flow,
    this.description,
    this.tags = const [],
  });
}

/// Deklariert einen benannten Flow (zusammenhängende Teilmenge des Graphen).
///
/// [start] muss die Id eines Screen-Nodes sein — sonst schlägt die
/// Graph-Validierung fehl (Regel V3 der Ductus-CLI).
class JourneyFlow {
  final String id;
  final String title;
  final String start;
  final String? description;

  const JourneyFlow({
    required this.id,
    required this.title,
    required this.start,
    this.description,
  });
}
