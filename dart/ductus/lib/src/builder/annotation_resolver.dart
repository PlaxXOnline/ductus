/// Weg D — Auflösung nicht-literaler konstanter Annotation-Argumente.
///
/// Baut über den build_runner-Resolver einen Index aller konstant
/// aufgelösten Ductus-Annotationen, adressiert über (Datei, Quell-Offset der
/// Annotation) — die Offsets der resolved AST sind identisch mit denen der
/// parse-only gelesenen [ScannedFile]s, weil beide aus demselben Inhalt
/// entstehen. Der parse-only-Extraktor fragt den Index nur dort, wo ein
/// Argument nicht literal lesbar ist (Paritätsgarantie).
library;

import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:analyzer/dart/constant/value.dart';
import 'package:build/build.dart';
import 'package:source_gen/source_gen.dart';

import '../adapter/annotation_extractor.dart';
import '../adapter/scanner.dart';

/// Bibliothek, in der die Ductus-Annotationen DEKLARIERT sind (TypeChecker
/// vergleicht gegen die deklarierende Bibliothek, nicht gegen den Export
/// `package:ductus/ductus.dart`).
const String _annotationsLibrary = 'package:ductus/src/annotations.dart';

/// Ductus-Annotationstypen per Bibliotheks-URI — robust gegen gleichnamige
/// Fremdklassen (nur für echte Ductus-Annotationen werden Werte aufgelöst;
/// alles andere fällt auf die parse-only-Semantik zurück).
const TypeChecker _journeyChecker = TypeChecker.any([
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyScreen'),
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyAction'),
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyDecision'),
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyFlow'),
]);

const TypeChecker _triggerChecker =
    TypeChecker.fromUrl('$_annotationsLibrary#JourneyTrigger');

/// Baut den Auflösungs-Index für alle [files] des Zielpakets.
///
/// Nicht auflösbare Bibliotheken (z. B. fehlende Abhängigkeiten oder
/// Syntaxfehler) werden übersprungen — der Extraktor diagnostiziert dann
/// unverändert parse-only (gleiche Meldungsformate).
Future<AnnotationResolution> resolveJourneyAnnotations(
  BuildStep buildStep,
  List<ScannedFile> files,
) async {
  final resolver = buildStep.resolver;
  final package = buildStep.inputId.package;
  final byFile = <String, Map<int, DartObject>>{};

  for (final file in files) {
    final assetId = AssetId(package, file.relPath);
    try {
      // part-Dateien sind keine eigenständigen Bibliotheken; ihre
      // Annotationen werden über die Fragmente der Bibliothek erfasst.
      if (!await resolver.isLibrary(assetId)) continue;
      final library =
          await resolver.libraryFor(assetId, allowSyntaxErrors: true);
      for (final fragment in library.fragments) {
        final unit = await resolver.astNodeFor(fragment, resolve: true);
        if (unit is! CompilationUnit) continue;
        final fragmentAsset = AssetId.resolve(fragment.source.uri);
        if (fragmentAsset.package != package) continue;
        unit.accept(_AnnotationIndexer(
            byFile.putIfAbsent(fragmentAsset.path, () => {})));
      }
    } on Object {
      // Auflösung fehlgeschlagen ⇒ parse-only-Fallback für diese Datei.
      continue;
    }
  }
  return _ResolvedAnnotationValues(byFile);
}

/// Sammelt die konstanten Werte aller Ductus-Annotationen einer resolved
/// CompilationUnit, indiziert über den Quell-Offset des Annotation-Knotens.
class _AnnotationIndexer extends RecursiveAstVisitor<void> {
  final Map<int, DartObject> index;

  _AnnotationIndexer(this.index);

  @override
  void visitAnnotation(Annotation node) {
    final value = node.elementAnnotation?.computeConstantValue();
    final type = value?.type;
    if (value != null && type != null && _journeyChecker.isExactlyType(type)) {
      index[node.offset] = value;
    }
    super.visitAnnotation(node);
  }
}

class _ResolvedAnnotationValues implements AnnotationResolution {
  /// relPath -> (Annotation-Offset -> konstanter Annotationswert).
  final Map<String, Map<int, DartObject>> _byFile;

  const _ResolvedAnnotationValues(this._byFile);

  ConstantReader? _field(ScannedFile file, Annotation annotation, String key) {
    final object = _byFile[file.relPath]?[annotation.offset];
    if (object == null) return null;
    return ConstantReader(object).peek(key);
  }

  @override
  String? stringValue(ScannedFile file, Annotation annotation, String key) {
    final reader = _field(file, annotation, key);
    return reader != null && reader.isString ? reader.stringValue : null;
  }

  @override
  List<String>? stringListValue(
      ScannedFile file, Annotation annotation, String key) {
    final reader = _field(file, annotation, key);
    if (reader == null || !reader.isList) return null;
    final values = <String>[];
    for (final element in reader.listValue) {
      final value = element.toStringValue();
      if (value == null) return null;
      values.add(value);
    }
    return values;
  }

  @override
  String? triggerValue(ScannedFile file, Annotation annotation, String key) {
    final reader = _field(file, annotation, key);
    if (reader == null || reader.isNull) return null;
    final type = reader.objectValue.type;
    if (type == null || !_triggerChecker.isExactlyType(type)) return null;
    // revive() liefert den Zugriffspfad des Enum-Werts, z. B.
    // 'JourneyTrigger.tap' — der Name nach dem Punkt ist der Trigger.
    final accessor = reader.revive().accessor;
    final dot = accessor.lastIndexOf('.');
    return dot >= 0 ? accessor.substring(dot + 1) : accessor;
  }
}
