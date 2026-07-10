/// Weg A — Kommentar-Konvention `@journey:<typ>` in `//`- und
/// `///`-Kommentaren; inhaltlich gleichwertig zu den Dart-Annotationen (Weg B).
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
// key="value" — \" escaped ein Anführungszeichen im Wert.
final _pair = RegExp(r'([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"');

/// Ein roher `@journey:`-Block: Typ, Rohtext, Startzeile (1-basiert).
class RawBlock {
  final String type;
  final String text;
  final int line;

  const RawBlock({required this.type, required this.text, required this.line});
}

/// Zerlegt eine Datei zeilenbasiert in `@journey:`-Blöcke: Start in einer
/// Kommentarzeile, Fortsetzung in unmittelbar folgenden Kommentarzeilen,
/// Ende an Nicht-Kommentar-Zeile oder neuem `@journey:`-Block.
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
    // Kommentar-Inhalt ohne führende Slashes.
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

/// Kleinste umschließende Klassendeklaration für einen Offset. Doc-Kommentare
/// (`///`) gehören zum AST-Knoten, `//`-Kommentare nicht — deshalb zusätzlich
/// [nextClassAfter] für Blöcke oberhalb einer Klasse.
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

/// Parst alle `@journey:`-Blöcke einer Datei. Warnungen (unbekannte Keys,
/// unbekannte Trigger/Typen) via [warn]; fatale Probleme (fehlende
/// Pflichtfelder, nicht auflösbares `from`) landen in [errors].
ManualExtraction parseComments(
  ScannedFile file,
  void Function(String) warn,
  List<String> errors,
) {
  final result = ManualExtraction();

  for (final block in splitBlocks(file.content)) {
    final where = '${file.relPath}:${block.line}';
    if (!_blockTypes.contains(block.type)) {
      warn('Warnung: $where: unbekannter @journey-Typ "${block.type}" — '
          'Block wird ignoriert.');
      continue;
    }

    final values = <String, String>{};
    for (final m in _pair.allMatches(block.text)) {
      final key = m.group(1)!;
      if (!_knownKeys[block.type]!.contains(key)) {
        warn('Warnung: $where: unbekannter Key "$key" in '
            '@journey:${block.type} — wird ignoriert.');
        continue;
      }
      values[key] = _unescape(m.group(2)!);
    }

    final missing = _requiredKeys[block.type]!
        .where((k) => !values.containsKey(k))
        .toList();
    if (missing.isNotEmpty) {
      errors.add('$where: @journey:${block.type} fehlen Pflichtfelder: '
          '${missing.join(', ')}.');
      continue;
    }

    final blockOffset = file.lineInfo.getOffsetOfLine(block.line - 1);
    final enclosing = _enclosingClass(file.unit, blockOffset);

    switch (block.type) {
      case 'screen':
      case 'decision':
        // Block einer Klasse zuordnen: umschließend oder direkt darüber.
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
          warn('Warnung: $where: unbekannter trigger "$trigger" — '
              'verwende "tap".');
          trigger = 'tap';
        }
        if (values['from'] == null && enclosing == null) {
          errors.add('$where: @journey:action ohne "from" und ohne '
              'umschließende Klasse — "from" nicht bestimmbar.');
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
