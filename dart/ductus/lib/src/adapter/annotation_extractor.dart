/// Weg B — native Dart-Annotationen `@JourneyScreen` etc.
///
/// Parse-only: Const-Argumente werden literal aus dem AST gelesen, ohne
/// Resolution. Der build_runner-Builder (Weg D) kann über
/// [AnnotationResolution] zusätzlich nicht-literale konstante Argumente
/// auflösen — literale Argumente bleiben davon unberührt (Paritätsgarantie).
library;

import 'package:analyzer/dart/ast/ast.dart';

import 'candidates.dart';
import 'graph_model.dart';
import 'scanner.dart';

/// Löst nicht-literale konstante Annotation-Argumente auf (Weg D).
///
/// Der Extraktor fragt hier nach, BEVOR er ein nicht literal lesbares
/// Argument diagnostiziert. `null` ⇒ nicht konstant auflösbar; dann greift
/// unverändert die parse-only-Warn-/Fehlersemantik (gleiche Meldungsformate).
/// Bewusst frei von build-/source_gen-Typen, damit das Adapter-CLI keine
/// Builder-Abhängigkeiten zieht.
abstract class AnnotationResolution {
  /// Konstanter String-Wert des benannten Arguments [key], sonst `null`.
  String? stringValue(ScannedFile file, Annotation annotation, String key);

  /// Konstante String-Liste des benannten Arguments [key], sonst `null`.
  List<String>? stringListValue(
      ScannedFile file, Annotation annotation, String key);

  /// Name des konstanten `JourneyTrigger`-Werts (z. B. 'tap'), sonst `null`.
  String? triggerValue(ScannedFile file, Annotation annotation, String key);
}

String _annotationName(Annotation annotation) {
  final name = annotation.name;
  return name is PrefixedIdentifier ? name.identifier.name : name.name;
}

String? _stringValue(Expression expr) =>
    expr is StringLiteral ? expr.stringValue : null;

/// `JourneyTrigger.tap` bzw. `prefix.JourneyTrigger.tap` -> 'tap'.
String? _triggerValue(Expression expr) {
  if (expr is PrefixedIdentifier) return expr.identifier.name;
  if (expr is PropertyAccess) return expr.propertyName.name;
  return null;
}

Map<String, Expression> _namedArgs(Annotation annotation) {
  final args = <String, Expression>{};
  for (final arg in annotation.arguments?.arguments ?? const <Argument>[]) {
    if (arg is NamedArgument) {
      args[arg.name.lexeme] = arg.argumentExpression;
    }
  }
  return args;
}

