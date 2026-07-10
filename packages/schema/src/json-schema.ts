/**
 * JSON Schema (Draft 2020-12) für das Ductus-Graph-Schema — die einzige
 * Vertragsfläche zwischen Adaptern und Core.
 *
 * Quelle der Wahrheit für die Struktur-Validierung. Die eingecheckte Datei
 * `schema/journey-graph.schema.json` wird hieraus generiert (`npm run gen:schema`);
 * ein Test stellt sicher, dass beide synchron sind.
 *
 * `additionalProperties` bleibt erlaubt: unbekannte Felder sind vorwärtskompatibel
 * (NFR7) und werden vom Core nur als Warnung behandelt, nie als Fehler.
 */

const sourceRef = {
  type: 'object',
  required: ['file'],
  properties: {
    file: { type: 'string', minLength: 1 },
    line: { type: 'integer', minimum: 1 },
    symbol: { type: 'string' },
  },
} as const;

export const journeyGraphJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ductus.dev/schema/journey-graph-1.0.json',
  title: 'Ductus Journey Graph',
  description:
    'Gerichteter Graph der User-Journey einer App: Screens, Actions, Decisions und Transitions.',
  type: 'object',
  required: ['schemaVersion', 'flows', 'nodes', 'edges'],
  properties: {
    schemaVersion: { type: 'string', pattern: '^\\d+\\.\\d+$' },
    app: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 },
        platforms: { type: 'array', items: { type: 'string' } },
        locale: { type: 'string' },
      },
    },
    flows: { type: 'array', items: { $ref: '#/$defs/flow' } },
    nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
    meta: {
      type: 'object',
      properties: {
        generatedAt: { type: 'string' },
        adapters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'version'],
            properties: {
              name: { type: 'string', minLength: 1 },
              version: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  },
  $defs: {
    sourceRef,
    node: {
      type: 'object',
      required: ['id', 'type', 'source'],
      properties: {
        id: { type: 'string', minLength: 1 },
        type: { enum: ['screen', 'action', 'decision'] },
        title: { type: 'string' },
        label: { type: 'string' },
        flow: { type: 'string' },
        description: { type: 'string' },
        source: { enum: ['annotation', 'derived'] },
        sourceRef: { $ref: '#/$defs/sourceRef' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      allOf: [
        {
          // V4: title Pflicht für screen/decision
          if: { properties: { type: { enum: ['screen', 'decision'] } } },
          then: { required: ['title'] },
        },
        {
          // V4: label Pflicht für action
          if: { properties: { type: { const: 'action' } } },
          then: { required: ['label'] },
        },
      ],
    },
    edge: {
      type: 'object',
      required: ['id', 'from', 'to', 'source'],
      properties: {
        id: { type: 'string', minLength: 1 },
        from: { type: 'string', minLength: 1 },
        to: { type: 'string', minLength: 1 },
        trigger: { enum: ['tap', 'submit', 'auto', 'back', 'deeplink', 'system'] },
        label: { type: 'string' },
        condition: { type: 'string' },
        source: { enum: ['annotation', 'derived'] },
        sourceRef: { $ref: '#/$defs/sourceRef' },
      },
    },
    flow: {
      type: 'object',
      required: ['id', 'title', 'start'],
      properties: {
        id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        start: { type: 'string', minLength: 1 },
        description: { type: 'string' },
      },
    },
  },
} as const;
