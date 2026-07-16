/**
 * Path A — comment convention `@journey:<type>` in `//` comments;
 * syntax and semantics identical to the Dart adapter
 * (dart/ductus/lib/src/adapter/comment_parser.dart).
 */

import { ManualExtraction } from './candidates.js';
import {
  componentDeclarations,
  enclosingComponent,
  nextComponentAfter,
} from './declarations.js';
import { SourceKind, validTriggers, type GraphNode } from './graph-model.js';
import type { ScannedFile } from './scanner.js';

const BLOCK_TYPES = new Set(['screen', 'action', 'decision', 'flow']);

const KNOWN_KEYS: Record<string, Set<string>> = {
  screen: new Set(['id', 'title', 'flow', 'description', 'tags']),
  action: new Set(['label', 'to', 'from', 'id', 'trigger', 'condition']),
  decision: new Set(['id', 'title', 'flow', 'description', 'tags']),
  flow: new Set(['id', 'title', 'start', 'description']),
};

const REQUIRED_KEYS: Record<string, string[]> = {
  screen: ['id', 'title'],
  action: ['label', 'to'],
  decision: ['id', 'title'],
  flow: ['id', 'title', 'start'],
};

const JOURNEY_START = /@journey:([A-Za-z_-]+)/;
// key="value" — \" escapes a quote inside the value.
const PAIR = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;

/** A raw `@journey:` block: type, raw text, start line (1-based). */
export interface RawBlock {
  type: string;
  text: string;
  line: number;
}

/**
 * Splits a file line by line into `@journey:` blocks: start in a comment
 * line, continuation in immediately following comment lines, end at a
 * non-comment line or a new `@journey:` block.
 */
export function splitBlocks(content: string): RawBlock[] {
  const lines = content.split('\n');
  const blocks: RawBlock[] = [];
  let type: string | undefined;
  let buffer: string[] = [];
  let startLine = 0;

  const flush = (): void => {
    if (type !== undefined) {
      blocks.push({ type, text: buffer.join('\n'), line: startLine });
    }
    type = undefined;
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart();
    if (!trimmed.startsWith('//')) {
      flush();
      continue;
    }
    // Comment content without the leading slashes.
    const body = trimmed.replace(/^\/{2,}/, '');
    const match = JOURNEY_START.exec(body);
    if (match !== null) {
      flush();
      type = match[1]!;
      startLine = i + 1;
      buffer = [body.slice(match.index + match[0].length)];
    } else if (type !== undefined) {
      buffer.push(body);
    }
  }
  flush();
  return blocks;
}

function unescape(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      out += raw[i + 1];
      i++;
    } else {
      out += raw[i];
    }
  }
  return out;
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/**
 * Parses all `@journey:` blocks of a file. Warnings (unknown keys, unknown
 * triggers/types) go through `warn`; fatal problems (missing required
 * fields, unresolvable `from`) end up in `errors`.
 */
export function parseComments(
  file: ScannedFile,
  warn: (message: string) => void,
  errors: string[],
): ManualExtraction {
  const result = new ManualExtraction();
  const declarations = componentDeclarations(file.sourceFile);

  for (const block of splitBlocks(file.content)) {
    const where = `${file.relPath}:${block.line}`;
    if (!BLOCK_TYPES.has(block.type)) {
      warn(`Warning: ${where}: unknown @journey type "${block.type}" — block ignored.`);
      continue;
    }

    const values = new Map<string, string>();
    for (const m of block.text.matchAll(PAIR)) {
      const key = m[1]!;
      if (!KNOWN_KEYS[block.type]!.has(key)) {
        warn(`Warning: ${where}: unknown key "${key}" in @journey:${block.type} — ignored.`);
        continue;
      }
      values.set(key, unescape(m[2]!));
    }

    const missing = REQUIRED_KEYS[block.type]!.filter((k) => !values.has(k));
    if (missing.length > 0) {
      errors.push(`${where}: @journey:${block.type} is missing required fields: ${missing.join(', ')}.`);
      continue;
    }

    const blockOffset = file.offsetOfLine(block.line);
    const enclosing = enclosingComponent(declarations, blockOffset);

    switch (block.type) {
      case 'screen':
      case 'decision': {
        // Attach the block to a component: enclosing or directly below.
        const component = enclosing ?? nextComponentAfter(declarations, blockOffset);
        const symbol = component?.name;
        const tags = values.get('tags');
        const node: GraphNode = {
          id: values.get('id')!,
          type: block.type as 'screen' | 'decision',
          title: values.get('title')!,
          ...(values.has('flow') ? { flow: values.get('flow')! } : {}),
          ...(values.has('description') ? { description: values.get('description')! } : {}),
          tags: tags !== undefined ? splitTags(tags) : [],
          source: SourceKind.annotation,
          sourceRef: {
            file: file.relPath,
            line: block.line,
            ...(symbol !== undefined ? { symbol } : {}),
          },
        };
        result.nodes.push(node);
        if (block.type === 'screen' && symbol !== undefined && !result.screenSymbols.has(symbol)) {
          result.screenSymbols.set(symbol, node.id);
        }
        break;
      }
      case 'action': {
        let trigger = values.get('trigger') ?? 'tap';
        if (!validTriggers.has(trigger)) {
          warn(`Warning: ${where}: unknown trigger "${trigger}" — using "tap".`);
          trigger = 'tap';
        }
        if (!values.has('from') && enclosing === undefined) {
          errors.push(
            `${where}: @journey:action without "from" and without an enclosing component — cannot determine "from".`,
          );
          continue;
        }
        result.actions.push({
          ...(values.has('id') ? { id: values.get('id')! } : {}),
          label: values.get('label')!,
          to: values.get('to')!,
          ...(values.has('from') ? { from: values.get('from')! } : {}),
          trigger,
          ...(values.has('condition') ? { condition: values.get('condition')! } : {}),
          ...(enclosing !== undefined ? { enclosingName: enclosing.name } : {}),
          sourceRef: {
            file: file.relPath,
            line: block.line,
            ...(enclosing !== undefined ? { symbol: enclosing.name } : {}),
          },
        });
        break;
      }
      case 'flow': {
        result.flows.push({
          id: values.get('id')!,
          title: values.get('title')!,
          start: values.get('start')!,
          ...(values.has('description') ? { description: values.get('description')! } : {}),
          source: SourceKind.annotation,
          sourceRef: { file: file.relPath, line: block.line },
        });
        break;
      }
    }
  }
  return result;
}
