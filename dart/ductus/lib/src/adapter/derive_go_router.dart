/// Weg C — Ableitung aus go_router-Konfigurationen.
///
/// Alles hier ist best effort und trägt `source: "derived"`; manuelle
/// Annotationen überschreiben abgeleitete Werte feldweise.
library;

import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';

import 'graph_model.dart';
import 'scanner.dart';

/// Pfad-Slug für abgeleitete Screen-Ids: führendes '/' weg, '/'→'-',
/// ':param' entfällt, leer → 'root'.
String slugFromPath(String path) {
  final slug = path
      .split('/')
      .where((s) => s.isNotEmpty && !s.startsWith(':'))
      .join('-');
  return slug.isEmpty ? 'root' : slug;
}

/// Humanisierte Id: '-'→' ', erster Buchstabe groß.
String humanize(String id) {
  final text = id.replaceAll('-', ' ');
  if (text.isEmpty) return text;
  return text[0].toUpperCase() + text.substring(1);
}

String _joinPaths(String parent, String child) {
  if (child.startsWith('/')) return child;
  if (parent.isEmpty || parent == '/') return '/$child';
  return '$parent/$child';
}

class GoRouterDerivation {
  final List<GraphNode> nodes = [];
  final List<GraphFlow> flows = [];
  final List<GraphEdge> edges = [];

  /// Widget-Klasse (aus builder:/pageBuilder:) -> Screen-Id.
  final Map<String, String> builderClassToScreen = {};
  final Map<String, String> pathToScreen = {};
  final Map<String, String> nameToScreen = {};
}

/// Einheitliche Sicht auf `GoRoute(...)`/`ShellRoute(...)` — parse-only sind
/// Konstruktor-Aufrufe ohne `new`/`const` MethodInvocations.
class _RouteCall {
  final AstNode node;
  final String name;
  final ArgumentList argumentList;

  _RouteCall(this.node, this.name, this.argumentList);

  static _RouteCall? of(AstNode node) {
    if (node is MethodInvocation && node.target == null) {
      return _RouteCall(node, node.methodName.name, node.argumentList);
    }
    if (node is InstanceCreationExpression) {
      return _RouteCall(
          node, node.constructorName.type.name.lexeme, node.argumentList);
    }
    return null;
  }

  Expression? namedArg(String name) {
    for (final arg in argumentList.arguments) {
      if (arg is NamedArgument && arg.name.lexeme == name) {
        return arg.argumentExpression;
      }
    }
    return null;
  }
}

class _RouteCollector extends RecursiveAstVisitor<void> {
  final List<_RouteCall> calls = [];

  void _check(AstNode node) {
    final call = _RouteCall.of(node);
    if (call != null && (call.name == 'GoRoute' || call.name == 'ShellRoute')) {
      calls.add(call);
    }
  }

  @override
  void visitMethodInvocation(MethodInvocation node) {
    _check(node);
    super.visitMethodInvocation(node);
  }

  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) {
    _check(node);
    super.visitInstanceCreationExpression(node);
  }
}

/// Erzeugung `Klasse(...)` -> Klassenname (nur Großbuchstaben-Start).
String? _creationClassName(Expression expr) {
  if (expr is MethodInvocation && expr.target == null) {
    final name = expr.methodName.name;
    return name.isNotEmpty && name[0].toUpperCase() == name[0] ? name : null;
  }
  if (expr is InstanceCreationExpression) {
    return expr.constructorName.type.name.lexeme;
  }
  return null;
}

ArgumentList? _creationArgs(Expression expr) {
  if (expr is MethodInvocation) return expr.argumentList;
  if (expr is InstanceCreationExpression) return expr.argumentList;
  return null;
}

/// Widget-Klasse aus einem builder:/pageBuilder:-Ausdruck: Rückgabewert
/// `(…) => Klasse(…)` bzw. das `child:`-Argument (z. B. `MaterialPage(
/// child: Klasse(…))`).
String? _widgetClassOf(Expression expr) {
  if (expr is! FunctionExpression) return null;
  final body = expr.body;
  Expression? returned;
  if (body is ExpressionFunctionBody) {
    returned = body.expression;
  } else if (body is BlockFunctionBody) {
    for (final stmt in body.block.statements) {
      if (stmt is ReturnStatement && stmt.expression != null) {
        returned = stmt.expression;
        break;
      }
    }
  }
  if (returned == null) return null;
  final topClass = _creationClassName(returned);
  if (topClass == null) return null;
  // `child:`-Argument bevorzugen (pageBuilder-Muster).
  final args = _creationArgs(returned);
  if (args != null) {
    for (final arg in args.arguments) {
      if (arg is NamedArgument && arg.name.lexeme == 'child') {
        final childClass = _creationClassName(arg.argumentExpression);
        if (childClass != null) return childClass;
      }
    }
  }
  return topClass;
}

