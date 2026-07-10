/**
 * BYOK-LLM-Provider: Anthropic, OpenAI, OpenAI-kompatible
 * Endpunkte (custom) und ein deterministischer Mock — über natives fetch, ohne SDKs.
 *
 * NFR4: Der API-Key stammt aus der Umgebungsvariable `config.apiKeyEnv` und darf
 * in keiner Fehlermeldung auftauchen; HTTP-Fehlertexte werden defensiv bereinigt.
 */

import type { LlmConfig, LlmProvider, LlmRequest, LlmResponse, LlmUsage } from '../contracts.js';
import { estimateTokens } from './cost.js';
import { JUDGE_MARKER } from './prompts.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** 429/5xx: bis zu 2 Wiederholungen mit kurzem Backoff. */
const RETRY_DELAYS_MS = [200, 400];
const ERROR_BODY_MAX_CHARS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Entfernt den Key-Wert aus beliebigem Text, bevor er in eine Fehlermeldung gelangt. */
function scrubSecret(text: string, apiKey: string | undefined): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('***');
}

function requireApiKey(config: LlmConfig, env: NodeJS.ProcessEnv): string {
  const key = env[config.apiKeyEnv];
  if (!key) {
    // NFR4: nur den Variablennamen nennen, nie einen Wert.
    throw new Error(`Fehlender API-Key: Umgebungsvariable "${config.apiKeyEnv}" ist nicht gesetzt.`);
  }
  return key;
}

async function postJson(
  providerName: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  apiKey: string | undefined,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status >= 500;
    const delay = RETRY_DELAYS_MS[attempt];
    if (retryable && delay !== undefined) {
      await sleep(delay);
      continue;
    }
    const rawBody = await response.text().catch(() => '');
    const safeBody = scrubSecret(rawBody, apiKey).slice(0, ERROR_BODY_MAX_CHARS);
    throw new Error(`LLM-Provider "${providerName}": HTTP ${response.status}: ${safeBody}`);
  }
}

function readUsage(input: unknown, output: unknown): LlmUsage | undefined {
  return typeof input === 'number' && typeof output === 'number'
    ? { inputTokens: input, outputTokens: output }
    : undefined;
}

// ───────────────────────────────── Anthropic ─────────────────────────────────

function anthropicProvider(config: LlmConfig, apiKey: string): LlmProvider {
  return {
    name: 'anthropic',
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const data = (await postJson(
        'anthropic',
        ANTHROPIC_URL,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: config.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        apiKey,
      )) as {
        content?: Array<{ text?: unknown }>;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      const text = data.content?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error('LLM-Provider "anthropic": unerwartetes Antwortformat (content[0].text fehlt)');
      }
      const usage = readUsage(data.usage?.input_tokens, data.usage?.output_tokens);
      return { text, ...(usage ? { usage } : {}) };
    },
  };
}

// ─────────────────────── OpenAI & OpenAI-kompatibel (custom) ─────────────────

function openAiCompatibleProvider(
  name: string,
  url: string,
  config: LlmConfig,
  apiKey: string | undefined,
): LlmProvider {
  return {
    name,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      // Bei lokalen Endpunkten ohne Key entfällt der Authorization-Header.
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const data = (await postJson(
        name,
        url,
        headers,
        {
          model: config.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
        apiKey,
      )) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new Error(`LLM-Provider "${name}": unerwartetes Antwortformat (choices[0].message.content fehlt)`);
      }
      const usage = readUsage(data.usage?.prompt_tokens, data.usage?.completion_tokens);
      return { text, ...(usage ? { usage } : {}) };
    },
  };
}

// ───────────────────────────────── Mock ──────────────────────────────────────

interface MockNode {
  id: string;
  type?: string;
  title?: string;
  label?: string;
  description?: string;
}

interface MockEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  trigger?: string;
  condition?: string;
}

interface MockSegment {
  title?: string;
  nodes?: MockNode[];
  edges?: MockEdge[];
  exits?: Array<{ edge?: MockEdge; toTitle?: string }>;
}

/** Letzter ```json-Block der User-Nachricht — dort steht das echte Segment. */
function extractLastJsonBlock(text: string): string | undefined {
  const matches = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  return matches.at(-1)?.[1];
}

function buildMockMarkdown(request: LlmRequest): string {
  const userText = request.messages.map((m) => m.content).join('\n');
  const block = extractLastJsonBlock(userText);
  if (block === undefined) return 'Für dieses Segment liegen keine Graph-Daten vor.\n';
  let segment: MockSegment;
  try {
    segment = JSON.parse(block) as MockSegment;
  } catch {
    return 'Für dieses Segment liegen keine Graph-Daten vor.\n';
  }
  const nodes = segment.nodes ?? [];
  const edges = segment.edges ?? [];
  const exits = segment.exits ?? [];
  const nodeTitle = (id: string): string => {
    const node = nodes.find((n) => n.id === id);
    if (node) return node.title ?? node.label ?? node.id;
    const exit = exits.find((x) => x.edge?.to === id);
    return exit?.toTitle ?? id;
  };
  const lines: string[] = [`Dieser Abschnitt beschreibt den Bereich „${segment.title ?? 'Unbenannt'}“.`];
  if (edges.length > 0) {
    lines.push('', '## Schritte', '');
    edges.forEach((edge, index) => {
      const trigger = edge.label ?? edge.trigger ?? edge.id;
      const condition = edge.condition ? ` (${edge.condition})` : '';
      lines.push(`${index + 1}. **${trigger}**: ${nodeTitle(edge.from)} → ${nodeTitle(edge.to)}${condition}`);
    });
  }
  const screens = nodes.filter((n) => n.type === 'screen');
  if (screens.length > 0) {
    lines.push('', '## Bildschirme', '');
    for (const screen of screens) {
      const description = screen.description ? ` — ${screen.description}` : '';
      lines.push(`- **${screen.title ?? screen.id}**${description}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function mockProvider(): LlmProvider {
  return {
    name: 'mock',
    complete(request: LlmRequest): Promise<LlmResponse> {
      // Reine Funktion der Eingabe — kein Netz, kein Zufall, keine Zeit.
      const text = request.system.includes(JUDGE_MARKER)
        ? '{"violations": []}'
        : buildMockMarkdown(request);
      const inputTokens = estimateTokens(
        request.system + request.messages.map((m) => m.content).join('\n'),
      );
      return Promise.resolve({ text, usage: { inputTokens, outputTokens: estimateTokens(text) } });
    },
  };
}

// ───────────────────────────────── Factory ───────────────────────────────────

export function createProvider(config: LlmConfig, env: NodeJS.ProcessEnv = process.env): LlmProvider {
  switch (config.provider) {
    case 'anthropic':
      return anthropicProvider(config, requireApiKey(config, env));
    case 'openai':
      return openAiCompatibleProvider('openai', OPENAI_URL, config, requireApiKey(config, env));
    case 'custom': {
      const base = (config.baseUrl ?? '').replace(/\/+$/, '');
      if (!base) throw new Error('LLM-Provider "custom": baseUrl fehlt in der Konfiguration.');
      // Lokale Endpunkte brauchen keinen Key — dann ohne Authorization-Header.
      const apiKey = env[config.apiKeyEnv];
      return openAiCompatibleProvider('custom', `${base}/chat/completions`, config, apiKey || undefined);
    }
    case 'mock':
      return mockProvider();
  }
}
