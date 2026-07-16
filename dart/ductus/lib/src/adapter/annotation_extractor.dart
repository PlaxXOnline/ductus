/// Path B — native Dart annotations `@JourneyScreen` etc.
///
/// Parse-only: const arguments are read literally from the AST, without
/// resolution. The build_runner builder (path D) can additionally resolve
/// non-literal constant arguments via [AnnotationResolution] — literal
/// arguments remain unaffected by it (parity guarantee).
library;

import 'package:analyzer/dart/ast/ast.dart';

import 'candidates.dart';
import 'graph_model.dart';
import 'scanner.dart';

/// Resolves non-literal constant annotation arguments (path D).
///
/// The extractor asks here BEFORE it diagnoses an argument that is not
/// readable as a literal. `null` ⇒ not constant-resolvable; then the
/// parse-only warning/error semantics apply unchanged (same message
/// formats). Deliberately free of build/source_gen types so the adapter CLI
/// pulls no builder dependencies.
abstract class AnnotationResolution {
  /// Constant string value of the named argument [key], otherwise `null`.
  String? stringValue(ScannedFile file, Annotation annotation, String key);

  /// Constant string list of the named argument [key], otherwise `null`.
  List<String>? stringListValue(
      ScannedFile file, Annotation annotation, String key);

  /// Name of the constant `JourneyTrigger` value (e.g. 'tap'), otherwise `null`.
  String? triggerValue(ScannedFile file, Annotation annotation, String key);
}

String _annotationName(Annotation annotation) {
  final name = annotation.name;
  return name is PrefixedIdentifier ? name.identifier.name : name.name;
}

String? _stringValue(Expression expr) =>
    expr is StringLiteral ? expr.stringValue : null;

/// `JourneyTrigger.tap` or `prefix.JourneyTrigger.tap` -> 'tap'.
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

/// Extracts all journey annotations of a file.
///
/// [resolution] (path D) resolves non-literal constant arguments; without
/// resolution the parse-only behavior stays byte-identical.
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

    /// Reads a named string argument. If the argument is present but not
    /// readable as a literal parse-only (e.g. a const reference),
    /// [resolution] (path D) first attempts constant resolution; if that
    /// fails too, it is diagnosed instead of silently dropped: a warning
    /// for optional fields, an error for [errorIfUnreadable].
    String? str(String key, {bool errorIfUnreadable = false}) {
      final expr = args[key];
      if (expr == null) return null;
      final value =
          _stringValue(expr) ?? resolution?.stringValue(file, annotation, key);
      if (value == null) {
        if (errorIfUnreadable) {
          errors.add('$where: @$name: "$key" is not readable as a literal '
              '(parse-only supports string literals only).');
        } else {
          warn('Warning: $where: @$name: "$key" is not readable as a '
              'literal — ignored.');
        }
      }
      return value;
    }

    /// Reads the optional `tags:` argument. Lists that are not (fully)
    /// readable as literals are first constant-resolved via [resolution]
    /// (path D); if that fails, parse-only semantics apply: skip a
    /// non-literal list or non-literal elements with a warning.
    List<String> tagsValue() {
      final expr = args['tags'];
      if (expr == null) return const [];
      if (expr is! ListLiteral) {
        final resolved = resolution?.stringListValue(file, annotation, 'tags');
        if (resolved != null) return resolved;
        warn('Warning: $where: @$name: "tags" is not readable as a '
            'literal — ignored.');
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
      // Fully literal ⇒ parity path, identical to the parse-only extractor.
      if (allLiteral) return values;
      final resolved = resolution?.stringListValue(file, annotation, 'tags');
      if (resolved != null) return resolved;
      // Parse-only fallback: warn per unreadable element, keep the rest.
      for (final element in expr.elements) {
        if (element is! StringLiteral || element.stringValue == null) {
          warn('Warning: $where: @$name: "tags" element is not readable '
              'as a literal — ignored.');
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
            errors.add('$where: @$name requires literal "id" and "title".');
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
                .add('$where: @JourneyAction requires literal "label" and "to".');
          }
          return;
        }
        var trigger = 'tap';
        if (args.containsKey('trigger')) {
          var t = _triggerValue(args['trigger']!);
          if (t == null || !validTriggers.contains(t)) {
            // Path D: resolve a constant reference (e.g. `MyConsts.trigger`).
            t = resolution?.triggerValue(file, annotation, 'trigger') ?? t;
          }
          if (t == null || !validTriggers.contains(t)) {
            warn('Warning: $where: trigger is not readable as a literal — '
                'using "tap".');
          } else {
            trigger = t;
          }
        }
        // An explicitly set but unreadable `from` is an error — otherwise
        // the from inference would silently replace the intended value
        // with the enclosing class (wrong edge).
        final from = str('from', errorIfUnreadable: true);
        if (from == null && args.containsKey('from')) return;
        if (from == null && enclosingClassName == null) {
          errors.add('$where: @JourneyAction without "from" and without an '
              'enclosing class — cannot determine "from".');
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
                '$where: @JourneyFlow requires literal "id", "title", and "start".');
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
