/// Path C — derivation from auto_route. Explicitly best effort (only
/// `@RoutePage()` screens and the path table, no navigation edges);
/// all elements carry `source: "derived"`.
library;

import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';

import 'derive_go_router.dart' show humanize;
import 'graph_model.dart';
import 'scanner.dart';

/// 'UserProfileScreen' -> 'user-profile' (Screen/Page suffix is dropped).
String screenIdFromClassName(String className) {
  var base = className;
  for (final suffix in ['Screen', 'Page']) {
    if (base.length > suffix.length && base.endsWith(suffix)) {
      base = base.substring(0, base.length - suffix.length);
      break;
    }
  }
  return _kebabCase(base);
}

String _kebabCase(String name) => name
    .replaceAllMapped(
        RegExp('(?<=[a-z0-9])[A-Z]'), (m) => '-${m.group(0)}')
    .toLowerCase();

class AutoRouteDerivation {
  final List<GraphNode> nodes = [];

  /// Widget class -> screen id (for the from mapping of navigation edges).
  final Map<String, String> classToScreen = {};

  /// Route path -> screen id (from `AutoRoute(page:, path:)` entries).
  final Map<String, String> pathToScreen = {};
}

class _AutoRouteEntryCollector extends RecursiveAstVisitor<void> {
  final List<ArgumentList> entries = [];

  @override
  void visitMethodInvocation(MethodInvocation node) {
    if (node.target == null && node.methodName.name == 'AutoRoute') {
      entries.add(node.argumentList);
    }
    super.visitMethodInvocation(node);
  }

  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) {
    if (node.constructorName.type.name.lexeme == 'AutoRoute') {
      entries.add(node.argumentList);
    }
    super.visitInstanceCreationExpression(node);
  }
}

/// `LoginRoute.page` -> 'LoginRoute' (generated route name).
String? _routeClassOfPageExpr(Expression expr) {
  if (expr is PrefixedIdentifier) return expr.prefix.name;
  if (expr is PropertyAccess) {
    final target = expr.target;
    if (target is Identifier) return target.name;
  }
  if (expr is Identifier) return expr.name;
  return null;
}

/// Derives screens from `@RoutePage()` classes; `AutoRoute(page:, path:)`
/// entries provide the path mapping.
AutoRouteDerivation deriveAutoRoute(
  List<ScannedFile> files,
  void Function(String) warn,
) {
  final result = AutoRouteDerivation();

  for (final file in files) {
    for (final decl in file.unit.declarations) {
      if (decl is! ClassDeclaration) continue;
      final hasRoutePage = decl.metadata.any((a) {
        final name = a.name;
        final simple = name is PrefixedIdentifier ? name.identifier.name : name.name;
        return simple == 'RoutePage';
      });
      if (!hasRoutePage) continue;

      final className = decl.namePart.typeName.lexeme;
      final id = screenIdFromClassName(className);
      result.nodes.add(GraphNode(
        id: id,
        type: 'screen',
        title: humanize(id),
        source: SourceKind.derived,
        sourceRef: file.refAt(decl.namePart.typeName.offset, symbol: className),
      ));
      result.classToScreen.putIfAbsent(className, () => id);
    }
  }

  // AutoRoute(page: LoginRoute.page, path: '/login') — the generated route
  // name is the class name without the Screen/Page suffix plus 'Route'.
  for (final file in files) {
    final collector = _AutoRouteEntryCollector();
    file.unit.accept(collector);
    for (final entry in collector.entries) {
      Expression? pageExpr;
      String? path;
      for (final arg in entry.arguments) {
        if (arg is! NamedArgument) continue;
        switch (arg.name.lexeme) {
          case 'page':
            pageExpr = arg.argumentExpression;
          case 'path':
            final expr = arg.argumentExpression;
            if (expr is StringLiteral) path = expr.stringValue;
        }
      }
      if (pageExpr == null || path == null) continue;
      final routeClass = _routeClassOfPageExpr(pageExpr);
      if (routeClass == null) continue;
      final base = routeClass.endsWith('Route')
          ? routeClass.substring(0, routeClass.length - 'Route'.length)
          : routeClass;
      final id = _kebabCase(base);
      // Only map if the screen actually exists (no dangling entries).
      if (result.nodes.any((n) => n.id == id)) {
        result.pathToScreen.putIfAbsent(path, () => id);
      }
    }
  }

  return result;
}
