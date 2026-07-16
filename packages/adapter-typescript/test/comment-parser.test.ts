/**
 * Path A — comment convention `@journey:<type>`. Semantic mirror of
 * dart/ductus/test/comment_parser_test.dart, adapted to TS components.
 */

import { describe, expect, it } from 'vitest';
import { parseComments } from '../src/comment-parser.js';
import { scanSource, WarnLog } from './test-util.js';

describe('parseComments', () => {
  it('parses a screen block with escapes in the value', () => {
    const file = scanSource(
      '// @journey:screen id="login" title="Sag \\"Hallo\\"" description="Erster Schritt." tags="auth, entry"\n' +
        'class LoginScreen {}\n',
    );
    const warn = new WarnLog();
    const errors: string[] = [];
    const result = parseComments(file, warn.call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.id).toBe('login');
    expect(node.title).toBe('Sag "Hallo"');
    expect(node.description).toBe('Erster Schritt.');
    expect(node.tags).toEqual(['auth', 'entry']);
    expect(node.type).toBe('screen');
    expect(node.source).toBe('annotation');
    expect(node.sourceRef.file).toBe('src/test.tsx');
    expect(node.sourceRef.line).toBe(1);
    expect(node.sourceRef.symbol).toBe('LoginScreen');
    expect(Object.fromEntries(result.screenSymbols)).toEqual({ LoginScreen: 'login' });
  });

  it('multi-line blocks: continuation in following comment lines', () => {
    const file = scanSource(
      [
        '// @journey:screen id="dashboard" title="Übersicht"',
        '//   description="Zentrale Übersicht nach der Anmeldung."',
        '//   flow="main"',
        'class DashboardScreen {}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.description).toBe('Zentrale Übersicht nach der Anmeldung.');
    expect(result.nodes[0]!.flow).toBe('main');
  });

  it('block ends at a non-comment line', () => {
    const file = scanSource(
      [
        '// @journey:screen id="a" title="A"',
        'const x = 1;',
        '// description="gehört nicht mehr zum Block"',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.description).toBeUndefined();
  });

  it('block ends at a new @journey: block', () => {
    const file = scanSource(
      [
        '// @journey:screen id="a" title="A"',
        '// @journey:screen id="b" title="B"',
        'class Foo {}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('unknown keys: warning, value is ignored', () => {
    const file = scanSource(
      ['// @journey:screen id="a" title="A" farbe="blau"', 'class Foo {}', ''].join('\n'),
    );
    const warn = new WarnLog();
    const errors: string[] = [];
    const result = parseComments(file, warn.call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('a');
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('farbe');
    expect(warn.messages[0]).toContain('src/test.tsx:1');
  });

  it('a missing required field is an error', () => {
    const file = scanSource(['// @journey:screen id="a"', 'class Foo {}', ''].join('\n'));
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(result.nodes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('title');
    expect(errors[0]).toContain('src/test.tsx:1');
  });

  it('flow block with all required fields', () => {
    const file = scanSource(
      [
        '// @journey:flow id="auth" title="Anmeldung" start="login"',
        '//   description="Alles rund um die Anmeldung."',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.flows).toHaveLength(1);
    const flow = result.flows[0]!;
    expect(flow.id).toBe('auth');
    expect(flow.start).toBe('login');
    expect(flow.description).toBe('Alles rund um die Anmeldung.');
    expect(flow.source).toBe('annotation');
    expect(flow.sourceRef).toEqual({ file: 'src/test.tsx', line: 1 });
  });

  it('action without from remembers the enclosing component', () => {
    const file = scanSource(
      [
        '// @journey:screen id="login" title="Anmeldung"',
        'class LoginScreen {',
        '  // @journey:action label="Anmelden" to="dashboard" trigger="submit"',
        '  onSubmit() {}',
        '}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.from).toBeUndefined();
    expect(action.enclosingName).toBe('LoginScreen');
    expect(action.trigger).toBe('submit');
    expect(action.sourceRef).toEqual({ file: 'src/test.tsx', line: 3, symbol: 'LoginScreen' });
  });

  it('action without from and without an enclosing component is an error', () => {
    const file = scanSource(
      ['// @journey:action label="Anmelden" to="dashboard"', 'function onSubmit() {}', ''].join(
        '\n',
      ),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(result.actions).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/test.tsx:1');
    expect(errors[0]).toContain('from');
  });

  it('from inference end to end via the screenSymbols table', () => {
    // Comment screen above the component + action inside the component:
    // the component is known as a screen, its id becomes the from.
    const file = scanSource(
      [
        '// @journey:screen id="login" title="Anmeldung"',
        'function LoginScreen() {',
        '  // @journey:action label="Anmelden" to="dashboard"',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    const screenId = result.screenSymbols.get(result.actions[0]!.enclosingName!);
    expect(screenId).toBe('login');
  });

  it('unknown trigger: warning and default tap', () => {
    const file = scanSource(
      [
        'class LoginScreen {',
        '  // @journey:action label="Anmelden" to="dashboard" trigger="wisch"',
        '  onSubmit() {}',
        '}',
        '',
      ].join('\n'),
    );
    const warn = new WarnLog();
    const errors: string[] = [];
    const result = parseComments(file, warn.call, errors);

    expect(errors).toEqual([]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.trigger).toBe('tap');
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('wisch');
  });

  it('unknown @journey type: warning, block ignored', () => {
    const file = scanSource(['// @journey:seite id="a" title="A"', 'class Foo {}', ''].join('\n'));
    const warn = new WarnLog();
    const errors: string[] = [];
    const result = parseComments(file, warn.call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('seite');
  });

  // ─── TS-specific component binding ──────────────────────────────────────

  it('binds the screen block to a function component below it', () => {
    const file = scanSource(
      [
        '// @journey:screen id="login" title="Anmeldung"',
        'function LoginScreen() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    const node = result.nodes[0]!;
    expect(node.sourceRef).toEqual({ file: 'src/test.tsx', line: 1, symbol: 'LoginScreen' });
    expect(result.screenSymbols.get('LoginScreen')).toBe('login');
  });

  it('binds the screen block to a const arrow component below it', () => {
    const file = scanSource(
      ['// @journey:screen id="login" title="Anmeldung"', 'const LoginScreen = () => null;', ''].join(
        '\n',
      ),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes[0]!.sourceRef.symbol).toBe('LoginScreen');
    expect(result.screenSymbols.get('LoginScreen')).toBe('login');
  });

  it('binds the screen block to a class below it', () => {
    const file = scanSource(
      [
        '// @journey:screen id="login" title="Anmeldung"',
        'class LoginScreen extends React.Component {}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes[0]!.sourceRef.symbol).toBe('LoginScreen');
    expect(result.screenSymbols.get('LoginScreen')).toBe('login');
  });

  it('binds a screen block inside a component to the enclosing one', () => {
    const file = scanSource(
      [
        'function LoginScreen() {',
        '  // @journey:screen id="login" title="Anmeldung" tags=" auth ,, entry "',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(errors).toEqual([]);
    const node = result.nodes[0]!;
    expect(node.sourceRef).toEqual({ file: 'src/test.tsx', line: 2, symbol: 'LoginScreen' });
    // tags splitting: trimmed, empty entries dropped.
    expect(node.tags).toEqual(['auth', 'entry']);
    expect(result.screenSymbols.get('LoginScreen')).toBe('login');
  });
});

describe('parseComments — line counting (review regression)', () => {
  it('U+2028 in a string does not shift the component mapping', () => {
    // TypeScript's line map counts U+2028 as a line break, the line-based
    // parser does not — the block mapping must follow the '\n' counting.
    // The U+2028 sits BEFORE the block in a different component: with the
    // TS line map, the block offset would slip into AScreen and the screen
    // would wrongly be attributed to AScreen.
    const source = [
      'export function AScreen() {',
      "  const weird = 'vor nach';",
      '  return null;',
      '}',
      '// @journey:screen id="login" title="Anmeldung"',
      'export function LoginScreen() {',
      '  return null;',
      '}',
      '',
    ].join('\n');
    const errors: string[] = [];
    const result = parseComments(scanSource(source), new WarnLog().call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.sourceRef.symbol).toBe('LoginScreen');
    expect(result.nodes[0]!.sourceRef.line).toBe(5);
    expect(result.screenSymbols.get('LoginScreen')).toBe('login');
  });
});
