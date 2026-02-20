import * as fs from 'fs/promises';
import * as path from 'path';
import { processRiskEvent } from '../llmTrigger';
import type { GeminiCaller } from '../llmTrigger';
import type { RiskAssessedEvent } from '../../../types/metrics';

const TEST_ROOT = '/tmp/clineshield-llmtrigger-test';
const METRICS_PATH = path.join(TEST_ROOT, '.cline-shield', 'metrics.json');
const SIDECAR_PATH = path.join(TEST_ROOT, '.cline-shield', 'diff-context.json');
const SESSION_ID = 'test-session-llm';

const BASE_RISK_EVENT: RiskAssessedEvent = {
  timestamp: '2026-02-19T10:00:00.000Z',
  sessionId: SESSION_ID,
  type: 'risk-assessed',
  data: {
    file: 'src/auth.ts',
    rulesScore: 65,
    level: 'high',
    reasons: [
      { rule: 'protected_path', points: 30, description: 'File is in a protected path' },
      { rule: 'structural_change_high', points: 35, description: 'Structural change is 80%' },
    ],
  },
};

async function readMetrics(): Promise<unknown[]> {
  const raw = await fs.readFile(METRICS_PATH, 'utf-8');
  return JSON.parse(raw) as unknown[];
}

async function writeSidecar(file: string, diff: string): Promise<void> {
  await fs.mkdir(path.dirname(SIDECAR_PATH), { recursive: true });
  await fs.writeFile(SIDECAR_PATH, JSON.stringify({ file, diff }), 'utf-8');
}

describe('processRiskEvent', () => {
  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_ROOT, '.cline-shield'), { recursive: true });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // ── Null result ─────────────────────────────────────────────────────────────

  it('does not write any event when caller returns null', async () => {
    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;

    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const exists = await fs.access(METRICS_PATH).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('completes normally when caller returns null (no throw)', async () => {
    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;

    await expect(
      processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller)
    ).resolves.toBeUndefined();
  });

  // ── Valid result ─────────────────────────────────────────────────────────────

  it('writes a correctly shaped llm-analysis event when caller returns a result', async () => {
    const mockCaller = jest.fn().mockResolvedValue(
      { explanation: 'This edit removes the rate-limit guard on the login endpoint.' }
    ) as unknown as GeminiCaller;

    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const events = await readMetrics();
    expect(events).toHaveLength(1);

    const event = events[0] as Record<string, unknown>;
    expect(event.type).toBe('llm-analysis');
    expect(event.sessionId).toBe(SESSION_ID);
    expect(typeof event.timestamp).toBe('string');

    const data = event.data as Record<string, unknown>;
    expect(data.file).toBe('src/auth.ts');
    expect(data.relatedRiskEventTimestamp).toBe('2026-02-19T10:00:00.000Z');
    expect(data.reasoning).toBe('This edit removes the rate-limit guard on the login endpoint.');
    expect(data.model).toBe('gemini-2.5-flash');
    expect(typeof data.duration).toBe('number');
  });

  it('reasoning is a plain string, not JSON-wrapped', async () => {
    const explanation = 'The session validation middleware was deleted.';
    const mockCaller = jest.fn().mockResolvedValue({ explanation }) as unknown as GeminiCaller;

    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const events = await readMetrics();
    const data = (events[0] as Record<string, unknown>).data as Record<string, unknown>;

    // Must be the raw string, not '{"explanation":"..."}'
    expect(data.reasoning).toBe(explanation);
    expect(() => JSON.parse(data.reasoning as string)).toThrow();
  });

  // ── Sidecar matching ─────────────────────────────────────────────────────────

  it('passes diff to caller when sidecar file path matches', async () => {
    const diff = '--- src/auth.ts\n+++ src/auth.ts\n@@ -1 +1 @@\n-old\n+new';
    await writeSidecar('src/auth.ts', diff);

    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;
    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    expect(mockCaller).toHaveBeenCalledWith(
      diff,
      expect.any(String), // fileContents
      'src/auth.ts',
      65,
      BASE_RISK_EVENT.data.reasons
    );
  });

  it('passes empty diff when sidecar file path does not match', async () => {
    await writeSidecar('src/other.ts', 'some diff content');

    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;
    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const [calledDiff] = (mockCaller as jest.Mock).mock.calls[0] as [string, ...unknown[]];
    expect(calledDiff).toBe('');
  });

  it('passes empty diff when sidecar is absent', async () => {
    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;
    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const [calledDiff] = (mockCaller as jest.Mock).mock.calls[0] as [string, ...unknown[]];
    expect(calledDiff).toBe('');
  });

  // ── File contents ────────────────────────────────────────────────────────────

  it('passes file contents to caller when file exists on disk', async () => {
    const fileContent = 'export function login() { return true; }';
    const filePath = path.join(TEST_ROOT, 'src', 'auth.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fileContent, 'utf-8');

    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;
    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const [, calledFileContents] = (mockCaller as jest.Mock).mock.calls[0] as [string, string, ...unknown[]];
    expect(calledFileContents).toBe(fileContent);
  });

  it('passes empty fileContents when file does not exist on disk', async () => {
    const mockCaller = jest.fn().mockResolvedValue(null) as unknown as GeminiCaller;
    await processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller);

    const [, calledFileContents] = (mockCaller as jest.Mock).mock.calls[0] as [string, string, ...unknown[]];
    expect(calledFileContents).toBe('');
  });

  // ── Error resilience ─────────────────────────────────────────────────────────

  it('does not throw when caller rejects', async () => {
    const mockCaller = jest.fn().mockRejectedValue(
      new Error('network error')
    ) as unknown as GeminiCaller;

    await expect(
      processRiskEvent(BASE_RISK_EVENT, SESSION_ID, TEST_ROOT, mockCaller)
    ).resolves.toBeUndefined();
  });

  it('does not throw when appendEvent fails (bad workspace root)', async () => {
    const mockCaller = jest.fn().mockResolvedValue(
      { explanation: 'Risky edit detected.' }
    ) as unknown as GeminiCaller;

    await expect(
      processRiskEvent(BASE_RISK_EVENT, SESSION_ID, '/nonexistent/path', mockCaller)
    ).resolves.toBeUndefined();
  });
});
