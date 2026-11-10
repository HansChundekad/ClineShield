import { callGemini } from '../llmAnalyzer';

const KEY = 'AIzaTESTKEY000000000000000000000000000';
const okBody = { candidates: [{ content: { parts: [{ text: JSON.stringify({ explanation: 'Deletes the auth check.' }) }] } }] };
const fakeFetch = (status: number, body: unknown) =>
  jest.fn(async (_url: string, _init?: RequestInit) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);

describe('callGemini', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'error', 'warn'] as const) jest.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends the key in the x-goog-api-key header, never in the URL', async () => {
    const f = fakeFetch(200, okBody);
    expect(await callGemini(KEY, 'prompt', f as unknown as typeof fetch)).toEqual({ ok: true, explanation: 'Deletes the auth check.' });
    const [url, init] = f.mock.calls[0];
    expect(url).not.toContain('key=');
    expect(url).not.toContain(KEY);
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
  });

  it('reports HTTP errors by status', async () => {
    expect(await callGemini(KEY, 'p', fakeFetch(429, {}) as unknown as typeof fetch)).toEqual({ ok: false, error: 'HTTP 429' });
  });

  it('reports a malformed body as an empty response', async () => {
    expect(await callGemini(KEY, 'p', fakeFetch(200, { candidates: [] }) as unknown as typeof fetch)).toEqual({ ok: false, error: 'empty response' });
  });

  it('reports a thrown fetch as a network error', async () => {
    const f = jest.fn(async () => { throw new Error(`boom ${KEY}`); });
    expect(await callGemini(KEY, 'p', f as unknown as typeof fetch)).toEqual({ ok: false, error: 'network error' });
  });

  it('never logs the key', async () => {
    await callGemini(KEY, 'p', fakeFetch(500, {}) as unknown as typeof fetch);
    await callGemini(KEY, 'p', jest.fn(async () => { throw new Error(`boom ${KEY}`); }) as unknown as typeof fetch);
    expect(logs.join('\n')).not.toContain(KEY);
  });
});
