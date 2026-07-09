/// build_runner-Einstiegspunkt für den Ductus-Journey-Builder (Weg D).
///
/// Bewusst getrennt von `package:ductus/ductus.dart`: die Annotationen
/// bleiben frei von build-/source_gen-Abhängigkeiten; nur diese Bibliothek
/// (und `package:ductus/adapter.dart`) zieht die Analyse-Infrastruktur.
library;

export 'src/builder/journey_builder.dart'
    show DuctusJourneyBuilder, ductusJourneyBuilder;
