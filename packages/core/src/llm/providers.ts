/**
 * BYOK LLM providers: Anthropic, OpenAI, Mistral, OpenAI-compatible
 * endpoints (custom) and a deterministic mock — via native fetch, no SDKs.
 *
 * NFR4: The API key comes from the environment variable `config.apiKeyEnv` and
 * must never appear in an error message; HTTP error bodies are scrubbed defensively.
 */

import type { LlmConfig, LlmProvider, LlmRequest, LlmResponse, LlmUsage } from '../contracts.js';
import { estimateTokens } from './cost.js';
import { JUDGE_MARKER } from './prompts.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
// Mistral's chat API is OpenAI-compatible (Bearer auth, choices/usage).
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';

/** 429/5xx: up to 2 retries with a short backoff. */
const RETRY_DELAYS_MS = [200, 400];
const ERROR_BODY_MAX_CHARS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Removes the key value from arbitrary text before it can reach an error message. */
function scrubSecret(text: string, apiKey: string | undefined): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('***');
}

function requireApiKey(config: LlmConfig, env: NodeJS.ProcessEnv): string {
  const key = env[config.apiKeyEnv];
  if (!key) {
    // NFR4: name only the variable, never a value.
    throw new Error(`Missing API key: environment variable "${config.apiKeyEnv}" is not set.`);
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
    throw new Error(`LLM provider "${providerName}": HTTP ${response.status}: ${safeBody}`);
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
          // Structured output: forced tool call — the API guarantees
          // schema-conformant JSON in the tool_use block.
          ...(request.responseFormat
            ? {
                tools: [
                  {
                    name: request.responseFormat.name,
                    // Default stays German — byte-identical requests for the German judge.
                    description:
                      request.responseFormat.description ??
                      'Strukturierte Antwort im vorgegebenen Schema.',
                    input_schema: request.responseFormat.schema,
                  },
                ],
                tool_choice: { type: 'tool', name: request.responseFormat.name },
              }
            : {}),
        },
        apiKey,
      )) as {
        content?: Array<{ type?: unknown; text?: unknown; input?: unknown }>;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      const usage = readUsage(data.usage?.input_tokens, data.usage?.output_tokens);
      if (request.responseFormat) {
        const toolUse = data.content?.find((block) => block.type === 'tool_use');
        if (toolUse?.input !== undefined) {
          return { text: JSON.stringify(toolUse.input), ...(usage ? { usage } : {}) };
        }
      }
      const text = data.content?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error('LLM provider "anthropic": unexpected response format (content[0].text missing)');
      }
      return { text, ...(usage ? { usage } : {}) };
    },
  };
}

// ──────────────── OpenAI, Mistral & OpenAI-compatible (custom) ───────────────

/**
 * response_format building block: OpenAI and Mistral guarantee schema-conformant
 * JSON via json_schema (strict); for custom endpoints json_schema is not
 * reliably available — there, conservative json_object (the parser catches the rest).
 */
function responseFormatBody(name: string, format: { name: string; schema: Record<string, unknown> }): Record<string, unknown> {
  if (name === 'openai' || name === 'mistral') {
    return {
      response_format: {
        type: 'json_schema',
        json_schema: { name: format.name, schema: format.schema, strict: true },
      },
    };
  }
  return { response_format: { type: 'json_object' } };
}

function openAiCompatibleProvider(
  name: string,
  url: string,
  config: LlmConfig,
  apiKey: string | undefined,
): LlmProvider {
  return {
    name,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      // For local endpoints without a key, the Authorization header is omitted.
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
          ...(request.responseFormat ? responseFormatBody(name, request.responseFormat) : {}),
        },
        apiKey,
      )) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new Error(`LLM provider "${name}": unexpected response format (choices[0].message.content missing)`);
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

/** Last ```json block of the user message — that is where the real segment lives. */
function extractLastJsonBlock(text: string): string | undefined {
  const matches = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  return matches.at(-1)?.[1];
}

/**
 * Stable marker of the English system prompt (prompts.ts, voice 'en-you').
 * The mock stays a pure function of the request: it mirrors the language the
 * prompt asks for — English for 'en-you', German otherwise (the German mock
 * output stands in for German LLM output in tests and demos; product data).
 */
const EN_SYSTEM_MARKER = 'You are a technical writer';

function buildMockMarkdown(request: LlmRequest): string {
  const en = request.system.includes(EN_SYSTEM_MARKER);
  const noData = en
    ? 'No graph data is available for this segment.\n'
    : 'Für dieses Segment liegen keine Graph-Daten vor.\n';
  const userText = request.messages.map((m) => m.content).join('\n');
  const block = extractLastJsonBlock(userText);
  if (block === undefined) return noData;
  let segment: MockSegment;
  try {
    segment = JSON.parse(block) as MockSegment;
  } catch {
    return noData;
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
  const lines: string[] = [
    en
      ? `This section describes the “${segment.title ?? 'Untitled'}” area.`
      : `Dieser Abschnitt beschreibt den Bereich „${segment.title ?? 'Unbenannt'}“.`,
  ];
  if (edges.length > 0) {
    lines.push('', en ? '## Steps' : '## Schritte', '');
    edges.forEach((edge, index) => {
      const trigger = edge.label ?? edge.trigger ?? edge.id;
      const condition = edge.condition ? ` (${edge.condition})` : '';
      lines.push(`${index + 1}. **${trigger}**: ${nodeTitle(edge.from)} → ${nodeTitle(edge.to)}${condition}`);
    });
  }
  const screens = nodes.filter((n) => n.type === 'screen');
  if (screens.length > 0) {
    lines.push('', en ? '## Screens' : '## Bildschirme', '');
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
      // A pure function of the input — no network, no randomness, no clock.
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
    case 'mistral':
      return openAiCompatibleProvider('mistral', MISTRAL_URL, config, requireApiKey(config, env));
    case 'custom': {
      const base = (config.baseUrl ?? '').replace(/\/+$/, '');
      if (!base) throw new Error('LLM provider "custom": baseUrl is missing from the configuration.');
      // Local endpoints need no key — then the Authorization header is dropped.
      const apiKey = env[config.apiKeyEnv];
      return openAiCompatibleProvider('custom', `${base}/chat/completions`, config, apiKey || undefined);
    }
    case 'mock':
      return mockProvider();
  }
}