/// Extrahiert alle Journey-Annotationen einer Datei.
///
/// [resolution] (Weg D) löst nicht-literale konstante Argumente auf; ohne
/// Auflösung bleibt das parse-only-Verhalten byte-identisch erhalten.
ManualExtraction extractAnnotations(
  ScannedFile file,
  void Function(String) warn,
  List<String> errors, {
  AnnotationResolution? resolution,
}) {
  final result = ManualExtraction();

  void handleAnnotation(
    Annotation annotation, {
    required String symbol,
    String? enclosingClassName,
  }) {
    final name = _annotationName(annotation);
    final ref = file.refAt(annotation.offset, symbol: symbol);
    final where = '${file.relPath}:${ref.line}';
    final args = _namedArgs(annotation);

    /// Liest ein benanntes String-Argument. Ist das Argument zwar vorhanden,
    /// aber parse-only nicht literal lesbar (z. B. eine Const-Referenz),
    /// versucht zuerst [resolution] (Weg D) die konstante
    /// Auflösung; scheitert auch die, wird das diagnostiziert statt
    /// stillschweigend verworfen: Warnung für optionale Felder, Fehler bei
    /// [errorIfUnreadable].
    String? str(String key, {bool errorIfUnreadable = false}) {
      final expr = args[key];
      if (expr == null) return null;
      final value =
          _stringValue(expr) ?? resolution?.stringValue(file, annotation, key);
      if (value == null) {
        if (errorIfUnreadable) {
          errors.add('$where: @$name: "$key" nicht literal lesbar '
              '(nur String-Literale werden parse-only unterstützt).');
        } else {
          warn('Warnung: $where: @$name: "$key" nicht literal lesbar '
              '— ignoriert.');
        }
      }
      return value;
    }

    /// Liest das optionale `tags:`-Argument. Nicht (vollständig) literal
    /// lesbare Listen werden zuerst über [resolution] (Weg D) konstant
    /// aufgelöst; scheitert das, greift die parse-only-Semantik: nicht-
    /// literale Liste bzw. nicht-literale Elemente mit Warnung überspringen.
    List<String> tagsValue() {
      final expr = args['tags'];
      if (expr == null) return const [];
      if (expr is! ListLiteral) {
        final resolved = resolution?.stringListValue(file, annotation, 'tags');
        if (resolved != null) return resolved;
        warn('Warnung: $where: @$name: "tags" nicht literal lesbar '
            '— ignoriert.');
        return const [];
      }
      final values = <String>[];
      var allLiteral = true;
      for (final element in expr.elements) {
        final v = element is StringLiteral ? element.stringValue : null;
        if (v == null) {
          allLiteral = false;
        } else {
          values.add(v);
        }
      }
      // Voll literal ⇒ Paritätspfad, identisch zum parse-only-Extraktor.
      if (allLiteral) return values;
      final resolved = resolution?.stringListValue(file, annotation, 'tags');
      if (resolved != null) return resolved;
      // parse-only-Fallback: Warnung je nicht lesbarem Element, Rest behalten.
      for (final element in expr.elements) {
        if (element is! StringLiteral || element.stringValue == null) {
          warn('Warnung: $where: @$name: "tags"-Element nicht literal '
              'lesbar — ignoriert.');
        }
      }
      return values;
    }

    switch (name) {
      case 'JourneyScreen':
      case 'JourneyDecision':
        final id = str('id', errorIfUnreadable: true);
        final title = str('title', errorIfUnreadable: true);
        if (id == null || title == null) {
          if (!args.containsKey('id') || !args.containsKey('title')) {
            errors.add('$where: @$name benötigt literale "id" und "title".');
          }
          return;
        }
        final type = name == 'JourneyScreen' ? 'screen' : 'decision';
        result.nodes.add(GraphNode(
          id: id,
          type: type,
          title: title,
          flow: str('flow'),
          description: str('description'),
          tags: tagsValue(),
          source: SourceKind.annotation,
          sourceRef: ref,
        ));
        if (type == 'screen') {
          result.screenClassNames.putIfAbsent(symbol, () => id);
        }
      case 'JourneyAction':
        final label = str('label', errorIfUnreadable: true);
        final to = str('to', errorIfUnreadable: true);
        if (label == null || to == null) {
          if (!args.containsKey('label') || !args.containsKey('to')) {
            errors
                .add('$where: @JourneyAction benötigt literale "label" und "to".');
          }
          return;
        }
        var trigger = 'tap';
        if (args.containsKey('trigger')) {
          var t = _triggerValue(args['trigger']!);
          if (t == null || !validTriggers.contains(t)) {
            // Weg D: konstante Referenz (z. B. `MyConsts.trigger`) auflösen.
            t = resolution?.triggerValue(file, annotation, 'trigger') ?? t;
          }
          if (t == null || !validTriggers.contains(t)) {
            warn('Warnung: $where: trigger nicht literal lesbar — '
                'verwende "tap".');
          } else {
            trigger = t;
          }
        }
        // Explizit gesetztes, aber nicht lesbares `from` ist ein Fehler —
        // sonst würde die from-Inferenz den gemeinten Wert stillschweigend
        // durch die umschließende Klasse ersetzen (falsche Kante).
        final from = str('from', errorIfUnreadable: true);
        if (from == null && args.containsKey('from')) return;
        if (from == null && enclosingClassName == null) {
          errors.add('$where: @JourneyAction ohne "from" und ohne '
              'umschließende Klasse — "from" nicht bestimmbar.');
          return;
        }
        result.actions.add(ActionCandidate(
          id: str('id'),
          label: label,
          to: to,
          from: from,
          trigger: trigger,
          condition: str('condition'),
          enclosingClassName: enclosingClassName,
          sourceRef: ref,
        ));
      case 'JourneyFlow':
        final id = str('id', errorIfUnreadable: true);
        final title = str('title', errorIfUnreadable: true);
        final start = str('start', errorIfUnreadable: true);
        if (id == null || title == null || start == null) {
          if (!args.containsKey('id') ||
              !args.containsKey('title') ||
              !args.containsKey('start')) {
            errors.add(
                '$where: @JourneyFlow benötigt literale "id", "title" und "start".');
          }
          return;
        }
        result.flows.add(GraphFlow(
          id: id,
          title: title,
          start: start,
          description: str('description'),
          source: SourceKind.annotation,
          sourceRef: ref,
        ));
    }
  }

  for (final directive in file.unit.directives) {
    if (directive is LibraryDirective) {
      for (final annotation in directive.metadata) {
        handleAnnotation(annotation, symbol: file.relPath);
      }
    }
  }

  for (final decl in file.unit.declarations) {
    if (decl is ClassDeclaration) {
      final className = decl.namePart.typeName.lexeme;
      for (final annotation in decl.metadata) {
        handleAnnotation(annotation, symbol: className);
      }
      for (final member in decl.body.members) {
        if (member is MethodDeclaration) {
          for (final annotation in member.metadata) {
            handleAnnotation(
              annotation,
              symbol: member.name.lexeme,
              enclosingClassName: className,
            );
          }
        } else if (member is FieldDeclaration) {
          final fieldName = member.fields.variables.isEmpty
              ? className
              : member.fields.variables.first.name.lexeme;
          for (final annotation in member.metadata) {
            handleAnnotation(
              annotation,
              symbol: fieldName,
              enclosingClassName: className,
            );
          }
        }
      }
    } else if (decl is FunctionDeclaration) {
      for (final annotation in decl.metadata) {
        handleAnnotation(annotation, symbol: decl.name.lexeme);
      }
    } else if (decl is TopLevelVariableDeclaration) {
      final varName = decl.variables.variables.isEmpty
          ? file.relPath
          : decl.variables.variables.first.name.lexeme;
      for (final annotation in decl.metadata) {
        handleAnnotation(annotation, symbol: varName);
      }
    }
  }

  return result;
}
