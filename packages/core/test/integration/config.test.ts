import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, defaultConfigYaml, loadConfig } from '../../src/config.js';

const tmpRoots: string[] = [];

/** Schreibt eine Config in ein frisches Temp-Verzeichnis und liefert den Pfad. */
function writeConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-config-test-'));
  tmpRoots.push(dir);
  const path = join(dir, 'ductus.config.yaml');
  writeFileSync(path, yaml, 'utf8');
  return path;
}

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

const MINIMAL = ['app:', '  name: MiniApp', 'adapters:', '  - dart:', ''].join('\n');

describe('loadConfig', () => {
  it('parst das Vollbeispiel aus SPEC §10.2 korrekt', () => {
    const path = writeConfig(
      [
        'app:',
        '  name: MyApp',
        '  locale: de',
        'adapters:',
        '  - dart:',
        '      project: .',
        '      deriveFrom: [go_router, auto_route]',
        'llm:',
        '  provider: anthropic        # anthropic | openai | custom',
        '  model: claude-sonnet-4-5',
        '  apiKeyEnv: DUCTUS_LLM_API_KEY',
        '  temperature: 0.2',
        '  faithfulnessCheck: true',
        'style:',
        '  voice: formal-sie          # formal-sie | informal-du | en-you',
        '  granularity: flow          # flow | screen',
        'output:',
        '  format: mdx                # mdx | website',
        '  dir: docs/',
        '  website:',
        '    generator: starlight     # starlight | docusaurus',
        '    diagrams: true',
        '',
      ].join('\n'),
    );

    const { config, warnings } = loadConfig(path);
    expect(warnings).toEqual([]);
    expect(config.app).toEqual({ name: 'MyApp', locale: 'de' });
    expect(config.adapters).toEqual([
      { name: 'dart', project: '.', deriveFrom: ['go_router', 'auto_route'] },
    ]);
    expect(config.llm).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyEnv: 'DUCTUS_LLM_API_KEY',
      temperature: 0.2,
      faithfulnessCheck: true,
      // Defaults für in der Spec-Config nicht genannte Felder:
      maxTokens: 2048,
      faithfulnessThreshold: 0,
    });
    expect(config.style).toEqual({ voice: 'formal-sie', granularity: 'flow' });
    expect(config.output).toEqual({
      format: 'mdx',
      dir: 'docs/',
      website: { generator: 'starlight', diagrams: true },
    });
    expect(config.rootDir).toBe(join(path, '..'));
  });

  it('füllt alle Defaults bei minimaler Config', () => {
    const { config } = loadConfig(writeConfig(MINIMAL));
    expect(config.app.locale).toBe('de');
    expect(config.adapters).toEqual([{ name: 'dart', project: '.' }]);
    expect(config.llm).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyEnv: 'DUCTUS_LLM_API_KEY',
      temperature: 0.2,
      maxTokens: 2048,
      faithfulnessCheck: true,
      faithfulnessThreshold: 0,
    });
    expect(config.style).toEqual({ voice: 'formal-sie', granularity: 'flow' });
    expect(config.output).toEqual({
      format: 'mdx',
      dir: 'docs/',
      website: { generator: 'starlight', diagrams: true },
    });
  });

  it('unterstützt Ein-Schlüssel-Map- und name:-Format inkl. extra-Durchreichung', () => {
    const { config } = loadConfig(
      writeConfig(
        [
          'app:',
          '  name: MyApp',
          'adapters:',
          '  - dart:',
          '      project: apps/mobile',
          '      include: [lib/**]',
          '  - name: custom-adapter',
          '    project: tools',
          '    command: my-adapter --fast',
          '    special: 42',
          '',
        ].join('\n'),
      ),
    );

    expect(config.adapters).toEqual([
      { name: 'dart', project: 'apps/mobile', extra: { include: ['lib/**'] } },
      {
        name: 'custom-adapter',
        project: 'tools',
        command: 'my-adapter --fast',
        extra: { special: 42 },
      },
    ]);
  });

  it('flacht einen literalen extra:-Block ab (Weg D: fromBuilder landet top-level)', () => {
    const { config } = loadConfig(
      writeConfig(
        [
          'app:',
          '  name: MyApp',
          'adapters:',
          '  - dart:',
          '      project: .',
          '      extra: { fromBuilder: true }',
          '',
        ].join('\n'),
      ),
    );

    // Keine doppelte Verschachtelung { extra: { fromBuilder } } — der Adapter
    // liest den Schlüssel top-level aus der --config-JSON (DD §N).
    expect(config.adapters).toEqual([
      { name: 'dart', project: '.', extra: { fromBuilder: true } },
    ]);
  });

  it('extra:-Block und flache unbekannte Schlüssel mischen; flach gewinnt', () => {
    const { config } = loadConfig(
      writeConfig(
        [
          'app:',
          '  name: MyApp',
          'adapters:',
          '  - dart:',
          '      extra:',
          '        fromBuilder: true',
          '        special: 1',
          '      special: 2',
          '',
        ].join('\n'),
      ),
    );

    expect(config.adapters).toEqual([
      { name: 'dart', project: '.', extra: { fromBuilder: true, special: 2 } },
    ]);
  });

  it('wirft ConfigError, wenn extra: keine Map ist', () => {
    const path = writeConfig(
      ['app:', '  name: MyApp', 'adapters:', '  - dart:', '      extra: 42', ''].join('\n'),
    );
    expect(() => loadConfig(path)).toThrowError(ConfigError);
    expect(() => loadConfig(path)).toThrowError(/extra.*muss eine Map/);
  });

  it('wirft ConfigError bei kaputtem YAML', () => {
    const path = writeConfig('app:\n  name: [unclosed\n');
    expect(() => loadConfig(path)).toThrowError(ConfigError);
    expect(() => loadConfig(path)).toThrowError(/Ungültiges YAML/);
  });

  it('wirft ConfigError bei fehlenden Pflichtfeldern', () => {
    expect(() => loadConfig(writeConfig('adapters:\n  - dart:\n'))).toThrowError(/"app"/);
    expect(() =>
      loadConfig(writeConfig('app:\n  locale: de\nadapters:\n  - dart:\n')),
    ).toThrowError(/app\.name/);
    expect(() => loadConfig(writeConfig('app:\n  name: X\n'))).toThrowError(/adapters/);
    expect(() => loadConfig(writeConfig('app:\n  name: X\nadapters: []\n'))).toThrowError(
      ConfigError,
    );
  });

  it('wirft ConfigError bei ungültigen Enum-Werten mit präziser Meldung', () => {
    const path = writeConfig(`${MINIMAL}llm:\n  provider: gpt5\n`);
    expect(() => loadConfig(path)).toThrowError(/llm\.provider.*anthropic \| openai \| custom \| mock/);
  });

  it('meldet unbekannte Top-Level-Schlüssel als Warnung, nicht als Fehler', () => {
    const { config, warnings } = loadConfig(writeConfig(`${MINIMAL}banana: true\n`));
    expect(config.app.name).toBe('MiniApp');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('banana');
  });

  it('verlangt baseUrl für provider custom', () => {
    expect(() => loadConfig(writeConfig(`${MINIMAL}llm:\n  provider: custom\n`))).toThrowError(
      /llm\.baseUrl/,
    );
  });
});

describe('defaultConfigYaml', () => {
  it('erzeugt eine kommentierte Vorlage, die loadConfig akzeptiert', () => {
    const yaml = defaultConfigYaml({ appName: 'DemoApp', deriveFrom: ['go_router'] });
    expect(yaml).toContain('# anthropic | openai | custom | mock');
    expect(yaml).toContain('name: DemoApp');
    expect(yaml).toContain('deriveFrom: [go_router]');

    const { config, warnings } = loadConfig(writeConfig(yaml));
    expect(warnings).toEqual([]);
    expect(config.app.name).toBe('DemoApp');
    expect(config.adapters[0]).toEqual({
      name: 'dart',
      project: '.',
      deriveFrom: ['go_router'],
    });
  });
});
