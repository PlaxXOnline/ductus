/// Path D — resolution of non-literal constant annotation arguments.
///
/// Builds, via the build_runner resolver, an index of all constant-resolved
/// Ductus annotations, addressed by (file, source offset of the annotation)
/// — the offsets of the resolved AST are identical to those of the
/// parse-only [ScannedFile]s because both originate from the same content.
/// The parse-only extractor only queries the index where an argument is not
/// readable as a literal (parity guarantee).
library;

import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:analyzer/dart/constant/value.dart';
import 'package:build/build.dart';
import 'package:source_gen/source_gen.dart';

import '../adapter/annotation_extractor.dart';
import '../adapter/scanner.dart';

/// Library in which the Ductus annotations are DECLARED (TypeChecker
/// compares against the declaring library, not against the export
/// `package:ductus/ductus.dart`).
const String _annotationsLibrary = 'package:ductus/src/annotations.dart';

/// Ductus annotation types by library URI — robust against foreign classes
/// of the same name (values are only resolved for genuine Ductus
/// annotations; everything else falls back to parse-only semantics).
const TypeChecker _journeyChecker = TypeChecker.any([
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyScreen'),
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyAction'),
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyDecision'),
  TypeChecker.fromUrl('$_annotationsLibrary#JourneyFlow'),
]);

const TypeChecker _triggerChecker =
    TypeChecker.fromUrl('$_annotationsLibrary#JourneyTrigger');

/// Builds the resolution index for all [files] of the target package.
///
/// Unresolvable libraries (e.g. missing dependencies or syntax errors) are
/// skipped — the extractor then diagnoses parse-only as before (same
/// message formats).
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
      // part files are not standalone libraries; their annotations are
      // captured via the library's fragments.
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
      // Resolution failed ⇒ parse-only fallback for this file.
      continue;
    }
  }
  return _ResolvedAnnotationValues(byFile);
}

/// Collects the constant values of all Ductus annotations of a resolved
/// CompilationUnit, indexed by the source offset of the annotation node.
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
  /// relPath -> (annotation offset -> constant annotation value).
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
    // revive() yields the access path of the enum value, e.g.
    // 'JourneyTrigger.tap' — the name after the dot is the trigger.
    final accessor = reader.revive().accessor;
    final dot = accessor.lastIndexOf('.');
    return dot >= 0 ? accessor.substring(dot + 1) : accessor;
  }
}
