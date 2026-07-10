# Ductus — Beispiel-Apps

Drei minimale Apps (zwei Flutter, eine React), die drei der vier Eingabewege
von Ductus demonstrieren (Weg A: Kommentar-Konvention, Weg B: Dart-Annotationen,
Weg C: automatische Routing-Ableitung). Alle erzeugen mit `ductus extract` einen validierten
`journey-graph.json` und mit `ductus generate` (BYOK) Endnutzer-Doku als MDX.

| Demo | Zeigt | Kern-Punkt |
|---|---|---|
| [`flutter_go_router_demo/`](flutter_go_router_demo/) | **Weg C** (automatische Ableitung aus go_router) + **Weg B** (Dart-Annotationen) | Dashboard/Settings sind unannotiert und stammen rein aus der Routing-Ableitung; Login/Register werden per `@JourneyScreen`/`@JourneyAction` angereichert. |
| [`flutter_comment_demo/`](flutter_comment_demo/) | **Weg A** (Kommentar-Konvention `@journey:`) | Komplett buildfrei — keine `ductus`-Dependency, kein Router-Paket; der ganze Graph kommt aus Kommentarblöcken. |
| [`react_router_demo/`](react_router_demo/) | **Weg C** (automatische Ableitung aus react-router) + **Weg A** (Kommentar-Konvention `@journey:`) | TypeScript/React statt Flutter: Dashboard/Settings stammen rein aus der Routing-Ableitung (inkl. Shell-Flow und redirect-Decision); Login/Register werden per `@journey:`-Kommentaren angereichert. |

Details und Befehle stehen im README der jeweiligen Demo.
