/// Programmatic access to the Ductus Dart adapter (the same analysis the
/// adapter CLI `dart run ductus:adapter` performs).
///
/// Deliberately separate from `package:ductus/ductus.dart`: the annotations
/// stay dependency-free; only this library pulls in analyzer & friends.
library;

export 'src/adapter/annotation_extractor.dart';
export 'src/adapter/candidates.dart';
export 'src/adapter/comment_parser.dart';
export 'src/adapter/config.dart';
export 'src/adapter/derive_auto_route.dart';
export 'src/adapter/derive_go_router.dart';
export 'src/adapter/from_builder.dart';
export 'src/adapter/graph_model.dart';
export 'src/adapter/merger.dart';
export 'src/adapter/runner.dart';
export 'src/adapter/scanner.dart';
