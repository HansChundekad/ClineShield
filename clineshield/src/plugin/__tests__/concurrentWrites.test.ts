/**
 * The plugin runs in a Cline worker process while the VS Code extension
 * writes from the extension host, so appendEvent()'s in-process queue does
 * not serialise them. This test runs real separate Node processes against
 * one metrics.json and checks the file is never corrupted.
 */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { validateEvent } from './validateEvent';

const PROCESSES = 4;
const EVENTS_PER_PROCESS = 25;

const WORKER_SOURCE = `
const { appendEvent } = require('./writer.js');
const [root, label, count] = process.argv.slice(2);
Promise.all(Array.from({ length: Number(count) }, (_, i) => appendEvent({
  timestamp: new Date().toISOString(),
  sessionId: label,
  type: 'edit-allowed',
  data: { file: label + '-' + i + '.ts', structuralChangePercent: i, functionsDeleted: 0, exportsDeleted: 0 },
}, root))).then(() => process.exit(0));
`;

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? -1));
  });
}

describe('metrics.json under concurrent writes from separate processes', () => {
  let dir: string;
  let root: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-xproc-'));
    root = path.join(dir, 'workspace');
    const writerTs = await fs.readFile(path.join(__dirname, '..', '..', 'metrics', 'writer.ts'), 'utf-8');
    const { outputText } = ts.transpileModule(writerTs, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    await fs.writeFile(path.join(dir, 'writer.js'), outputText);
    await fs.writeFile(path.join(dir, 'worker.js'), WORKER_SOURCE);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('leaves a valid JSON array of valid events, with no temp files left behind', async () => {
    const codes = await Promise.all(
      Array.from({ length: PROCESSES }, (_, p) =>
        run(path.join(dir, 'worker.js'), [root, `proc-${p}`, String(EVENTS_PER_PROCESS)]),
      ),
    );
    expect(codes).toEqual(Array(PROCESSES).fill(0));

    const raw = await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8');
    const events: unknown[] = JSON.parse(raw);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(PROCESSES * EVENTS_PER_PROCESS);
    for (const event of events) {
      expect(validateEvent(event)).toEqual([]);
    }

    const leftovers = (await fs.readdir(path.join(root, '.cline-shield'))).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  }, 30000);
});