class _PendingRedirect {
  final String screenId;
  final String screenTitle;
  final Expression body;
  final ScannedFile file;

  _PendingRedirect(this.screenId, this.screenTitle, this.body, this.file);
}

class _StringLiteralCollector extends RecursiveAstVisitor<void> {
  final List<String> values = [];

  @override
  void visitSimpleStringLiteral(SimpleStringLiteral node) {
    values.add(node.value);
    super.visitSimpleStringLiteral(node);
  }
}

const _navByPath = {'go', 'push', 'replace'};
const _navByName = {'goNamed', 'pushNamed'};

class _NavCallCollector extends RecursiveAstVisitor<void> {
  final List<MethodInvocation> calls = [];

  @override
  void visitMethodInvocation(MethodInvocation node) {
    final name = node.methodName.name;
    // Nur Aufrufe mit Empfänger (context.go(…), router.go(…)) betrachten,
    // um freie Funktionen gleichen Namens nicht fälschlich zu erfassen.
    if (node.target != null &&
        (_navByPath.contains(name) || _navByName.contains(name))) {
      calls.add(node);
    }
    super.visitMethodInvocation(node);
  }
}

ClassDeclaration? _enclosingClassOf(AstNode node) {
  AstNode? current = node;
  while (current != null) {
    if (current is ClassDeclaration) return current;
    current = current.parent;
  }
  return null;
}

