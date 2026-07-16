import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, defaultConfigYaml, loadConfig } from '../../src/config.js';

const tmpRoots: string[] = [];

/** Writes a config into a fresh temp directory and returns the path. */
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
  it('parses a full example with all sections (app/adapters/llm/style/output) correctly', () => {
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
        '    generator: journey       # journey | starlight | docusaurus',
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
      // Defaults for fields not named in the spec config:
      maxTokens: 2048,
      faithfulnessThreshold: 0,
    });
    expect(config.style).toEqual({ voice: 'formal-sie', granularity: 'flow' });
    expect(config.output).toEqual({
      format: 'mdx',
      dir: 'docs/',
      website: { generator: 'journey', diagrams: true },
    });
    expect(config.rootDir).toBe(join(path, '..'));
  });

  it('fills all defaults for a minimal config', () => {
    const { config } = loadConfig(writeConfig(MINIMAL));
    expect(config.app.locale).toBe('en');
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
    expect(config.style).toEqual({ voice: 'en-you', granularity: 'flow' });
    expect(config.output).toEqual({
      format: 'mdx',
      dir: 'docs/',
      // The default generator is 'journey'; 'starlight' remains selectable.
      website: { generator: 'journey', diagrams: true },
    });
  });

  it('supports single-key-map and name: formats incl. extra passthrough', () => {
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

  it('flattens a literal extra: block (path D: fromBuilder ends up top-level)', () => {
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

    // No double nesting { extra: { fromBuilder } } — the adapter reads the
    // key top-level from the --config JSON; a nested {"extra": {...}} would
    // be silently ignored.
    expect(config.adapters).toEqual([
      { name: 'dart', project: '.', extra: { fromBuilder: true } },
    ]);
  });

  it('merges an extra: block with flat unknown keys; flat wins', () => {
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

  it('throws ConfigError when extra: is not a map', () => {
    const path = writeConfig(
      ['app:', '  name: MyApp', 'adapters:', '  - dart:', '      extra: 42', ''].join('\n'),
    );
    expect(() => loadConfig(path)).toThrowError(ConfigError);
    expect(() => loadConfig(path)).toThrowError(/extra.*must be a map/);
  });

  it('throws ConfigError on broken YAML', () => {
    const path = writeConfig('app:\n  name: [unclosed\n');
    expect(() => loadConfig(path)).toThrowError(ConfigError);
    expect(() => loadConfig(path)).toThrowError(/Invalid YAML/);
  });

  it('throws ConfigError on missing required fields', () => {
    expect(() => loadConfig(writeConfig('adapters:\n  - dart:\n'))).toThrowError(/"app"/);
    expect(() =>
      loadConfig(writeConfig('app:\n  locale: de\nadapters:\n  - dart:\n')),
    ).toThrowError(/app\.name/);
    expect(() => loadConfig(writeConfig('app:\n  name: X\n'))).toThrowError(/adapters/);
    expect(() => loadConfig(writeConfig('app:\n  name: X\nadapters: []\n'))).toThrowError(
      ConfigError,
    );
  });

  it('throws ConfigError with a precise message on invalid enum values', () => {
    const path = writeConfig(`${MINIMAL}llm:\n  provider: gpt5\n`);
    expect(() => loadConfig(path)).toThrowError(/llm\.provider.*anthropic \| openai \| mistral \| custom \| mock/);
  });

  it('accepts all LLM provider enum values', () => {
    for (const provider of ['anthropic', 'openai', 'mistral', 'custom', 'mock'] as const) {
      const baseUrl = provider === 'custom' ? '\n  baseUrl: http://localhost:8080/v1' : '';
      const { config } = loadConfig(writeConfig(`${MINIMAL}llm:\n  provider: ${provider}${baseUrl}\n`));
      expect(config.llm.provider).toBe(provider);
    }
  });

  it('accepts all website generator enum values and rejects unknown ones', () => {
    // 'starlight' remains selectable next to the default 'journey' …
    for (const generator of ['journey', 'starlight', 'docusaurus'] as const) {
      const { config } = loadConfig(
        writeConfig(`${MINIMAL}output:\n  format: website\n  website:\n    generator: ${generator}\n`),
      );
      // … 'docusaurus' passes the config level but is only rejected by the
      // pipeline (phase-1 guard in runGenerate, exit 3).
      expect(config.output.website.generator).toBe(generator);
    }

    const invalid = writeConfig(`${MINIMAL}output:\n  website:\n    generator: hugo\n`);
    expect(() => loadConfig(invalid)).toThrowError(ConfigError);
    expect(() => loadConfig(invalid)).toThrowError(
      /output\.website\.generator.*journey \| starlight \| docusaurus/,
    );
  });

  it('reports unknown top-level keys as a warning, not an error', () => {
    const { config, warnings } = loadConfig(writeConfig(`${MINIMAL}banana: true\n`));
    expect(config.app.name).toBe('MiniApp');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('banana');
  });

  it('requires baseUrl for provider custom', () => {
    expect(() => loadConfig(writeConfig(`${MINIMAL}llm:\n  provider: custom\n`))).toThrowError(
      /llm\.baseUrl/,
    );
  });
});

describe('defaultConfigYaml', () => {
  it('produces a commented template that loadConfig accepts', () => {
    const yaml = defaultConfigYaml({ appName: 'DemoApp', deriveFrom: ['go_router'] });
    expect(yaml).toContain('# anthropic | openai | mistral | custom | mock');
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

  it('produces a typescript template with adapter-specific deriveFrom defaults', () => {
    const yaml = defaultConfigYaml({ appName: 'web-app', adapter: 'typescript' });
    expect(yaml).toContain('- typescript:');
    expect(yaml).toContain('deriveFrom: [react-router, next]');

    const { config, warnings } = loadConfig(writeConfig(yaml));
    expect(warnings).toEqual([]);
    expect(config.adapters[0]).toEqual({
      name: 'typescript',
      project: '.',
      deriveFrom: ['react-router', 'next'],
    });
  });
});
