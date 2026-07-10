/// Programmatischer Zugriff auf den Ductus-Dart-Adapter (dieselbe Analyse,
/// die auch das Adapter-CLI `dart run ductus:adapter` ausführt).
///
/// Bewusst getrennt von `package:ductus/ductus.dart`: Die Annotationen
/// bleiben abhängigkeitsfrei; nur diese Bibliothek zieht analyzer & Co.
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
