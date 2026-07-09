import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LlmConfig, LlmRequest } from '../../src/contracts.js';
import { createProvider } from '../../src/llm/providers.js';

const KEY_ENV = 'DUCTUS_TEST_LLM_KEY';
const SECRET = 'sk-super-geheim-123';

const baseConfig: LlmConfig = {
  provider: 'anthropic',
  model: 'test-model',
  apiKeyEnv: KEY_ENV,
  temperature: 0.2,
  maxTokens: 1024,
  faithfulnessCheck: false,
  faithfulnessThreshold: 0,
};

const request: LlmRequest = {
  system: 'System-Anweisung',
  messages: [{ role: 'user', content: 'Hallo' }],
  maxTokens: 1024,
  temperature: 0.2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(...responses: Response[]): Mock {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function callArgs(mock: Mock, index = 0): { url: string; init: RequestInit } {
  const call = mock.mock.calls[index] as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createProvider — anthropic', () => {
  it('ruft die Messages-API mit korrekten Headern und Body auf und mappt die Antwort', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        content: [{ type: 'text', text: 'Antworttext' }],
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
    );
    const provider = createProvider(baseConfig, { [KEY_ENV]: SECRET });
    const result = await provider.complete(request);

    expect(result.text).toBe('Antworttext');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });

    const { url, init } = callArgs(fetchMock);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = headersOf(init);
    expect(headers['x-api-key']).toBe(SECRET);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = bodyOf(init);
    expect(body).toEqual({
      model: 'test-model',
      max_tokens: 1024,
      temperature: 0.2,
      system: 'System-Anweisung',
      messages: [{ role: 'user', content: 'Hallo' }],
    });
  });
});

describe('createProvider — openai', () => {
  it('sendet system als erste Message und mappt choices/usage', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Antworttext' } }],
        usage: { prompt_tokens: 9, completion_tokens: 3 },
      }),
    );
    const provider = createProvider({ ...baseConfig, provider: 'openai' }, { [KEY_ENV]: SECRET });
    const result = await provider.complete(request);

    expect(result.text).toBe('Antworttext');
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 3 });

    const { url, init } = callArgs(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headersOf(init)['Authorization']).toBe(`Bearer ${SECRET}`);
    const body = bodyOf(init);
    expect(body['messages']).toEqual([
      { role: 'system', content: 'System-Anweisung' },
      { role: 'user', content: 'Hallo' },
    ]);
    expect(body['model']).toBe('test-model');
  });
});

describe('createProvider — custom', () => {
  it('nutzt baseUrl (Slash toleriert) und erlaubt fehlenden API-Key ohne Authorization-Header', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ choices: [{ message: { content: 'lokal' } }] }),
    );
    const provider = createProvider(
      { ...baseConfig, provider: 'custom', baseUrl: 'http://localhost:8080/v1/' },
      {},
    );
    const result = await provider.complete(request);

    expect(result.text).toBe('lokal');
    expect(result.usage).toBeUndefined();
    const { url, init } = callArgs(fetchMock);
    expect(url).toBe('http://localhost:8080/v1/chat/completions');
    expect(headersOf(init)['Authorization']).toBeUndefined();
  });

  it('setzt den Authorization-Header, wenn ein Key vorhanden ist', async () => {
    const fetchMock = stubFetch(jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    const provider = createProvider(
      { ...baseConfig, provider: 'custom', baseUrl: 'http://localhost:8080/v1' },
      { [KEY_ENV]: SECRET },
    );
    await provider.complete(request);
    expect(headersOf(callArgs(fetchMock).init)['Authorization']).toBe(`Bearer ${SECRET}`);
  });
});

describe('NFR4 — Key-Sicherheit', () => {
  it('nennt bei fehlendem Key nur den Variablennamen', () => {
    for (const provider of ['anthropic', 'openai'] as const) {
      expect(() => createProvider({ ...baseConfig, provider }, {})).toThrow(KEY_ENV);
    }
  });

  it('bereinigt HTTP-Fehlertexte um den Key-Wert', async () => {
    stubFetch(new Response(`invalid api key: ${SECRET} rejected`, { status: 400 }));
    const provider = createProvider(baseConfig, { [KEY_ENV]: SECRET });
    const error = (await provider.complete(request).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('400');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain('***');
  });

  it('kürzt Fehler-Bodies auf maximal 500 Zeichen', async () => {
    stubFetch(new Response('x'.repeat(2000), { status: 400 }));
    const provider = createProvider(baseConfig, { [KEY_ENV]: SECRET });
    const error = (await provider.complete(request).catch((e: unknown) => e)) as Error;
    expect(error.message.length).toBeLessThan(600);
  });
});

describe('Retries', () => {
  it('wiederholt bei 429 und liefert danach die Antwort', async () => {
    const fetchMock = stubFetch(
      new Response('rate limited', { status: 429 }),
      jsonResponse({ content: [{ text: 'nach Retry' }] }),
    );
    const provider = createProvider(baseConfig, { [KEY_ENV]: SECRET });
    const result = await provider.complete(request);
    expect(result.text).toBe('nach Retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gibt nach 2 Retries (3 Versuchen) bei anhaltendem 5xx auf', async () => {
    const fetchMock = stubFetch(
      new Response('kaputt', { status: 500 }),
      new Response('kaputt', { status: 500 }),
      new Response('kaputt', { status: 500 }),
    );
    const provider = createProvider(baseConfig, { [KEY_ENV]: SECRET });
    const error = (await provider.complete(request).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('500');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('wiederholt bei 4xx (außer 429) nicht', async () => {
    const fetchMock = stubFetch(new Response('nope', { status: 400 }));
    const provider = createProvider(baseConfig, { [KEY_ENV]: SECRET });
    await expect(provider.complete(request)).rejects.toThrow('400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
