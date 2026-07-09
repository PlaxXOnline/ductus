/** Generiert schema/journey-graph.schema.json aus src/json-schema.ts. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journeyGraphJsonSchema } from '../src/json-schema.ts';

const outFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'journey-graph.schema.json');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(journeyGraphJsonSchema, null, 2) + '\n');
console.log(`geschrieben: ${outFile}`);
