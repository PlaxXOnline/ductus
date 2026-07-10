#!/usr/bin/env node
/**
 * Fake-Adapter für Integrationstests des Adapter-Vertrags: emittiert einen festen,
 * validen Graphen auf stdout. Modus über ein zusätzliches Argument VOR den
 * vom Runner angehängten Optionen:
 *   fail          → Exit 1 mit stderr-Diagnostik
 *   badjson       → stdout ist kein JSON
 *   invalid       → JSON, verletzt aber das Graph-Schema
 *   dangling      → schema-valider Graph mit dangling edge (V1-Fehler im Core)
 *   futureversion → schema-valider Graph mit schemaVersion "2.0" (V6-Fehler im Core)
 *   pubnoise      → valider Graph, aber mit führenden pub-Diagnosezeilen auf
 *                   stdout (simuliert `dart pub global run` bei path-Aktivierung)
 *   flowfull      → valider Graph, beide Screens gehören zum Flow "auth"
 *                   (Hauptpfad mit 2 Knoten für `graph --journey`)
 * Der Inhalt der --config-Datei wird immer auf stderr gespiegelt, damit
 * Tests die temporäre Adapter-Konfiguration (deriveFrom/extra) prüfen können.
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode =
  args.find((a) =>
    ['fail', 'badjson', 'invalid', 'dangling', 'futureversion', 'pubnoise', 'flowfull'].includes(a),
  ) ?? 'ok';

const configIndex = args.indexOf('--config');
if (configIndex !== -1 && args[configIndex + 1] !== undefined) {
  try {
    process.stderr.write(`fake-adapter config: ${readFileSync(args[configIndex + 1], 'utf8')}\n`);
  } catch (error) {
    process.stderr.write(`fake-adapter: Config nicht lesbar (${error.message})\n`);
  }
}

if (mode === 'fail') {
  process.stderr.write('fake-adapter: absichtlicher Fehler für Tests\n');
  process.exit(1);
}
if (mode === 'badjson') {
  process.stdout.write('das ist kein JSON {');
  process.exit(0);
}
if (mode === 'invalid') {
  // Syntaktisch JSON, aber nodes muss ein Array sein (Schema-Verstoß, A3).
  process.stdout.write(JSON.stringify({ schemaVersion: '1.0', flows: [], nodes: 'nope', edges: [] }));
  process.exit(0);
}

const graph = {
  schemaVersion: '1.0',
  flows: [{ id: 'auth', title: 'Anmeldung', start: 'login' }],
  nodes: [
    {
      id: 'dashboard',
      type: 'screen',
      title: 'Dashboard',
      description: 'Übersicht nach der Anmeldung.',
      source: 'derived',
    },
    {
      id: 'login',
      type: 'screen',
      title: 'Login',
      flow: 'auth',
      description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
      source: 'derived',
      sourceRef: { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
    },
  ],
  edges: [
    {
      id: 'e_login_dashboard',
      from: 'login',
      to: 'dashboard',
      trigger: 'tap',
      label: 'Anmelden',
      source: 'annotation',
    },
  ],
  meta: { adapters: [{ name: 'fake', version: '1.0.0' }] },
};

if (mode === 'dangling') {
  graph.edges.push({ id: 'e_bad', from: 'login', to: 'missing', source: 'derived' });
}
if (mode === 'flowfull') {
  // Dashboard ebenfalls dem Flow zuordnen → login→dashboard liegt im Flow-Segment.
  graph.nodes[0].flow = 'auth';
}
if (mode === 'futureversion') {
  // Schema-valide (Pattern ^\d+\.\d+$), aber inkompatibler Major ⇒ V6 im Core.
  graph.schemaVersion = '2.0';
}

if (mode === 'pubnoise') {
  // Exakt die Art Vorspann, die pub vor dem eigentlichen Programm auf stdout
  // schreibt (beobachtet bei `dart pub global run` mit path-Aktivierung).
  process.stdout.write('Resolving dependencies...\nDownloading packages...\nGot dependencies.\n');
}

process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
