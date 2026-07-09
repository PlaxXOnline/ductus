import { describe, expect, it } from 'vitest';
import type { GraphSegment, LlmConfig, LlmRequest } from '../../src/contracts.js';
import { buildGenerationPrompt } from '../../src/llm/prompts.js';
import { createProvider } from '../../src/llm/providers.js';

const mockConfig: LlmConfig = {
  provider: 'mock',
  model: 'mock-1',
  apiKeyEnv: 'UNUSED',
  temperature: 0,
  maxTokens: 1000,
  faithfulnessCheck: true,
  faithfulnessThreshold: 0,
};

const segment: GraphSegment = {
  id: 'auth',
  kind: 'flow',
  title: 'Anmeldung',
  order: 1,
  nodes: [
    { id: 'dashboard', type: 'screen', title: 'Dashboard', source: 'derived' },
    {
      id: 'login',
      type: 'screen',
      title: 'Login',
      description: 'Anmeldebildschirm.',
      source: 'derived',
    },
  ],
  edges: [
    {
      id: 'e1',
      from: 'login',
      to: 'dashboard',
      trigger: 'tap',
      label: 'Anmelden',
      condition: 'Zugangsdaten gültig',
      source: 'annotation',
    },
  ],
  exits: [
    {
      edge: { id: 'e2', from: 'dashboard', to: 'settings', trigger: 'tap', source: 'derived' },
      toTitle: 'Einstellungen',
    },
  ],
};

function generationRequest(): LlmRequest {
  const { system, messages } = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' });
  return { system, messages, maxTokens: 1000, temperature: 0 };
}

describe('mock-Provider', () => {
  it('ist deterministisch: gleicher Input ⇒ identischer Output', async () => {
    const provider = createProvider(mockConfig, {});
    const a = await provider.complete(generationRequest());
    const b = await provider.complete(generationRequest());
    expect(a.text).toBe(b.text);
    expect(a.usage).toEqual(b.usage);
  });

  it('baut aus dem Segment-JSON ein einfaches Markdown mit Schritten und Bildschirmen', async () => {
    const provider = createProvider(mockConfig, {});
    const result = await provider.complete(generationRequest());

    expect(result.text).toContain('„Anmeldung“');
    expect(result.text).toContain('## Schritte');
    expect(result.text).toContain('1. **Anmelden**: Login → Dashboard (Zugangsdaten gültig)');
    expect(result.text).toContain('## Bildschirme');
    expect(result.text).toContain('- **Login** — Anmeldebildschirm.');
    expect(result.text).toContain('- **Dashboard**');
    // Kein H1, beginnt mit Einleitungssatz.
    expect(result.text.startsWith('#')).toBe(false);
    expect(result.usage!.inputTokens).toBeGreaterThan(0);
    expect(result.usage!.outputTokens).toBeGreaterThan(0);
  });

  it('antwortet auf den Judge-Marker exakt mit {"violations": []}', async () => {
    const provider = createProvider(mockConfig, {});
    const result = await provider.complete({
      system: 'FAITHFULNESS-JUDGE: prüfe den Text.',
      messages: [{ role: 'user', content: 'irgendwas' }],
      maxTokens: 100,
      temperature: 0,
    });
    expect(result.text).toBe('{"violations": []}');
  });
});
