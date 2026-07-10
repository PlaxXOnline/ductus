/**
 * Weg A — Kommentar-Konvention `@journey:<typ>`. Semantik-Spiegel von
 * dart/ductus/test/comment_parser_test.dart, angepasst an TS-Komponenten.
 */

import { describe, expect, it } from 'vitest';
import { parseComments } from '../src/comment-parser.js';
import { scanSource, WarnLog } from './test-util.js';

describe('parseComments', () => {
  it('parst einen Screen-Block mit Escapes im Wert', () => {
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

  it('mehrzeilige Blöcke: Fortsetzung in Folge-Kommentarzeilen', () => {
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

  it('Block endet an Nicht-Kommentar-Zeile', () => {
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

  it('Block endet an neuem @journey:-Block', () => {
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

  it('unbekannte Keys: Warnung, Wert wird ignoriert', () => {
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

  it('fehlendes Pflichtfeld ist ein Fehler', () => {
    const file = scanSource(['// @journey:screen id="a"', 'class Foo {}', ''].join('\n'));
    const errors: string[] = [];
    const result = parseComments(file, new WarnLog().call, errors);

    expect(result.nodes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('title');
    expect(errors[0]).toContain('src/test.tsx:1');
  });

  it('flow-Block mit allen Pflichtfeldern', () => {
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

  it('action ohne from merkt sich die umschließende Komponente', () => {
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

  it('action ohne from und ohne umschließende Komponente ist ein Fehler', () => {
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

  it('from-Inferenz Ende-zu-Ende über die screenSymbols-Tabelle', () => {
    // Kommentar-Screen oberhalb der Komponente + Action in der Komponente:
    // die Komponente ist als Screen bekannt, deren id wird zum from.
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

  it('unbekannter Trigger: Warnung und Default tap', () => {
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

  it('unbekannter @journey-Typ: Warnung, Block ignoriert', () => {
    const file = scanSource(['// @journey:seite id="a" title="A"', 'class Foo {}', ''].join('\n'));
    const warn = new WarnLog();
    const errors: string[] = [];
    const result = parseComments(file, warn.call, errors);

    expect(errors).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(warn.messages).toHaveLength(1);
    expect(warn.messages[0]).toContain('seite');
  });

  // ─── TS-spezifische Komponenten-Bindung ─────────────────────────────────

  it('bindet den Screen-Block an eine Funktionskomponente darunter', () => {
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

  it('bindet den Screen-Block an eine const-Arrow-Komponente darunter', () => {
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

  it('bindet den Screen-Block an eine Klasse darunter', () => {
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

  it('bindet den Screen-Block innerhalb einer Komponente an die umschließende', () => {
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
    // tags-Splitting: getrimmt, leere Einträge entfallen.
    expect(node.tags).toEqual(['auth', 'entry']);
    expect(result.screenSymbols.get('LoginScreen')).toBe('login');
  });
});

describe('parseComments — Zeilen-Zählung (Review-Regression)', () => {
  it('U+2028 in einem String verschiebt die Komponenten-Zuordnung nicht', () => {
    // TypeScripts Line-Map zählt U+2028 als Zeilenumbruch, der zeilenbasierte
    // Parser nicht — die Block-Zuordnung muss der '\n'-Zählung folgen.
    // Das U+2028 liegt VOR dem Block in einer anderen Komponente: mit der
    // TS-Line-Map würde der Block-Offset in AScreen hineinrutschen und der
    // Screen fälschlich AScreen zugeordnet.
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
