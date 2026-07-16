/// build_runner entry point for the Ductus journey builder (path D).
///
/// Deliberately separate from `package:ductus/ductus.dart`: the annotations
/// stay free of build/source_gen dependencies; only this library (and
/// `package:ductus/adapter.dart`) pulls in the analysis infrastructure.
library;

export 'src/builder/journey_builder.dart'
    show DuctusJourneyBuilder, ductusJourneyBuilder;
