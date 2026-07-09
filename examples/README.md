# Ductus — Beispiel-Apps

Zwei minimale Flutter-Apps, die die drei Eingabewege von Ductus (SPEC §5)
demonstrieren. Beide erzeugen mit `ductus extract` einen validierten
`journey-graph.json` und mit `ductus generate` (BYOK) Endnutzer-Doku als MDX.

| Demo | Zeigt | Kern-Punkt |
|---|---|---|
| [`flutter_go_router_demo/`](flutter_go_router_demo/) | **Weg C** (automatische Ableitung aus go_router) + **Weg B** (Dart-Annotationen) | Dashboard/Settings sind unannotiert und stammen rein aus der Routing-Ableitung; Login/Register werden per `@JourneyScreen`/`@JourneyAction` angereichert. |
| [`flutter_comment_demo/`](flutter_comment_demo/) | **Weg A** (Kommentar-Konvention `@journey:`) | Komplett buildfrei — keine `ductus`-Dependency, kein Router-Paket; der ganze Graph kommt aus Kommentarblöcken. |

Details und Befehle stehen im README der jeweiligen Demo.
