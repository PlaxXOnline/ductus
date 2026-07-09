import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  SCHEMA_VERSION,
  isSupportedSchemaVersion,
  journeyGraphJsonSchema,
  parseSchemaVersion,
  type JourneyGraph,
} from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(journeyGraphJsonSchema);

const minimalGraph: JourneyGraph = {
  schemaVersion: SCHEMA_VERSION,
  flows: [],
  nodes: [],
  edges: [],
};

const fullGraph: JourneyGraph = {
  schemaVersion: SCHEMA_VERSION,
  app: { name: 'MyApp', platforms: ['android', 'ios', 'web'], locale: 'de' },
  flows: [{ id: 'auth', title: 'Anmeldung & Registrierung', start: 'login', description: 'Auth-Flow' }],
  nodes: [
    {
      id: 'login',
      type: 'screen',
      title: 'Anmeldung',
      flow: 'auth',
      description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
      source: 'annotation',
      sourceRef: { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
      tags: ['auth', 'entry'],
    },
    { id: 'dashboard', type: 'screen', title: 'Dashboard', source: 'derived' },
    { id: 'auth_check', type: 'decision', title: 'Eingeloggt?', source: 'derived' },
    { id: 'submit-login', type: 'action', label: 'Anmelden', source: 'annotation' },
  ],
  edges: [
    {
      id: 'e_login_dashboard',
      from: 'login',
      to: 'dashboard',
      trigger: 'tap',
      label: 'Anmelden',
      condition: 'Zugangsdaten gültig',
      source: 'annotation',
    },
  ],
  meta: { adapters: [{ name: 'dart', version: '0.1.0' }] },
};

describe('journey-graph JSON schema', () => {
  it('akzeptiert einen minimalen Graphen', () => {
    expect(validate(minimalGraph)).toBe(true);
  });

  it('akzeptiert einen vollständigen Graphen', () => {
    const ok = validate(fullGraph);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('erlaubt unbekannte Zusatzfelder (vorwärtskompatibel, NFR7)', () => {
    expect(validate({ ...minimalGraph, futureField: 42 })).toBe(true);
  });

  it.each([
    ['schemaVersion fehlt', { flows: [], nodes: [], edges: [] }],
    ['schemaVersion falsches Format', { ...minimalGraph, schemaVersion: 'v1' }],
    ['nodes fehlt', { schemaVersion: '1.0', flows: [], edges: [] }],
    [
      'screen ohne title (V4)',
      { ...minimalGraph, nodes: [{ id: 'a', type: 'screen', source: 'derived' }] },
    ],
    [
      'decision ohne title (V4)',
      { ...minimalGraph, nodes: [{ id: 'a', type: 'decision', source: 'derived' }] },
    ],
    [
      'action ohne label (V4)',
      { ...minimalGraph, nodes: [{ id: 'a', type: 'action', source: 'annotation' }] },
    ],
    [
      'node ohne source (A1)',
      { ...minimalGraph, nodes: [{ id: 'a', type: 'screen', title: 'A' }] },
    ],
    [
      'ungültiger node type',
      { ...minimalGraph, nodes: [{ id: 'a', type: 'page', title: 'A', source: 'derived' }] },
    ],
    [
      'edge ohne from',
      { ...minimalGraph, edges: [{ id: 'e', to: 'b', source: 'annotation' }] },
    ],
    [
      'ungültiger trigger',
      {
        ...minimalGraph,
        edges: [{ id: 'e', from: 'a', to: 'b', trigger: 'hover', source: 'annotation' }],
      },
    ],
    [
      'flow ohne start',
      { ...minimalGraph, flows: [{ id: 'f', title: 'F' }] },
    ],
    ['leere node id', { ...minimalGraph, nodes: [{ id: '', type: 'screen', title: 'A', source: 'derived' }] }],
  ])('lehnt ab: %s', (_name, doc) => {
    expect(validate(doc)).toBe(false);
  });
});

describe('schema version helpers', () => {
  it('parst major.minor', () => {
    expect(parseSchemaVersion('1.0')).toEqual({ major: 1, minor: 0 });
    expect(parseSchemaVersion('12.34')).toEqual({ major: 12, minor: 34 });
    expect(parseSchemaVersion('1')).toBeNull();
    expect(parseSchemaVersion('1.0.0')).toBeNull();
    expect(parseSchemaVersion('a.b')).toBeNull();
  });

  it('akzeptiert gleiche Major, lehnt fremde Major ab (V6, NFR7)', () => {
    expect(isSupportedSchemaVersion('1.0')).toBe(true);
    expect(isSupportedSchemaVersion('1.7')).toBe(true);
    expect(isSupportedSchemaVersion('2.0')).toBe(false);
    expect(isSupportedSchemaVersion('0.9')).toBe(false);
    expect(isSupportedSchemaVersion('kaputt')).toBe(false);
  });
});

describe('eingecheckte schema-Datei', () => {
  it('ist synchron mit src/json-schema.ts (npm run gen:schema)', () => {
    const onDisk = JSON.parse(
      readFileSync(join(__dirname, '..', 'schema', 'journey-graph.schema.json'), 'utf8'),
    );
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(journeyGraphJsonSchema)));
  });
});
