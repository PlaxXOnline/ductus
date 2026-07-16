#!/usr/bin/env node
/**
 * Fake adapter for integration tests of the adapter contract: emits a fixed,
 * valid graph on stdout. The mode is selected via an extra argument BEFORE the
 * options appended by the runner:
 *   fail          → exit 1 with stderr diagnostics
 *   badjson       → stdout is not JSON
 *   invalid       → JSON, but violates the graph schema
 *   dangling      → schema-valid graph with a dangling edge (V1 error in core)
 *   futureversion → schema-valid graph with schemaVersion "2.0" (V6 error in core)
 *   pubnoise      → valid graph, but with leading pub diagnostic lines on
 *                   stdout (simulates `dart pub global run` with a path activation)
 *   flowfull      → valid graph, both screens belong to the flow "auth"
 *                   (main path with 2 nodes for `graph --journey`)
 * The content of the --config file is always mirrored to stderr so tests can
 * inspect the temporary adapter configuration (deriveFrom/extra).
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
    process.stderr.write(`fake-adapter: cannot read config (${error.message})\n`);
  }
}

if (mode === 'fail') {
  process.stderr.write('fake-adapter: intentional failure for tests\n');
  process.exit(1);
}
if (mode === 'badjson') {
  process.stdout.write('this is not JSON {');
  process.exit(0);
}
if (mode === 'invalid') {
  // Syntactically JSON, but nodes must be an array (schema violation, A3).
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
  // Assign dashboard to the flow as well → login→dashboard lies within the flow segment.
  graph.nodes[0].flow = 'auth';
}
if (mode === 'futureversion') {
  // Schema-valid (pattern ^\d+\.\d+$), but incompatible major ⇒ V6 in core.
  graph.schemaVersion = '2.0';
}

if (mode === 'pubnoise') {
  // Exactly the kind of preamble pub writes to stdout before the actual
  // program (observed with `dart pub global run` and a path activation).
  process.stdout.write('Resolving dependencies...\nDownloading packages...\nGot dependencies.\n');
}

process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
