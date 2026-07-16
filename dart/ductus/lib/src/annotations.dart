/// Ductus annotations: mark screens, actions, decisions, and flows from
/// which the adapter extracts the user-journey graph.
///
/// These classes are pure markers for static analysis by the adapter CLI
/// (`dart run ductus:adapter`) — they have no runtime behavior and no
/// dependencies.
library;

/// Trigger of a transition (edge in the journey graph).
enum JourneyTrigger { tap, submit, auto, back, deeplink, system }

/// Marks a screen visible to the user (screen node).
///
/// ```dart
/// @JourneyScreen(
///   id: 'login',
///   title: 'Sign-in',
///   flow: 'auth',
///   description: 'Screen where the user signs in.',
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

/// Marks an action the user can trigger; translated into a transition
/// (edge) from [from] to [to] in the graph.
///
/// If [from] is missing, the enclosing context annotated with
/// [JourneyScreen] applies (the class in which the method/field is
/// declared).
class JourneyAction {
  final String label;
  final String to;
  final String? from;

  /// Optional edge id; without it, `e_<from>_<to>` is generated deterministically.
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

/// Marks a branching point with conditions (decision node).
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

/// Declares a named flow (a connected subset of the graph).
///
/// [start] must be the id of a screen node — otherwise graph validation
/// fails (rule V3 of the Ductus CLI).
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
