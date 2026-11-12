import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GEMINI_MIN_INTERVAL_MS, MAX_FILE_CHARS, buildExplainPrompt, createExplainer } from '../explain';
import type { ActionItem } from '../../../sidebar/dashboard';
import { appendSidecar } from '../../../plugin/sidecar';

const AWS = 'AKIAABCDEFGHIJKLMNOP';
const item = (over: Partial<ActionItem> = {}): ActionItem => ({
  id: 's1|t1|edit', sessionId: 's1', timestamp: 't1', kind: 'edit', tier: 'block',
  target: 'lib/a.ts', files: ['lib/a.ts'], score: 80,
  reasons: [{ rule: 'rewrite_share', points: 80, description: 'Rewrites 95% of the file' }],
  cutoffs: { ask: 40, block: 70 }, reasonText: 'blocked', ...over,
});

describe('createExplainer', () => {
  let root: string;
  let prompts: string[];
  const caller = jest.fn(async (_key: string, prompt: string) => { prompts.push(prompt); return { ok: true as const, explanation: 'x' }; });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-explain-'));
    await fs.mkdir(path.join(root, 'lib'));
    await fs.writeFile(path.join(root, 'lib', 'a.ts'), `export const k = "${AWS}";\nexport function f() {}\n`);
    prompts = [];
    caller.mockClear();
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const explainer = (over: Partial<Parameters<typeof createExplainer>[0]> = {}) =>
    createExplainer({ root, getKey: async () => 'K', caller, sleep: async () => undefined, ...over });

  it('no key → no-key, Gemini not called', async () => {
    expect(await explainer({ getKey: async () => undefined })(item())).toEqual({ ok: false, error: 'no-key' });
    expect(caller).not.toHaveBeenCalled();
  });

  it('uses the sidecar diff that matches session, timestamp and file', async () => {
    await appendSidecar(root, [
      { sessionId: 's1', timestamp: 't0', file: 'lib/a.ts', diff: '+OTHER_DIFF' },
      { sessionId: 's1', timestamp: 't1', file: 'lib/a.ts', diff: '+MATCHING_DIFF' },
    ]);
    await explainer()(item());
    expect(prompts[0]).toContain('+MATCHING_DIFF');
    expect(prompts[0]).not.toContain('OTHER_DIFF');
  });

  it('says the diff is unavailable when nothing matches', async () => {
    await explainer()(item());
    expect(prompts[0]).toContain('Diff: (not available)');
  });

  it('redacts secrets from the diff, file contents, command and reasons', async () => {
    await appendSidecar(root, [{ sessionId: 's1', timestamp: 't1', file: 'lib/a.ts', diff: `+${AWS}` }]);
    await explainer()(item({ reasons: [{ rule: 'x', points: 1, description: `found ${AWS}` }] }));
    await explainer()(item({ kind: 'command', target: `curl -H "k: ${AWS}" x`, files: [] }));
    for (const p of prompts) {
      expect(p).not.toContain(AWS);
      expect(p).toContain('[REDACTED]');
    }
  });

  it('never reads a secrets file or a path outside the workspace', async () => {
    const readFile = jest.fn(async () => 'contents');
    await explainer({ readFile })(item({ files: ['.env'], target: '.env' }));
    await explainer({ readFile })(item({ files: ['../../etc/passwd'], target: '../../etc/passwd' }));
    await explainer({ readFile })(item({ files: ['/etc/passwd'], target: '/etc/passwd' }));
    expect(readFile).not.toHaveBeenCalled();
  });

  describe('multi-file edits', () => {
    const two = () => item({ files: ['lib/a.ts', 'lib/b.ts'], target: 'lib/a.ts, lib/b.ts' });

    it('sends every file\'s diff and contents in one request', async () => {
      await fs.writeFile(path.join(root, 'lib', 'b.ts'), 'export const B_BODY = 1;\n');
      await appendSidecar(root, [
        { sessionId: 's1', timestamp: 't1', file: 'lib/a.ts', diff: '+A_DIFF' },
        { sessionId: 's1', timestamp: 't1', file: 'lib/b.ts', diff: '+B_DIFF' },
      ]);
      await explainer()(two());
      expect(caller).toHaveBeenCalledTimes(1);
      expect(prompts[0]).toContain('File: lib/a.ts');
      expect(prompts[0]).toContain('File: lib/b.ts');
      expect(prompts[0]).toContain('+A_DIFF');
      expect(prompts[0]).toContain('+B_DIFF');
      expect(prompts[0]).toContain('export function f()');
      expect(prompts[0]).toContain('B_BODY');
    });

    it('shares the contents cap evenly between files', async () => {
      const big = (c: string) => c.repeat(MAX_FILE_CHARS);
      await fs.writeFile(path.join(root, 'lib', 'a.ts'), big('a'));
      await fs.writeFile(path.join(root, 'lib', 'b.ts'), big('b'));
      await explainer()(two());
      const half = MAX_FILE_CHARS / 2;
      expect(prompts[0]).toContain('a'.repeat(half) + '\n... [truncated]');
      expect(prompts[0]).not.toContain('a'.repeat(half + 1));
      expect(prompts[0]).toContain('b'.repeat(half) + '\n... [truncated]');
      expect(prompts[0]).not.toContain('b'.repeat(half + 1));
    });

    it('a secrets file contributes its redacted diff but not its contents', async () => {
      await fs.writeFile(path.join(root, '.env'), 'ENV_BODY=1\n');
      await appendSidecar(root, [{ sessionId: 's1', timestamp: 't1', file: '.env', diff: `+SECRET=${AWS}` }]);
      await explainer()(item({ files: ['lib/a.ts', '.env'], target: 'lib/a.ts, .env' }));
      expect(prompts[0]).toContain('File: .env');
      expect(prompts[0]).not.toContain('ENV_BODY');
      expect(prompts[0]).not.toContain(AWS);
      expect(prompts[0]).toContain('export function f()');
    });

    it('an all-secrets edit still builds a prompt with diffs only', async () => {
      await appendSidecar(root, [{ sessionId: 's1', timestamp: 't1', file: '.env', diff: '+X=1' }]);
      await explainer()(item({ files: ['.env', '.env.local'], target: '.env, .env.local' }));
      expect(caller).toHaveBeenCalledTimes(1);
      expect(prompts[0]).toContain('File: .env');
      expect(prompts[0]).toContain('File: .env.local');
      expect(prompts[0]).toContain('+X=1');
    });
  });

  it('spaces calls at least 6 s apart', async () => {
    let now = 1_000_000;
    const waits: number[] = [];
    const ex = explainer({ now: () => now, sleep: async ms => { waits.push(ms); now += ms; } });
    await ex(item());
    now += 1000;
    await ex(item());
    expect(waits).toEqual([GEMINI_MIN_INTERVAL_MS - 1000]);
  });
});

describe('buildExplainPrompt', () => {
  it('says a blocked or asked edit did not run', () => {
    expect(buildExplainPrompt(item(), [{ file: 'lib/a.ts', diff: '', contents: 'body' }])).toMatch(/has not run/i);
    expect(buildExplainPrompt(item({ tier: 'ask' }), [{ file: 'lib/a.ts', diff: '', contents: 'body' }])).toMatch(/has not run/i);
    expect(buildExplainPrompt(item({ tier: 'allow' }), [{ file: 'lib/a.ts', diff: '', contents: 'body' }])).not.toMatch(/has not run/i);
  });

  it('includes the categories, score and cut-offs', () => {
    const p = buildExplainPrompt(item(), [{ file: 'lib/a.ts', diff: '', contents: '' }]);
    expect(p).toContain('Rewrites 95% of the file (+80)');
    expect(p).toContain('80/100');
    expect(p).toContain('block at 70');
  });
});