/// Leitet Screens, Flows (ShellRoute), Redirect-Decisions und
/// Navigations-Kanten aus go_router-Konfigurationen ab.
///
/// [manualScreenClasses] (Weg A/B) und [extraClassToScreen] (z. B. auto_route)
/// werden für die from-Zuordnung von context.go-Aufrufen mitverwendet,
/// [extraPathToScreen] für die Pfad-Zuordnung.
GoRouterDerivation deriveGoRouter(
  List<ScannedFile> files,
  void Function(String) warn, {
  Map<String, String> manualScreenClasses = const {},
  Map<String, String> extraClassToScreen = const {},
  Map<String, String> extraPathToScreen = const {},
}) {
  final result = GoRouterDerivation();
  result.pathToScreen.addAll(extraPathToScreen);
  final pendingRedirects = <_PendingRedirect>[];
  var shellIndex = 0;

  // Pass 1 — Routenbäume: Screens, Flows, builder-Zuordnung, Pfad-/Namens-
  // Tabellen. Dateien sind nach Pfad sortiert, im Dokument nach Offset.
  for (final file in files) {
    final collector = _RouteCollector();
    file.unit.accept(collector);
    final visited = <AstNode>{};

    // Flow-Kontext des innersten ShellRoute; start = erster Kind-Screen.
    void processRoute(_RouteCall call,
        {String parentPath = '', String? flowId, List<String?>? flowStart}) {
      visited.add(call.node);

      String? childFlowId = flowId;
      List<String?>? childFlowStart = flowStart;
      var childParentPath = parentPath;

      if (call.name == 'ShellRoute') {
        childFlowId = 'shell-$shellIndex';
        shellIndex++;
        childFlowStart = [null];
      } else {
        // GoRoute
        final pathExpr = call.namedArg('path');
        final nameExpr = call.namedArg('name');
        final path = pathExpr is StringLiteral ? pathExpr.stringValue : null;
        final name = nameExpr is StringLiteral ? nameExpr.stringValue : null;

        if (path == null && name == null) {
          warn('Hinweis: ${file.relPath}:${file.lineOf(call.node.offset)}: '
              'GoRoute ohne literalen path/name — übersprungen.');
        } else {
          // Id aus dem gejointen Vollpfad bilden — der relative Pfad allein
          // würde verschachtelte Routen mit gleichem Segment (z. B. 'detail'
          // unter '/user' und '/admin') stillschweigend kollabieren lassen.
          final fullPath = path == null ? null : _joinPaths(parentPath, path);
          final id = name ?? slugFromPath(fullPath!);
          result.nodes.add(GraphNode(
            id: id,
            type: 'screen',
            title: humanize(id),
            flow: flowId,
            source: SourceKind.derived,
            sourceRef: file.refAt(call.node.offset, symbol: name ?? path),
          ));
          if (flowStart != null) flowStart[0] ??= id;
          if (name != null) result.nameToScreen.putIfAbsent(name, () => id);
          if (fullPath != null) {
            childParentPath = fullPath;
            result.pathToScreen.putIfAbsent(fullPath, () => id);
          }

          final builder =
              call.namedArg('builder') ?? call.namedArg('pageBuilder');
          if (builder != null) {
            final widgetClass = _widgetClassOf(builder);
            if (widgetClass != null) {
              result.builderClassToScreen.putIfAbsent(widgetClass, () => id);
            }
          }

          final redirect = call.namedArg('redirect');
          if (redirect != null) {
            pendingRedirects
                .add(_PendingRedirect(id, humanize(id), redirect, file));
          }
        }
      }

      final routesExpr = call.namedArg('routes');
      if (routesExpr is ListLiteral) {
        for (final element in routesExpr.elements) {
          final child = _RouteCall.of(element);
          if (child != null &&
              (child.name == 'GoRoute' || child.name == 'ShellRoute')) {
            processRoute(child,
                parentPath: childParentPath,
                flowId: childFlowId,
                flowStart: childFlowStart);
          }
        }
      }

      if (call.name == 'ShellRoute') {
        final start = childFlowStart![0];
        if (start == null) {
          warn('Hinweis: ${file.relPath}:${file.lineOf(call.node.offset)}: '
              'ShellRoute ohne Kind-Screens — Flow "$childFlowId" entfällt.');
        } else {
          result.flows.add(GraphFlow(
            id: childFlowId!,
            title: humanize(childFlowId),
            start: start,
            source: SourceKind.derived,
            sourceRef: file.refAt(call.node.offset),
          ));
        }
      }
    }

    for (final call in collector.calls) {
      if (!visited.contains(call.node)) processRoute(call);
    }
  }

  // Pass 2a — Redirect-Decisions (jetzt sind alle Routen-Pfade bekannt).
  for (final pending in pendingRedirects) {
    final decisionId = '${pending.screenId}_redirect';
    final ref = pending.file.refAt(pending.body.offset);
    result.nodes.add(GraphNode(
      id: decisionId,
      type: 'decision',
      title: 'Weiterleitung: ${pending.screenTitle}',
      source: SourceKind.derived,
      sourceRef: ref,
    ));
    result.edges.add(GraphEdge(
      from: decisionId,
      to: pending.screenId,
      trigger: 'auto',
      source: SourceKind.derived,
      sourceRef: ref,
    ));

    final literals = _StringLiteralCollector();
    pending.body.accept(literals);
    final seenTargets = <String>{};
    for (final value in literals.values) {
      final target = result.pathToScreen[value];
      if (target == null || target == pending.screenId) continue;
      if (!seenTargets.add(target)) continue;
      result.edges.add(GraphEdge(
        from: decisionId,
        to: target,
        trigger: 'auto',
        condition: 'redirect',
        source: SourceKind.derived,
        sourceRef: ref,
      ));
    }
  }

  // Pass 2b — Navigations-Aufrufe (context.go/push/goNamed/pushNamed/replace).
  String? classToScreen(String className) =>
      manualScreenClasses[className] ??
      extraClassToScreen[className] ??
      result.builderClassToScreen[className];

  for (final file in files) {
    final collector = _NavCallCollector();
    file.unit.accept(collector);
    for (final call in collector.calls) {
      // Erstes positionales Argument muss ein String-Literal sein.
      Expression? first;
      for (final arg in call.argumentList.arguments) {
        if (arg is Expression) {
          first = arg;
          break;
        }
      }
      if (first is! StringLiteral) continue;
      final literal = first.stringValue;
      if (literal == null) continue;

      final where = '${file.relPath}:${file.lineOf(call.offset)}';
      final methodName = call.methodName.name;
      final String? to;
      if (_navByName.contains(methodName)) {
        to = result.nameToScreen[literal];
      } else {
        // Query-Anteil ignorieren ('/login?next=…').
        to = result.pathToScreen[literal.split('?').first];
      }
      if (to == null) {
        warn('Hinweis: $where: $methodName("$literal") entspricht keiner '
            'bekannten Route — Kante verworfen.');
        continue;
      }

      final enclosing = _enclosingClassOf(call);
      final from = enclosing == null ? null : classToScreen(enclosing.namePart.typeName.lexeme);
      if (from == null) {
        warn('Hinweis: $where: $methodName("$literal") keinem Screen '
            'zuordenbar (umschließende Klasse unbekannt) — Kante verworfen.');
        continue;
      }

      result.edges.add(GraphEdge(
        from: from,
        to: to,
        trigger: 'tap',
        source: SourceKind.derived,
        sourceRef: file.refAt(call.offset, symbol: enclosing!.namePart.typeName.lexeme),
      ));
    }
  }

  return result;
}
