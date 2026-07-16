/// Path A — comment convention `@journey:<type>` in `//` and `///`
/// comments; semantically equivalent to the Dart annotations (path B).
library;

import 'package:analyzer/dart/ast/ast.dart';

import 'candidates.dart';
import 'graph_model.dart';
import 'scanner.dart';

const _blockTypes = {'screen', 'action', 'decision', 'flow'};

const _knownKeys = {
  'screen': {'id', 'title', 'flow', 'description', 'tags'},
  'action': {'label', 'to', 'from', 'id', 'trigger', 'condition'},
  'decision': {'id', 'title', 'flow', 'description', 'tags'},
  'flow': {'id', 'title', 'start', 'description'},
};

const _requiredKeys = {
  'screen': ['id', 'title'],
  'action': ['label', 'to'],
  'decision': ['id', 'title'],
  'flow': ['id', 'title', 'start'],
};

final _journeyStart = RegExp(r'@journey:([A-Za-z_-]+)');
// key="value" — \" escapes a quote inside the value.
final _pair = RegExp(r'([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"');

/// A raw `@journey:` block: type, raw text, start line (1-based).
class RawBlock {
  final String type;
  final String text;
  final int line;

  const RawBlock({required this.type, required this.text, required this.line});
}

/// Splits a file line-by-line into `@journey:` blocks: start in a comment
/// line, continuation in immediately following comment lines, end at a
/// non-comment line or a new `@journey:` block.
List<RawBlock> splitBlocks(String content) {
  final lines = content.split('\n');
  final blocks = <RawBlock>[];
  String? type;
  StringBuffer? buffer;
  int startLine = 0;

  void flush() {
    if (type != null) {
      blocks.add(RawBlock(type: type!, text: buffer.toString(), line: startLine));
    }
    type = null;
    buffer = null;
  }

  for (var i = 0; i < lines.length; i++) {
    final trimmed = lines[i].trimLeft();
    if (!trimmed.startsWith('//')) {
      flush();
      continue;
    }
    // Comment content without leading slashes.
    final body = trimmed.replaceFirst(RegExp(r'^/{2,}'), '');
    final match = _journeyStart.firstMatch(body);
    if (match != null) {
      flush();
      type = match.group(1)!;
      startLine = i + 1;
      buffer = StringBuffer(body.substring(match.end));
    } else if (buffer != null) {
      buffer!.write('\n');
      buffer!.write(body);
    }
  }
  flush();
  return blocks;
}

String _unescape(String raw) {
  final out = StringBuffer();
  for (var i = 0; i < raw.length; i++) {
    if (raw[i] == r'\' && i + 1 < raw.length) {
      out.write(raw[i + 1]);
      i++;
    } else {
      out.write(raw[i]);
    }
  }
  return out.toString();
}

List<String> _splitTags(String value) => value
    .split(',')
    .map((t) => t.trim())
    .where((t) => t.isNotEmpty)
    .toList();

/// Smallest enclosing class declaration for an offset. Doc comments (`///`)
/// belong to the AST node, `//` comments do not — hence additionally
/// [nextClassAfter] for blocks above a class.
ClassDeclaration? _enclosingClass(CompilationUnit unit, int offset) {
  for (final decl in unit.declarations) {
    if (decl is ClassDeclaration && decl.offset <= offset && offset < decl.end) {
      return decl;
    }
  }
  return null;
}

ClassDeclaration? _nextClassAfter(CompilationUnit unit, int offset) {
  ClassDeclaration? best;
  for (final decl in unit.declarations) {
    if (decl is ClassDeclaration && decl.end > offset) {
      if (best == null || decl.offset < best.offset) best = decl;
    }
  }
  return best;
}

/// Parses all `@journey:` blocks of a file. Warnings (unknown keys, unknown
/// triggers/types) via [warn]; fatal problems (missing required fields,
/// unresolvable `from`) go into [errors].
ManualExtraction parseComments(
  ScannedFile file,
  void Function(String) warn,
  List<String> errors,
) {
  final result = ManualExtraction();

  for (final block in splitBlocks(file.content)) {
    final where = '${file.relPath}:${block.line}';
    if (!_blockTypes.contains(block.type)) {
      warn('Warning: $where: unknown @journey type "${block.type}" — '
          'block ignored.');
      continue;
    }

    final values = <String, String>{};
    for (final m in _pair.allMatches(block.text)) {
      final key = m.group(1)!;
      if (!_knownKeys[block.type]!.contains(key)) {
        warn('Warning: $where: unknown key "$key" in '
            '@journey:${block.type} — ignored.');
        continue;
      }
      values[key] = _unescape(m.group(2)!);
    }

    final missing = _requiredKeys[block.type]!
        .where((k) => !values.containsKey(k))
        .toList();
    if (missing.isNotEmpty) {
      errors.add('$where: @journey:${block.type} is missing required fields: '
          '${missing.join(', ')}.');
      continue;
    }

    final blockOffset = file.lineInfo.getOffsetOfLine(block.line - 1);
    final enclosing = _enclosingClass(file.unit, blockOffset);

    switch (block.type) {
      case 'screen':
      case 'decision':
        // Attribute the block to a class: enclosing or directly above.
        final cls = enclosing ?? _nextClassAfter(file.unit, blockOffset);
        final symbol = cls?.namePart.typeName.lexeme;
        final node = GraphNode(
          id: values['id']!,
          type: block.type,
          title: values['title'],
          flow: values['flow'],
          description: values['description'],
          tags: values.containsKey('tags') ? _splitTags(values['tags']!) : const [],
          source: SourceKind.annotation,
          sourceRef:
              SourceRef(file: file.relPath, line: block.line, symbol: symbol),
        );
        result.nodes.add(node);
        if (block.type == 'screen' && symbol != null) {
          result.screenClassNames.putIfAbsent(symbol, () => node.id);
        }
      case 'action':
        var trigger = values['trigger'] ?? 'tap';
        if (!validTriggers.contains(trigger)) {
          warn('Warning: $where: unknown trigger "$trigger" — '
              'using "tap".');
          trigger = 'tap';
        }
        if (values['from'] == null && enclosing == null) {
          errors.add('$where: @journey:action without "from" and without an '
              'enclosing class — cannot determine "from".');
          continue;
        }
        result.actions.add(ActionCandidate(
          id: values['id'],
          label: values['label']!,
          to: values['to']!,
          from: values['from'],
          trigger: trigger,
          condition: values['condition'],
          enclosingClassName: enclosing?.namePart.typeName.lexeme,
          sourceRef: SourceRef(
            file: file.relPath,
            line: block.line,
            symbol: enclosing?.namePart.typeName.lexeme,
          ),
        ));
      case 'flow':
        result.flows.add(GraphFlow(
          id: values['id']!,
          title: values['title'],
          start: values['start'],
          description: values['description'],
          source: SourceKind.annotation,
          sourceRef: SourceRef(file: file.relPath, line: block.line),
        ));
    }
  }
  return result;
}
